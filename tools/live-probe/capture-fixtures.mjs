// Captures real records from a world database as test fixtures.
//
//   node capture-fixtures.mjs <db copy> <output.json>
//
// The decoders are pure functions over bytes, so they can be tested without a game, a socket
// or a filesystem - but only against bytes the game actually produced. Anything hand-written
// would test the decoder against my understanding of the format rather than against the
// format, which is the mistake this whole exercise has been correcting.
//
// Picks records that differ from each other: several bit widths, a subchunk with more than
// one storage if there is one, and a structure template.

import fs from 'node:fs';
import path from 'node:path';
import { LevelDB } from 'leveldb-zlib';

const [dbPath, outPath] = process.argv.slice(2);
const db = new LevelDB(path.resolve(dbPath), { createIfMissing: false });
await db.open();

const subchunks = [];
const structures = [];
const seenWidths = new Set();

for await (const [rawKey, rawValue] of db.getIterator({ keys: true, values: true })) {
  const key = Buffer.from(rawKey);
  const value = Buffer.from(rawValue);
  const text = key.toString('latin1');

  if (text.startsWith('structuretemplate_') && structures.length < 3) {
    structures.push({ key: text, base64: value.toString('base64') });
    continue;
  }

  if (![10, 14].includes(key.length)) continue;
  if (key[key.length === 14 ? 12 : 8] !== 47) continue;

  const version = value.readUInt8(0);
  const storages = value.readUInt8(1);
  const header = value.readUInt8(version >= 9 ? 3 : 2);
  const bits = header >> 1;

  // One of each shape is enough; more would just be the same code path again.
  const shape = `${version}-${storages}-${bits}`;
  if (seenWidths.has(shape)) continue;
  seenWidths.add(shape);

  subchunks.push({
    keyHex: key.toString('hex'),
    chunkX: key.readInt32LE(0),
    chunkZ: key.readInt32LE(4),
    subIndex: key[key.length - 1] > 127 ? key[key.length - 1] - 256 : key[key.length - 1],
    version,
    storages,
    bitsPerBlock: bits,
    base64: value.toString('base64'),
  });
}

await db.close();

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(
  path.resolve(outPath),
  JSON.stringify(
    {
      note: 'Captured from Minecraft Education 1.26.3200 on 2026-08-24. Real records, not hand-written.',
      subchunks,
      structures,
    },
    null,
    2
  ) + '\n'
);

console.log(`${subchunks.length} subchunks (${[...seenWidths].join(', ')}), ${structures.length} structures`);
console.log(`-> ${outPath}`);
