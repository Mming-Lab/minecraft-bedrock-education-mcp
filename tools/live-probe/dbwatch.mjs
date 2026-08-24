// How long does a block change take to reach the world database?
//
//   node dbwatch.mjs <world folder> --block minecraft:lapis_block [--timeout 300]
//
// Reading the database beats every command-based path on capacity - exact block ids, whole
// regions, no round trip per block - but only if what it holds is recent. If an edit takes
// five minutes to land, the model cannot use it to check its own work, and the database is
// an archive rather than a view.
//
// So this watches for a specific block to appear. Start it, then place that block in the
// game; the number it prints is the gap between the two. Nothing about the format is assumed
// beyond what dbchunk.mjs already decodes.
//
// The live database cannot be opened directly - the game holds an exclusive lock - so each
// poll copies it. The copy is small (a hundred KiB or so here) and the cost is measured and
// reported, because it is part of what any implementation would have to pay.

import fs from 'node:fs';
import path from 'node:path';
import { LevelDB } from 'leveldb-zlib';
import nbt from 'prismarine-nbt';

const args = process.argv.slice(2);
const world = path.resolve(args[0] ?? '');
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const wanted = flag('block', 'minecraft:lapis_block');
// Watching for a world-level key instead of a block: '/structure save' writes one, and
// whether it lands immediately or waits for the autosave is a different question from
// whether a placed block does.
const wantedKey = flag('key');
const timeoutSeconds = Number(flag('timeout', '300'));
const interval = Number(flag('interval', '2000'));
const scratch = flag('scratch', path.join(process.env.TEMP ?? '.', 'dbwatch-copy'));

if (!fs.existsSync(path.join(world, 'db'))) {
  console.error(`no db folder under: ${world}`);
  process.exit(2);
}

/** Copies the database out from under the running game, minus its lock. */
function snapshot() {
  const started = Date.now();
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  // Shared read, because the game keeps the log file open for writing.
  for (const entry of fs.readdirSync(path.join(world, 'db'))) {
    if (entry === 'LOCK') continue;
    const from = path.join(world, 'db', entry);
    if (!fs.statSync(from).isFile()) continue;
    const fd = fs.openSync(from, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, 0);
      fs.writeFileSync(path.join(scratch, entry), buffer);
    } finally {
      fs.closeSync(fd);
    }
  }
  return Date.now() - started;
}

function unpack(buffer, offset, bits) {
  const perWord = Math.floor(32 / bits);
  const words = Math.ceil(4096 / perWord);
  const mask = (1 << bits) - 1;
  const indices = new Uint16Array(4096);
  let written = 0;
  for (let w = 0; w < words; w++) {
    const word = buffer.readUInt32LE(offset + w * 4);
    for (let i = 0; i < perWord && written < 4096; i++) indices[written++] = (word >> (i * bits)) & mask;
  }
  return { indices, bytesRead: words * 4 };
}

/** Just the palette - finding whether a block is present needs no index decoding at all. */
async function palettesIn(value) {
  const version = value.readUInt8(0);
  let offset = 1;
  const storages = value.readUInt8(offset++);
  if (version >= 9) offset++;
  const names = [];
  for (let s = 0; s < storages; s++) {
    const header = value.readUInt8(offset++);
    const bits = header >> 1;
    if (bits === 0) continue;
    offset += unpack(value, offset, bits).bytesRead;
    const length = value.readInt32LE(offset);
    offset += 4;
    for (let p = 0; p < length; p++) {
      const parsed = await nbt.parse(value.subarray(offset), 'little');
      names.push(nbt.simplify(parsed.parsed).name);
      offset += parsed.metadata.size;
    }
  }
  return names;
}

async function keyPresent(text) {
  const db = new LevelDB(scratch, { createIfMissing: false });
  await db.open();
  try {
    for await (const [rawKey] of db.getIterator({ keys: true, values: false })) {
      if (Buffer.from(rawKey).toString('latin1').includes(text)) return true;
    }
  } finally {
    await db.close();
  }
  return false;
}

async function present(block) {
  const db = new LevelDB(scratch, { createIfMissing: false });
  await db.open();
  try {
    for await (const [rawKey, value] of db.getIterator({ keys: true, values: true })) {
      const key = Buffer.from(rawKey);
      if (![10, 14].includes(key.length)) continue;
      if (key[key.length === 14 ? 12 : 8] !== 47) continue;
      const names = await palettesIn(Buffer.from(value));
      if (names.includes(block)) return true;
    }
  } finally {
    await db.close();
  }
  return false;
}

console.log('');
console.log(`  watching for ${wantedKey ? `key ~ ${wantedKey}` : wanted}`);
console.log(`  world: ${world}`);
console.log(`  polling every ${interval}ms for up to ${timeoutSeconds}s`);
console.log('');
console.log(`  Place a ${wanted} in the game now. The elapsed time is the answer.`);
console.log('');

// Established before the clock starts, so an already-present block is reported rather than
// counted as a zero-latency write.
const copyMs = snapshot();
if (await (wantedKey ? keyPresent(wantedKey) : present(wanted))) {
  console.log(`${wanted} is ALREADY in the database - pick a block the world does not contain.`);
  process.exit(1);
}
console.log(`  baseline clear (snapshot copy took ${copyMs}ms). Waiting...`);
console.log('');

const startedAt = Date.now();
let polls = 0;
let copyTotal = 0;

while ((Date.now() - startedAt) / 1000 < timeoutSeconds) {
  await new Promise((resolve) => setTimeout(resolve, interval));
  polls++;
  copyTotal += snapshot();
  const elapsed = Date.now() - startedAt;

  if (await (wantedKey ? keyPresent(wantedKey) : present(wanted))) {
    console.log(`FOUND after ${(elapsed / 1000).toFixed(1)}s (${polls} polls)`);
    // Absolute, so it can be subtracted from the moment the rig recorded for the write.
    console.log(`FOUND_AT_EPOCH_MS ${Date.now()}`);
    console.log(`snapshot copy averaged ${Math.round(copyTotal / polls)}ms`);
    console.log('');
    console.log('That gap is the upper bound on how stale a database read can be, and the');
    console.log('lower bound on how soon after an edit the model can confirm it from disk.');
    process.exit(0);
  }
  if (polls % 5 === 0) console.log(`  still absent at ${(elapsed / 1000).toFixed(0)}s`);
}

console.log(`NOT FOUND within ${timeoutSeconds}s.`);
console.log('Either the block was never placed, or edits do not reach the database while the');
console.log('world is open - in which case database reads cannot confirm recent work.');
process.exit(1);
