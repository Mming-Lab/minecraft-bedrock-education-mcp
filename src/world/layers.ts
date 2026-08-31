/**
 * Turning a box of blocks into something a model can actually read.
 *
 * A region read comes back from the add-on as a flat list of names, one per block, in the
 * order the add-on walked them. Handing that to a model is technically complete and
 * practically useless: 4096 quoted strings is a wall of text with no shape in it, and nothing
 * in the list says which entry is above which.
 *
 * So a region is returned as horizontal layers instead - one character per block, one row per
 * north-south line, one grid per height:
 *
 *     y = -55
 *       ..........
 *       ..sssss...
 *       ..s...s...
 *       ..sssss...
 *
 * The same 4096 blocks become 4096 characters plus a short palette, which is not only smaller
 * but arranged the way the thing itself is arranged. A model can see that the walls line up.
 *
 * ## Why this shape and not a list of coordinates
 *
 * The read has to be usable for *changing* what is there, not only describing it, and that
 * means the model has to be able to write back what it read. A grid can be edited in place -
 * move a door, close a gap, extend a wall - and stay a grid. A parameterised shape cannot: to
 * move one block of a sphere you have to stop describing a sphere. That is the difference
 * that makes geometry hard to steer, and it is not fixed by better geometry.
 *
 * ## Air and unknown are not the same character
 *
 * `.` is air: somebody looked, and there was nothing there. `?` is unknown: the chunk was not
 * loaded, so nobody looked. Collapsing the two would let a model conclude a space is empty
 * when what happened is that it was never read - and then build into whatever is standing
 * there. Every other block gets a letter, commonest first, so the shortest symbols land on
 * the material that covers the most ground.
 */

/** Air, which is usually most of a region and should be the easiest character to look past. */
export const AIR_SYMBOL = '.';

/** Not read - an unloaded chunk. Deliberately not `.`; see the note above. */
export const UNKNOWN_SYMBOL = '?';

/**
 * Symbols for everything else, in the order they are handed out.
 *
 * Letters before digits because a grid of letters is easier to scan than one of digits, and
 * neither `.` nor `?` appears here - those two are reserved so their meaning never shifts
 * between one read and the next.
 */
const SYMBOLS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export interface RegionSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Layer {
  /** The world height this grid is at. */
  readonly y: number;
  /** One string per z, west to east within each. */
  readonly rows: readonly string[];
}

export interface LayeredRegion {
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly size: RegionSize;
  /** Symbol to block name. Always contains `.` when air occurs, `?` when anything was unread. */
  readonly palette: Readonly<Record<string, string>>;
  /** Bottom to top, so reading down the array is reading upwards through the world. */
  readonly layers: readonly Layer[];
  /** How many blocks were not read. Zero means the whole box was seen. */
  readonly unknown: number;
}

export class RegionTooVariedError extends Error {
  constructor(kinds: number) {
    super(
      `the region holds ${kinds} kinds of block, more than the ${SYMBOLS.length} symbols a layer grid has. ` +
        `Read it in smaller pieces.`
    );
    this.name = 'RegionTooVariedError';
  }
}

/**
 * The order the add-on walks a box: x outermost, then y, then z.
 *
 * Worth stating in one place, because the world database walks subchunks the same way and
 * structures a different one (x, y, z versus x, z, y), and a transposed region looks like a
 * plausible building rather than like an error.
 */
export function indexOf(size: RegionSize, x: number, y: number, z: number): number {
  return (x * size.y + y) * size.z + z;
}

/**
 * Builds the layered form from the add-on's flat list.
 *
 * `blocks` holds one entry per block: a name, or `null` where the chunk was not loaded. Its
 * length must match the box, since a short list means lines went missing - and a region that
 * silently lost its last few rows would read as a smaller building.
 */
export function toLayers(
  origin: { x: number; y: number; z: number },
  size: RegionSize,
  blocks: readonly (string | null)[]
): LayeredRegion {
  const expected = size.x * size.y * size.z;
  if (blocks.length !== expected) {
    throw new Error(
      `region is ${size.x}x${size.y}x${size.z} = ${expected} blocks but ${blocks.length} arrived`
    );
  }

  // Commonest first, so the letters early in the alphabet cover the most blocks. Ties are
  // broken by name so that reading the same region twice gives the same palette - a palette
  // that shuffled between reads would make two identical grids look like a change.
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const block of blocks) {
    if (block === null) {
      unknown++;
      continue;
    }
    counts.set(block, (counts.get(block) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .filter(([name]) => name !== 'air')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([name]) => name);

  if (ranked.length > SYMBOLS.length) throw new RegionTooVariedError(ranked.length);

  const symbolFor = new Map<string, string>();
  const palette: Record<string, string> = {};
  if (counts.has('air')) {
    symbolFor.set('air', AIR_SYMBOL);
    palette[AIR_SYMBOL] = 'air';
  }
  if (unknown > 0) palette[UNKNOWN_SYMBOL] = 'not read - the chunk was not loaded';
  ranked.forEach((name, index) => {
    const symbol = SYMBOLS[index]!;
    symbolFor.set(name, symbol);
    palette[symbol] = name;
  });

  const layers: Layer[] = [];
  for (let y = 0; y < size.y; y++) {
    const rows: string[] = [];
    for (let z = 0; z < size.z; z++) {
      let row = '';
      for (let x = 0; x < size.x; x++) {
        const block = blocks[indexOf(size, x, y, z)];
        row += block === null || block === undefined ? UNKNOWN_SYMBOL : symbolFor.get(block)!;
      }
      rows.push(row);
    }
    layers.push({ y: origin.y + y, rows });
  }

  return { origin, size, palette, layers, unknown };
}

/**
 * How many characters the layered form will take.
 *
 * Used to keep a read inside something a model can hold, and to say so before the round trip
 * rather than after: the region is read from the game whether or not the answer fits.
 */
export function layeredSize(size: RegionSize): number {
  return size.x * size.y * size.z + size.y * size.z + size.y * 12;
}
