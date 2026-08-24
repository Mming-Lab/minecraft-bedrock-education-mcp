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

console.log('');
console.log(`  this repository   ${ours}`);
console.log(`  installed         ${theirs ?? 'nothing installed'}`);
console.log(`  installing into   ${destination}`);
console.log('');

if (CHECK_ONLY) {
  console.log(theirs === ours ? '  Same version. Nothing to copy.' : '  Different. Run without --check to copy.');
  console.log('');
  console.log('  Note that this compares files on disk. What the game is *running* can be older');
  console.log('  than both: ask the MCP server, with world.bridge_status.');
  console.log('');
  process.exit(0);
}

// Moved aside rather than deleted. Nobody should be editing the installed copy, but "should
// not" is not "does not", and a pack folder is exactly where someone would try a change to
// see what it does.
let movedTo = null;
if (fs.existsSync(destination)) {
  movedTo = `${destination}.replaced-${theirs ?? 'unknown'}`;
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
