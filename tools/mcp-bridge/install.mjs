// Copies the bridge add-on into Minecraft Education's pack folder.
//
//   node install.mjs            # copy, and say what to do next
//   node install.mjs --check    # report what is installed, change nothing
//
// Worth a script rather than a line in a README for one reason: the step people get wrong is
// not the copying, it is what has to happen afterwards. Pack folders are scanned when
// Minecraft launches and at no other time, so replacing these files while the game is open
// changes nothing at all - reloading the world keeps the script that was loaded at startup.
//
// That is not hypothetical. This project spent a day believing the add-on had been switched
// from broadcasting to private messages, because the files said so. The game was still
// running the old script, and every reply was going to the whole world.
//
// So the script checks what is already there, reports what it is replacing, and ends with the
// restart rather than with "done".

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_ONLY = process.argv.includes('--check');

/**
 * Where Education Edition keeps behaviour packs on Windows.
 *
 * It is a UWP app, so this lives under Packages rather than anywhere a person would look.
 * `development_behavior_packs` rather than `behavior_packs` because the development folder
 * takes a plain directory, while the other expects packaged, signed content.
 */
function packFolder() {
  const local = process.env['LOCALAPPDATA'];
  if (!local) return null;
  return path.join(
    local,
    'Packages',
    'Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe',
    'LocalState',
    'games',
    'com.mojang',
    'development_behavior_packs'
  );
}

/** The version a manifest declares, as `0.2.0`. */
function versionOf(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest.header?.version?.join('.') ?? 'unreadable';
  } catch {
    return null;
  }
}

/** What the script itself claims, which can differ from its manifest and is what actually runs. */
function scriptVersion(scriptPath) {
  try {
    return /const VERSION = '([^']+)'/.exec(fs.readFileSync(scriptPath, 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Copies of this pack that individual worlds are carrying.
 *
 * Minecraft copies an applied pack into the world folder, and a world that was set up with an
 * older build keeps that older build next to its database. Whether the game prefers it or the
 * development folder is not something to reason about from the outside - so they are listed,
 * with what each one says, and the answer comes from `world.bridge_status` instead.
 *
 * Worth listing even when they turn out to be ignored: two stale copies and a fresh one, with
 * the game running a fourth version, is exactly the situation in which a guess feels safe.
 */
function worldCopies() {
  const local = process.env['LOCALAPPDATA'];
  if (!local) return [];
  const worlds = path.join(
    local,
    'Packages',
    'Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe',
    'LocalState',
    'games',
    'com.mojang',
    'minecraftWorlds'
  );
  if (!fs.existsSync(worlds)) return [];

  const found = [];
  for (const entry of fs.readdirSync(worlds)) {
    const pack = path.join(worlds, entry, 'behavior_packs', 'mcp-bridge');
    if (!fs.existsSync(pack)) continue;
    let name = entry;
    try {
      name = fs.readFileSync(path.join(worlds, entry, 'levelname.txt'), 'utf8').trim() || entry;
    } catch {
      /* the folder name will do */
    }
    found.push({
      world: name,
      path: pack,
      manifest: versionOf(path.join(pack, 'manifest.json')),
      script: scriptVersion(path.join(pack, 'scripts', 'main.js')),
    });
  }
  return found;
}

/** The pack's identity, which is what Minecraft actually matches on. */
function uuidOf(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).header?.uuid ?? null;
  } catch {
    return null;
  }
}

/** Whether the game is open, which decides whether touching world folders is a good idea. */
function minecraftIsRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq Minecraft.Windows.exe" /NH', { encoding: 'utf8' });
    return out.includes('Minecraft.Windows.exe');
  } catch {
    return false;
  }
}

const source = HERE;
const target = packFolder();

if (!target) {
  console.error('LOCALAPPDATA is not set, so this is not a Windows install of Education Edition.');
  console.error('Copy this folder into the game\'s development_behavior_packs by hand.');
  process.exit(1);
}

if (!fs.existsSync(target)) {
  console.error(`Minecraft Education's pack folder is not where it should be:\n  ${target}`);
  console.error('Has the game been installed and run at least once?');
  process.exit(1);
}

const destination = path.join(target, 'mcp-bridge');
const ours = versionOf(path.join(source, 'manifest.json'));
const theirs = fs.existsSync(destination) ? versionOf(path.join(destination, 'manifest.json')) : null;

const ourScript = scriptVersion(path.join(source, 'scripts', 'main.js'));
const theirScript = fs.existsSync(destination) ? scriptVersion(path.join(destination, 'scripts', 'main.js')) : null;
const ourUuid = uuidOf(path.join(source, 'manifest.json'));
const worlds = worldCopies();
const running = minecraftIsRunning();

