/**
 * Decoding the records a Bedrock world keeps its blocks in.
 *
 * Pure functions over bytes. No database, no filesystem, no game - which is the point: the
 * formats below are checked in CI against records captured from a running Education Edition
 * world, so a change here fails on a machine that has never had Minecraft installed.
 *
 * ## Why the world file at all
 *
 * Every command-based way of reading the world was measured and each gives up something.
 * `testforblock` returns a translated string - this client answers 「ダイヤモンドブロック」, not
 * `diamond_block`, so no parser survives a change of language. `getchunkdata` returns a
 * rendered map pixel with shading baked in, so the same grass block reads as two different
 * values depending on whether a pillar shadows it; its heights are exact but its colours are
 * a hint. `execute if block` is exact but costs a round trip per block and requires guessing
 * the block before asking.
 *
 * The world file has none of those problems. It stores what the game stores: `minecraft:
 * gold_block` with its states, at its coordinates.
 */

/** A block as the world stores it: an identifier and whatever states distinguish it. */
export interface BlockRecord {
  readonly name: string;
  readonly states: Readonly<Record<string, string | number | boolean>>;
}

export interface SubChunk {
  /** Which 16-block slice of the column this is; multiply by 16 for the world y of its base. */
  readonly yIndex: number;
  /** 4096 blocks, indexed by {@link subChunkIndex}. */
  readonly blocks: readonly BlockRecord[];
  /** The second layer, present only where the world stores waterlogging. */
  readonly waterlogged: readonly BlockRecord[] | null;
}

export class MalformedRecordError extends Error {
  constructor(what: string, offset: number, detail: string) {
    super(`${what} at byte ${offset}: ${detail}`);
    this.name = 'MalformedRecordError';
  }
}

/**
 * Where a block sits in a subchunk's 4096 entries.
 *
 * x-major, then z, then y. Worth stating because it is not the order anyone guesses, and
 * getting it wrong produces a chunk that decodes without error and is transposed.
 */
export function subChunkIndex(x: number, y: number, z: number): number {
  return (x * 16 + z) * 16 + y;
}

/**
 * Unpacks the block indices.
 *
 * The packing is dense within a 32-bit word but never lets an index straddle two, so a word
 * holds `floor(32 / bits)` of them and the leftover high bits are padding. Reading it as a
 * plain bit stream is the obvious mistake and produces plausible-looking rubbish.
 */
function unpackIndices(
  value: Buffer,
  offset: number,
  bitsPerBlock: number
): { indices: Uint16Array; bytesRead: number } {
  const perWord = Math.floor(32 / bitsPerBlock);
  const wordCount = Math.ceil(4096 / perWord);
  const bytesRead = wordCount * 4;

  if (offset + bytesRead > value.length) {
    throw new MalformedRecordError('block indices', offset, `need ${bytesRead} bytes, ${value.length - offset} left`);
  }

  const mask = (1 << bitsPerBlock) - 1;
  const indices = new Uint16Array(4096);
  let written = 0;

  for (let word = 0; word < wordCount; word++) {
    const packed = value.readUInt32LE(offset + word * 4);
    for (let slot = 0; slot < perWord && written < 4096; slot++) {
      indices[written++] = (packed >>> (slot * bitsPerBlock)) & mask;
    }
  }

  return { indices, bytesRead };
}

/**
 * How the palette entries are read.
 *
 * Passed in rather than imported so this module stays free of the NBT library, and so the
 * tests can decode a palette without one. Each call gets the remaining bytes and must report
 * how many it consumed.
 */
export type PaletteReader = (bytes: Buffer) => { block: BlockRecord; bytesRead: number };

/**
 * Decodes one `SubChunkPrefix` record.
 *
 *   u8   version        8, or 9 when the record carries its own y index
 *   u8   storage count  1 normally, 2 where the world tracks waterlogging
 *   u8   y index        version 9 only
 *   per storage:
 *     u8      (bitsPerBlock << 1) | isRuntime
 *     u32[]   packed indices, see unpackIndices
 *     i32 LE  palette length
 *     NBT     that many little-endian compounds
 */
