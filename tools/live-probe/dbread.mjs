// Reads a Bedrock world database directly, without the game's cooperation.
//
//   node dbread.mjs <path to a copy of the db folder> [--find <text>]
//
// The question this exists to answer: if the world's own storage is readable, does the model
// need commands to see the world at all? Commands cost one round trip per block; the database
// holds every block already, exactly, with real identifiers and no rendering or translation
// in the way.
//
// Two things have to be true for that to be worth building on, and both are measurable here
// rather than arguable. The blocks have to be decodable - Bedrock's LevelDB compresses its
// blocks with zlib and keys chunks by a binary scheme - and edits have to reach disk quickly
// enough to be worth reading. This answers the first. `dbwatch.mjs` answers the second.
//
// The database must be a copy: the running game holds an exclusive LOCK, and the copy has to
// have that file removed. Copying is cheap and it keeps a bug here from touching the world.

import fs from 'node:fs';
import path from 'node:path';
import { LevelDB } from 'leveldb-zlib';

const args = process.argv.slice(2);
const dbPath = path.resolve(args[0] ?? '');
const findIndex = args.indexOf('--find');
const find = findIndex >= 0 ? args[findIndex + 1] : null;

if (!fs.existsSync(dbPath)) {
  console.error(`no such database: ${dbPath}`);
  process.exit(2);
}

/** The chunk record types worth naming; the rest are counted but left as numbers. */
const TAGS = {
  43: 'Data3D',
  44: 'Version',
  45: 'Data2D',
  46: 'Data2DLegacy',
  47: 'SubChunkPrefix',
  48: 'LegacyTerrain',
  49: 'BlockEntity',
  50: 'Entity',
  51: 'PendingTicks',
  52: 'LegacyBlockExtraData',
  53: 'BiomeState',
  54: 'FinalizedState',
  56: 'BorderBlocks',
  57: 'HardcodedSpawners',
  58: 'RandomTicks',
  59: 'Checksums',
  118: 'VersionLegacy',
};

const db = new LevelDB(dbPath, { createIfMissing: false });
await db.open();

let total = 0;
const tagCounts = new Map();
const namedKeys = new Map();
const hits = [];
const chunks = new Set();
let totalValueBytes = 0;

for await (const [rawKey, value] of db.getIterator({ keys: true, values: true })) {
  const key = Buffer.from(rawKey);
  total++;
  totalValueBytes += value.length;

  const text = key.toString('latin1');
  if (find && (text.includes(find) || value.toString('latin1').includes(find))) {
    hits.push({ key: text, keyHex: key.toString('hex'), bytes: value.length });
  }

  // A chunk key is 9 or 10 bytes, or 13/14 when it names a dimension; anything else is a
  // world-level record whose key is readable text.
  if ([9, 10, 13, 14].includes(key.length)) {
    const dimensioned = key.length >= 13;
    const tagOffset = dimensioned ? 12 : 8;
    const tag = key[tagOffset];
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const x = key.readInt32LE(0);
    const z = key.readInt32LE(4);
    chunks.add(`${x},${z}${dimensioned ? `,dim${key.readInt32LE(8)}` : ''}`);
  } else if (key.length < 120 && /^[\x20-\x7E]+$/.test(text)) {
    namedKeys.set(text, value.length);
  }
}

await db.close();

console.log(`database: ${dbPath}`);
console.log(`keys: ${total}, values: ${(totalValueBytes / 1024).toFixed(0)} KiB`);
console.log(`chunks referenced: ${chunks.size}`);
console.log('');

console.log('chunk record types:');
for (const [tag, count] of [...tagCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(tag).padStart(3)} ${(TAGS[tag] ?? '?').padEnd(20)} ${count}`);
}

console.log('');
console.log(`world-level keys: ${namedKeys.size}`);
for (const [name, bytes] of [...namedKeys].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${bytes.toString().padStart(8)}  ${name}`);
}

if (find) {
  console.log('');
  console.log(`matches for ${JSON.stringify(find)}: ${hits.length}`);
  for (const hit of hits.slice(0, 10)) console.log(`  ${hit.bytes.toString().padStart(8)}  ${hit.key}`);
}
