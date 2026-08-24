// Compiles the legacy geometry sources to JavaScript so extract.mjs can run them.
//
// tsc exits non-zero because src/utils/i18n/locale-manager.ts references `process` without
// @types/node. That does not stop emit (noEmitOnError is off), so the build is allowed to
// continue - but only for those exact errors. Any new error means the legacy sources
// changed underneath the goldens, and swallowing it would let the extraction silently
// record output from a different codebase.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Errors that are known, understood, and do not affect the emitted geometry code. */
const ACCEPTED = [
  "../../src/utils/i18n/locale-manager.ts(53,21): error TS2591: Cannot find name 'process'.",
  "../../src/utils/i18n/locale-manager.ts(59,24): error TS2591: Cannot find name 'process'.",
  "../../src/utils/i18n/locale-manager.ts(59,44): error TS2591: Cannot find name 'process'.",
];

// Run tsc through Node directly rather than through npx: no shell, so no quoting concerns
// and no deprecation warning about unescaped arguments.
const tscEntry = path.join(HERE, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tscEntry)) {
  console.error(`typescript is not installed at ${tscEntry}. Run \`npm install\` first.`);
  process.exit(1);
}

const tsc = spawnSync(process.execPath, [tscEntry, '-p', '.'], {
  cwd: HERE,
  encoding: 'utf8',
});

const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`;
const errorLines = output
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.includes('error TS'));

// Compare on the message prefix only: the trailing "Do you need to install..." hint is
// noise that varies between TypeScript releases.
const unexpected = errorLines.filter(
  (line) => !ACCEPTED.some((accepted) => line.startsWith(accepted))
);

if (unexpected.length) {
  console.error('tsc reported errors that are not on the accepted list:\n');
  for (const line of unexpected) console.error(`  ${line}`);
  console.error('\nThe legacy sources may have changed. Re-check before regenerating goldens.');
  process.exit(1);
}

const missing = ACCEPTED.filter(
  (accepted) => !errorLines.some((line) => line.startsWith(accepted))
);
if (missing.length) {
  console.error('Expected errors no longer occur, so the accepted list is stale:\n');
  for (const line of missing) console.error(`  ${line}`);
  console.error('\nUpdate ACCEPTED in build.mjs to match reality.');
  process.exit(1);
}

// tsc emits CommonJS, but this package is "type": "module". The marker keeps Node from
// treating the emitted .js files as ES modules.
const distDir = path.join(HERE, 'dist-legacy');
if (!fs.existsSync(distDir)) {
  console.error('tsc produced no output directory');
  process.exit(1);
}
fs.writeFileSync(path.join(distDir, 'package.json'), '{ "type": "commonjs" }\n', 'utf8');

const emitted = fs.readdirSync(path.join(distDir, 'utils', 'geometry')).filter((f) => f.endsWith('.js'));
console.log(`build ok: ${errorLines.length} accepted error(s), ${emitted.length} geometry modules emitted`);