console.log('');
console.log(`  this repository   manifest ${ours}   script ${ourScript}`);
console.log(`  installed         manifest ${theirs ?? '-'}   script ${theirScript ?? '-'}`);
console.log(`  installing into   ${destination}`);
console.log('');

if (worlds.length) {
  // Listed rather than acted on. Which copy the game prefers is not decidable from here, and
  // a stale one next to a fresh one is exactly the situation where a guess feels safe.
  console.log('  Worlds carrying their own copy of this pack:');
  for (const copy of worlds) {
    console.log(`    ${copy.world}  —  manifest ${copy.manifest ?? '-'}, script ${copy.script ?? '-'}`);
  }
  console.log('');
  console.log('  These are not touched. If the game turns out to be running one of them rather');
  console.log('  than the copy above, re-apply the pack to the world from inside Minecraft.');
  console.log('  world.bridge_status reports which version is actually running - it is the only');
  console.log('  thing here that can.');
  console.log('');
}

const duplicates = fs
  .readdirSync(target, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'mcp-bridge')
  .map((entry) => ({ name: entry.name, uuid: uuidOf(path.join(target, entry.name, 'manifest.json')) }))
  .filter((entry) => entry.uuid !== null && entry.uuid === ourUuid);

if (duplicates.length) {
  // Silent when it happens, and it looks like the install simply not having worked: the game
  // reports a version that is in none of the folders anyone was looking at.
  console.log('  OTHER FOLDERS HERE CLAIM THE SAME PACK UUID:');
  for (const entry of duplicates) console.log(`    ${entry.name}`);
  console.log('');
  console.log('  Minecraft identifies a pack by its UUID, not its folder name, and it scans every');
  console.log('  directory here. With two claiming the same one, which gets loaded is not yours to');
  console.log('  choose. Move these somewhere outside com.mojang.');
  console.log('');
}

if (running) {
  console.log('  Minecraft is open. That is fine for copying, and not fine for believing the');
  console.log('  result: the running game keeps the script it loaded at startup either way.');
  console.log('');
}

if (CHECK_ONLY) {
  console.log(theirs === ours ? '  Same version. Nothing to copy.' : '  Different. Run without --check to copy.');
  console.log('');
  console.log('  Note that this compares files on disk. What the game is *running* can be older');
  console.log('  than both: ask the MCP server, with world.bridge_status.');
  console.log('');
  process.exit(0);
}

// Moved aside rather than deleted - and moved *out of the scanned folder*, which the first
// version of this got wrong and cost two restarts to find.
//
// Minecraft identifies a pack by the UUID in its manifest, not by its folder name, and it
// walks every directory under development_behavior_packs. Leaving the old copy next to the new
// one under a different name therefore leaves two packs claiming the same UUID, and the game
// picks one. It picked the old one, and a restart that should have brought in 0.2.0 kept
// answering 0.1.0 out of a folder called mcp-bridge.replaced-0.0.1.
//
// So the backup goes above com.mojang, where nothing scans.
let movedTo = null;
if (fs.existsSync(destination)) {
  const backups = path.join(target, '..', '..', '..', 'mcp-bridge-backups');
  fs.mkdirSync(backups, { recursive: true });
  movedTo = path.join(backups, `replaced-${theirs ?? 'unknown'}-script-${theirScript ?? 'unknown'}`);
  fs.rmSync(movedTo, { recursive: true, force: true });
  fs.renameSync(destination, movedTo);
}

fs.mkdirSync(destination, { recursive: true });
for (const entry of ['manifest.json', 'scripts']) {
  fs.cpSync(path.join(source, entry), path.join(destination, entry), { recursive: true });
}

console.log(`  Copied — the files on disk are now ${ours}.`);
if (movedTo !== null) console.log(`  The previous ${theirs} is at ${path.basename(movedTo)}, next to it.`);
console.log('');
console.log('  Two things still have to happen, and neither is automatic:');
console.log('');
console.log('  1. Close Minecraft Education completely and open it again.');
console.log('     Pack folders are only scanned at startup. Reloading the world is NOT enough,');
console.log('     and this is the step that gets skipped - the game will keep running the old');
console.log('     script and give no sign that it is doing so.');
console.log('');
console.log('  2. In the world settings, under Behavior Packs, activate "MCP Bridge".');
console.log('     A world that has never had it activated will not load it.');
console.log('');
console.log('  Then check it took, rather than assuming: ask the MCP server for');
console.log('  world.bridge_status, which reports the version the game is actually running.');
console.log('');