export function decodeSubChunk(value: Buffer, readPaletteEntry: PaletteReader): SubChunk {
  if (value.length < 3) {
    throw new MalformedRecordError('subchunk', 0, `only ${value.length} bytes`);
  }

  const version = value.readUInt8(0);
  if (version !== 8 && version !== 9) {
    // Older worlds used other layouts entirely. Refusing is better than decoding one of them
    // as if it were this, which would produce a chunk full of confident nonsense.
    throw new MalformedRecordError('subchunk', 0, `unsupported version ${version}; only 8 and 9 are handled`);
  }

  let offset = 1;
  const storageCount = value.readUInt8(offset++);
  const yIndex = version >= 9 ? value.readInt8(offset++) : 0;

  const layers: BlockRecord[][] = [];

  for (let storage = 0; storage < storageCount; storage++) {
    if (offset >= value.length) {
      throw new MalformedRecordError('storage header', offset, `expected ${storageCount} storages, ran out after ${storage}`);
    }
    const header = value.readUInt8(offset++);
    const bitsPerBlock = header >> 1;

    if (bitsPerBlock === 0) {
      // A uniform storage: no indices at all, and a palette of exactly one.
      const paletteLength = value.readInt32LE(offset);
      offset += 4;
      if (paletteLength !== 1) {
        throw new MalformedRecordError('uniform storage', offset, `palette of ${paletteLength}, expected 1`);
      }
      const { block, bytesRead } = readPaletteEntry(value.subarray(offset));
      offset += bytesRead;
      layers.push(new Array(4096).fill(block) as BlockRecord[]);
      continue;
    }

    const { indices, bytesRead } = unpackIndices(value, offset, bitsPerBlock);
    offset += bytesRead;

    const paletteLength = value.readInt32LE(offset);
    offset += 4;
    if (paletteLength <= 0 || paletteLength > 1 << bitsPerBlock) {
      throw new MalformedRecordError(
        'palette',
        offset,
        `length ${paletteLength} cannot be addressed by ${bitsPerBlock} bits`
      );
    }

    const palette: BlockRecord[] = [];
    for (let entry = 0; entry < paletteLength; entry++) {
      const { block, bytesRead: read } = readPaletteEntry(value.subarray(offset));
      palette.push(block);
      offset += read;
    }

    const blocks: BlockRecord[] = new Array(4096);
    for (let i = 0; i < 4096; i++) {
      const index = indices[i] as number;
      const block = palette[index];
      if (block === undefined) {
        throw new MalformedRecordError('block index', i, `index ${index} is outside a palette of ${paletteLength}`);
      }
      blocks[i] = block;
    }
    layers.push(blocks);
  }

  const [blocks, waterlogged] = layers;
  if (blocks === undefined) {
    throw new MalformedRecordError('subchunk', 0, 'no block storage');
  }

  return { yIndex, blocks, waterlogged: waterlogged ?? null };
}

/** A region read back out of a saved structure. */
export interface StructureRegion {
  readonly size: readonly [number, number, number];
  /** Where the structure's local origin sits in the world, so offsets can be mapped back. */
  readonly origin: readonly [number, number, number];
  /** `null` where the structure records no block, which is not the same as air. */
  readonly blocks: readonly (BlockRecord | null)[];
}

/** The shape `prismarine-nbt`'s `simplify` produces for a structure template. */
export interface RawStructure {
  size?: number[];
  structure_world_origin?: number[];
  structure?: {
    block_indices?: number[][];
    palette?: { default?: { block_palette?: { name?: string; states?: Record<string, unknown> }[] } };
  };
}

/**
 * Turns a decoded structure template into blocks.
 *
 * Indices run x-major, then y, then z - a different order from a subchunk's, which is the
 * kind of detail that silently transposes a build if it is assumed rather than checked.
 *
 * A negative index means the structure records nothing at that position. That is distinct
 * from air: air was saved as air, while nothing means the save skipped it, and flattening
 * the two would have the model believe it had seen an empty space it never looked at.
 */
export function decodeStructure(raw: RawStructure): StructureRegion {
  const size = raw.size;
  if (!Array.isArray(size) || size.length !== 3) {
    throw new MalformedRecordError('structure', 0, 'no size');
  }
  const origin = raw.structure_world_origin ?? [0, 0, 0];
  const palette = raw.structure?.palette?.default?.block_palette ?? [];
  const layer = raw.structure?.block_indices?.[0];

  const [sx, sy, sz] = size as [number, number, number];
  const expected = sx * sy * sz;

  if (!Array.isArray(layer)) {
    throw new MalformedRecordError('structure', 0, 'no block indices');
  }
  if (layer.length !== expected) {
    throw new MalformedRecordError(
      'structure',
      0,
      `${layer.length} indices for a ${sx}x${sy}x${sz} region, expected ${expected}`
    );
  }

  const blocks = layer.map((index) => {
    if (index < 0) return null;
    const entry = palette[index];
    if (entry === undefined) {
      throw new MalformedRecordError('structure', index, `index ${index} is outside a palette of ${palette.length}`);
    }
    return {
      name: entry.name ?? 'minecraft:unknown',
      states: (entry.states ?? {}) as BlockRecord['states'],
    };
  });

  return {
    size: [sx, sy, sz],
    origin: origin as [number, number, number],
    blocks,
  };
}

/** Where a block sits in a structure's indices: x-major, then y, then z. */
export function structureIndex(
  size: readonly [number, number, number],
  x: number,
  y: number,
  z: number
): number {
  const [, sy, sz] = size;
  return (x * sy + y) * sz + z;
}
