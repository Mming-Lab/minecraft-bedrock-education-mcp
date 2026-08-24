// Prepares the MakeCode geometry extension so it can be executed outside the editor.
//
// The extension is written against the MakeCode Minecraft API (`Position`, `world()`,
// `player.say`, `Axis`) and lives in a `namespace`, not a module. This script fetches the
// sources, compiles them together with the stubs into one script, and appends a CommonJS
// export so compare.mjs can require the namespace.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_SRC = path.join(HERE, 'ext-src');
const REPO = 'https://github.com/Mming-Lab/makecode-minecraft-geometry-ext.git';

// The comparison is only meaningful against a known revision, so record which one was used.
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

function run(cmd, cmdArgs, cwd) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(' ')} failed:\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  }
  return r.stdout ?? '';
}

// --- obtain the sources ----------------------------------------------------------------
const local = args.get('ext');
if (local) {
  // A local checkout was supplied - use it as-is, patched or not.
  fs.rmSync(EXT_SRC, { recursive: true, force: true });
  fs.mkdirSync(EXT_SRC, { recursive: true });
  fs.cpSync(path.resolve(local, 'src'), path.join(EXT_SRC, 'src'), { recursive: true });
  console.log(`using local checkout: ${path.resolve(local)}`);
} else if (!fs.existsSync(EXT_SRC)) {
  console.log(`cloning ${REPO} ...`);
  run('git', ['clone', '--depth', '1', REPO, EXT_SRC], HERE);
} else {
  console.log('reusing existing ext-src/');
}

let revision = 'unknown (local checkout)';
try {
  revision = run('git', ['rev-parse', '--short', 'HEAD'], EXT_SRC).trim();
} catch {
  /* a copied checkout has no .git; the label above already says so */
}

const coordinates = path.join(EXT_SRC, 'src', 'coordinates.ts');
if (!fs.existsSync(coordinates)) {
  throw new Error(`expected ${coordinates} to exist`);
}

// --- compile ---------------------------------------------------------------------------
const BUILT = path.join(HERE, 'built');
fs.mkdirSync(BUILT, { recursive: true });

const tsconfig = {
  compilerOptions: {
    target: 'ES2020',
    module: 'none',
    strict: false,
    noImplicitAny: false,
    skipLibCheck: true,
    types: [],
    outFile: 'built/ext.js',
  },
  files: ['stubs.ts', path.relative(HERE, coordinates).split(path.sep).join('/')],
};
fs.writeFileSync(path.join(HERE, 'built', 'tsconfig.ext.json'), JSON.stringify(tsconfig, null, 2));
// tsc resolves `files` relative to the config, so keep the config beside the sources.
fs.writeFileSync(path.join(HERE, 'tsconfig.ext.json'), JSON.stringify(tsconfig, null, 2));

const tscEntry = path.join(HERE, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tscEntry)) throw new Error(`typescript not installed. Run \`npm install\` in ${HERE}`);

const tsc = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.ext.json'], { cwd: HERE, encoding: 'utf8' });
const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`;
const errors = output.split(/\r?\n/).filter((l) => l.includes('error TS'));

// `loops` is a MakeCode API used only by simpleFill, which the comparison never calls.
const ACCEPTABLE = /Cannot find name 'loops'/;
const unexpected = errors.filter((e) => !ACCEPTABLE.test(e));
if (unexpected.length) {
  console.error('tsc reported unexpected errors:\n');
  for (const e of unexpected) console.error(`  ${e}`);
  process.exit(1);
}

// --- expose the namespace ---------------------------------------------------------------
const built = path.join(BUILT, 'ext.js');
let js = fs.readFileSync(built, 'utf8');
js += `
// Appended by build.mjs so the namespace can be required from compare.mjs.
if (typeof loops === 'undefined') { var loops = { pause: function () {} }; }
module.exports = { coordinates: coordinates, Position: Position, world: world, Axis: Axis };
`;
const cjs = path.join(BUILT, 'ext.cjs');
fs.writeFileSync(cjs, js, 'utf8');
fs.writeFileSync(path.join(BUILT, 'package.json'), '{ "type": "commonjs" }\n', 'utf8');
fs.writeFileSync(path.join(BUILT, 'REVISION'), `${revision}\n`, 'utf8');

console.log(`build ok: geometry-ext @ ${revision}, ${errors.length} accepted error(s) -> built/ext.cjs`);
