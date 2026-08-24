// Turns on a world experiment that the Education Edition UI does not expose.
//
//   node set-experiment.mjs <world folder> [--flag gametest] [--dry-run]
//
// Behavior packs load in this world - a .mcfunction in one ran and its chat line came back -
// but no script in any of twelve packs, each declaring a different @minecraft/server version
// from 1.9.0 to 2.1.0, has ever executed. Twelve versions failing identically is not a
// manifest problem, and the packs are all kept in world_behavior_packs.json, so they are not
// being rejected either. Pack content runs; script modules do not.
//
// level.dat says why, most likely: `experiments` holds only
//
//   { experiments_ever_used: 0, saved_with_toggled_experiments: 0 }
//
// with no `gametest` key. That is the flag Bedrock gates the scripting runtime behind, and
// the game's "コーディングとスクリプティング" screen offers only Code Builder, console commands
// and command blocks - all three already on. There is no way to set it from inside the game.
//
// Writing it here is the standard mechanism, not a hack: this is the field the toggle would
// set. It is still a modification to a world file, so both level.dat and level.dat_old are
// copied first, and --dry-run prints the change without making it.
//
// Minecraft must be closed. The game holds level.dat open and rewrites it on save, so a
// change made while it runs is either refused or overwritten.

import fs from 'node:fs';
import path from 'node:path';
import nbt from 'prismarine-nbt';

const args = process.argv.slice(2);
const world = path.resolve(args[0] ?? '');
const flagIndex = args.indexOf('--flag');
const FLAG = flagIndex >= 0 ? args[flagIndex + 1] : 'gametest';
const DRY = args.includes('--dry-run');

const levelDat = path.join(world, 'level.dat');
if (!fs.existsSync(levelDat)) {
  console.error(`no level.dat under: ${world}`);
  process.exit(2);
}

// The game keeps level.dat open while a world is loaded. Refusing here is better than
// writing something the next save silently discards.
try {
  const handle = fs.openSync(levelDat, 'r+');
  fs.closeSync(handle);
} catch (error) {
  console.error('\nlevel.dat is locked - Minecraft is still running. Close it completely and try again.');
  console.error(`(${error.message})`);
  process.exit(1);
}

const raw = fs.readFileSync(levelDat);
// An 8-byte header - a version int and the payload length - sits before the NBT.
const header = raw.subarray(0, 8);
const payload = raw.subarray(8);

const parsed = await nbt.parse(payload, 'little');
const before = nbt.simplify(parsed.parsed).experiments ?? {};

console.log('');
console.log(`world: ${world}`);
console.log(`experiments before: ${JSON.stringify(before)}`);

if (before[FLAG] === 1) {
  console.log(`\n${FLAG} is already on. Nothing to do.`);
  process.exit(0);
}

// The three fields the in-game toggle sets together. Setting only the flag leaves the world
// looking untouched to the game, which then has no reason to honour it.
const experiments = parsed.parsed.value.experiments;
if (!experiments || experiments.type !== 'compound') {
  console.error('\nlevel.dat has no experiments compound; this world is not shaped as expected.');
  process.exit(1);
}
experiments.value[FLAG] = { type: 'byte', value: 1 };
experiments.value.experiments_ever_used = { type: 'byte', value: 1 };
experiments.value.saved_with_toggled_experiments = { type: 'byte', value: 1 };

const after = Object.fromEntries(Object.entries(experiments.value).map(([k, v]) => [k, v.value]));
console.log(`experiments after:  ${JSON.stringify(after)}`);

if (DRY) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

// Both files, because the game rotates between them and restoring only one would leave a
// mismatched pair.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(world, `level.dat.backup-${stamp}`);
fs.copyFileSync(levelDat, backup);
if (fs.existsSync(path.join(world, 'level.dat_old'))) {
  fs.copyFileSync(path.join(world, 'level.dat_old'), `${backup}_old`);
}

const rewritten = nbt.writeUncompressed(parsed.parsed, 'little');
const newHeader = Buffer.from(header);
newHeader.writeInt32LE(rewritten.length, 4);
fs.writeFileSync(levelDat, Buffer.concat([newHeader, rewritten]));

console.log('');
console.log(`backup:  ${path.basename(backup)}`);
console.log(`written: level.dat (${rewritten.length} bytes of NBT)`);
console.log('');
console.log(`${FLAG} is on. Start Minecraft, open the world, and the scripts should run.`);
console.log('If the world refuses to open, restore the backup over level.dat.');
