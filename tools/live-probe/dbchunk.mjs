// Decodes block data straight out of a Bedrock world database.
//
//   node dbchunk.mjs <db copy> [--chunk x,z] [--at x,y,z]
//
// This is the read path that beats every command-based one if it holds up. `/structure save`
// caps at 64 blocks an axis; `getchunkdata` gives heights and a shaded colour, not block
// identity; `execute if block` costs a round trip per block and needs you to guess the block
// first. A subchunk record is 4096 blocks with their real identifiers and states, and there
// is no round trip at all.
//
// The format, per subchunk record (key tag 47):
//
//   u8   version           8, or 9 when the record carries its own y index
//   u8   storage count     usually 1; 2 when the subchunk has waterlogging
//   u8   y index           version 9 only
//   then per storage:
//     u8       (bitsPerBlock << 1) | isRuntime
//     u32[]    block indices, packed LSB-first, no index spanning a word
//     i32 LE   palette length
//     NBT      that many little-endian compounds, each {name, states, version}
//
// Indices run x-major, then z, then y - the opposite of the order most people guess.

import fs from 'node:fs';
import path from 'node:path';
import { LevelDB } from 'leveldb-zlib';
import nbt from 'prismarine-nbt';

const args = process.argv.slice(2);
const dbPath = path.resolve(args[0] ?? '');
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

if (!fs.existsSync(dbPath)) {
  console.error(`no such database: ${dbPath}`);
  process.exit(2);
}

/** Reads the packed indices without letting one straddle a 32-bit word, as the format does. */
function unpackIndices(buffer, offset, bitsPerBlock) {
  const perWord = Math.floor(32 / bitsPerBlock);
  const wordCount = Math.ceil(4096 / perWord);
  const mask = (1 << bitsPerBlock) - 1;
  const indices = new Uint16Array(4096);

  let written = 0;
  for (let w = 0; w < wordCount; w++) {
    const word = buffer.readUInt32LE(offset + w * 4);
    for (let i = 0; i < perWord && written < 4096; i++) {
      indices[written++] = (word >> (i * bitsPerBlock)) & mask;
    }
  }
  return { indices, bytesRead: wordCount * 4 };
}

async function decodeSubChunk(value) {
  const version = value.readUInt8(0);
  let offset = 1;
  const storageCount = value.readUInt8(offset++);
  let yIndex = null;
  if (version >= 9) yIndex = value.readInt8(offset++);

  const storages = [];
  for (let s = 0; s < storageCount; s++) {
    const header = value.readUInt8(offset++);
    const bitsPerBlock = header >> 1;
    const isRuntime = (header & 1) === 1;

    if (bitsPerBlock === 0) {
      // A single-value storage still carries a palette of one.
      storages.push({ bitsPerBlock, isRuntime, palette: [], indices: new Uint16Array(4096) });
      continue;
    }

    const { indices, bytesRead } = unpackIndices(value, offset, bitsPerBlock);
    offset += bytesRead;

    const paletteLength = value.readInt32LE(offset);
    offset += 4;

    const palette = [];
    for (let p = 0; p < paletteLength; p++) {
      const parsed = await nbt.parse(value.subarray(offset), 'little');
      palette.push(nbt.simplify(parsed.parsed));
      offset += parsed.metadata.size;
    }

    storages.push({ bitsPerBlock, isRuntime, palette, indices });
  }

  return { version, storageCount, yIndex, storages };
}

const db = new LevelDB(dbPath, { createIfMissing: false });
await db.open();

const wanted = flag('chunk');
const at = flag('at');
const subChunks = [];

for await (const [rawKey, value] of db.getIterator({ keys: true, values: true })) {
  const key = Buffer.from(rawKey);
  if (![10, 14].includes(key.length)) continue;
  const dimensioned = key.length === 14;
  const tag = key[dimensioned ? 12 : 8];
  if (tag !== 47) continue;

  const x = key.readInt32LE(0);
  const z = key.readInt32LE(4);
  const sub = key[key.length - 1];
  if (wanted && `${x},${z}` !== wanted) continue;

  subChunks.push({ x, z, sub, value: Buffer.from(value) });
}

await db.close();

console.log(`subchunk records: ${subChunks.length}`);
console.log('');

let decoded = 0;
let failed = 0;
const blockCounts = new Map();

for (const record of subChunks) {
  try {
    const chunk = await decodeSubChunk(record.value);
    decoded++;
    const storage = chunk.storages[0];
    const names = storage.palette.map((entry) => entry.name ?? '?');

    for (let i = 0; i < 4096; i++) {
      const name = names[storage.indices[i]] ?? '?';
      blockCounts.set(name, (blockCounts.get(name) ?? 0) + 1);
    }

    if (decoded <= 3 || (wanted && subChunks.length < 30)) {
      // Subchunk `sub` covers y from sub*16; Bedrock's overworld starts at -64, so the
      // stored index is offset by four subchunks.
      const yBase = (record.sub > 127 ? record.sub - 256 : record.sub) * 16;
      console.log(`chunk ${record.x},${record.z} sub ${record.sub} (y ${yBase}..${yBase + 15})  v${chunk.version}  ${chunk.storageCount} storage, ${storage.bitsPerBlock} bits`);
      console.log(`  palette (${names.length}): ${names.slice(0, 12).join(', ')}${names.length > 12 ? ' ...' : ''}`);
    }
  } catch (error) {
    failed++;
    if (failed <= 3) console.log(`  could not decode chunk ${record.x},${record.z} sub ${record.sub}: ${error.message}`);
  }
}

console.log('');
console.log(`decoded ${decoded}, failed ${failed}`);
console.log('');
console.log('blocks by count:');
for (const [name, count] of [...blockCounts].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${count.toString().padStart(8)}  ${name}`);
}

// A single position, read out of the database with no command and no round trip.
if (at) {
  const [wx, wy, wz] = at.split(',').map(Number);
  const cx = wx >> 4;
  const cz = wz >> 4;
  const sub = wy >> 4;
  const record = subChunks.find((r) => r.x === cx && r.z === cz && (r.sub > 127 ? r.sub - 256 : r.sub) === sub);
  console.log('');
  if (!record) {
    console.log(`no subchunk stored for ${wx},${wy},${wz} (chunk ${cx},${cz} sub ${sub})`);
  } else {
    const chunk = await decodeSubChunk(record.value);
    const storage = chunk.storages[0];
    const lx = ((wx % 16) + 16) % 16;
    const ly = ((wy % 16) + 16) % 16;
    const lz = ((wz % 16) + 16) % 16;
    const index = (lx * 16 + lz) * 16 + ly;
    const entry = storage.palette[storage.indices[index]];
    console.log(`block at ${wx},${wy},${wz}: ${entry?.name ?? '?'} ${JSON.stringify(entry?.states ?? {})}`);
  }
}
