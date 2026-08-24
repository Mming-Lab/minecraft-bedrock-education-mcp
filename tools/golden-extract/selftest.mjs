// The golden suite's own test.
//
// Running the suite against the legacy implementation must FAIL, on exactly the cases whose
// verdict says the rewrite has to diverge. That is the whole point of the `bug-fixed` and
// `undefined-behavior` verdicts: a plain golden test would pass here, and passing here would
// mean the goldens are recording the defects as correct behaviour rather than guarding
// against them.
//
// So this is a CI gate on the gate. If it ever reports zero failures, the inverted assertion
// has stopped working and nothing is being protected.
//
//   node selftest.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, '..', '..', 'tests', 'golden');
const VERDICTS = JSON.parse(fs.readFileSync(path.join(HERE, 'verdicts.json'), 'utf8'));

// --- the non-circular check ---------------------------------------------------------------
//
// Everything below this point compares the verdicts against the validator, which only proves
// the two agree. Downgrading a verdict from `bug-fixed` to `equivalent` would move both
// sides together and pass - which it did, the first time this file was written.
//
// This check reads the *measured* legacy output instead. A case whose recorded output
// violates an invariant must never be marked `equivalent`, because `equivalent` tells the
// rewrite to reproduce it exactly. That is how a defect gets recorded as correct behaviour,
// and no amount of editing verdicts.json can make it look fine.

const recordedAsCorrect = [];

for (const entry of fs.readdirSync(GOLDEN, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'schemas') continue;
  for (const file of fs.readdirSync(path.join(GOLDEN, entry.name))) {
    if (!file.endsWith('.json')) continue;
    const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN, entry.name, file), 'utf8'));
    if (golden.verdict !== 'equivalent') continue;

    const legacy = golden.legacy ?? {};
    const violations = [];
    if (legacy.nonFiniteCount) violations.push(`${legacy.nonFiniteCount} non-finite`);
    if (legacy.nonIntegerCount) violations.push(`${legacy.nonIntegerCount} non-integer`);
    if (legacy.dupCount) violations.push(`${legacy.dupCount} duplicated`);
    if (legacy.outOfBoundsCount) violations.push(`${legacy.outOfBoundsCount} out of bounds`);

    if (violations.length) {
      recordedAsCorrect.push({ case: golden.case, violations });
    }
  }
}

if (recordedAsCorrect.length) {
  console.error('A case with a defective recorded output is marked `equivalent`.');
  console.error('');
  console.error('`equivalent` tells the rewrite to reproduce the legacy output exactly, so');
  console.error('marking one of these as equivalent records the defect as correct behaviour.');
  console.error('');
  for (const r of recordedAsCorrect) {
    console.error(`  ${r.case}: ${r.violations.join(', ')} coordinate(s)`);
  }
  console.error('');
  console.error('Give each a verdict that says the rewrite must diverge: `bug-fixed` if the');
  console.error('output is wrong, `undefined-behavior` if the input should have been rejected.');
  process.exit(1);
}

/** Every verdict that requires the rewrite to behave differently from the legacy code. */
const MUST_DIVERGE = Object.entries(VERDICTS)
  .filter(([key, value]) => key !== '$comment' && (value.verdict === 'bug-fixed' || value.verdict === 'undefined-behavior'))
  .map(([key]) => key);

// The packer's expected failures are not written down anywhere by hand - they are read off
// the measurement. A case whose recorded run covered blocks that were not in the input is a
// case the legacy packer must fail, and no edit to verdicts.json can quietly excuse it.
const coverageFile = path.join(GOLDEN, 'block-optimizer', 'coverage.json');
if (fs.existsSync(coverageFile)) {
  for (const c of JSON.parse(fs.readFileSync(coverageFile, 'utf8'))) {
    if (!c.exact) MUST_DIVERGE.push(`block-optimizer/${c.id}`);
  }
}

const run = spawnSync(
  process.execPath,
  [
    path.join(HERE, 'validate.mjs'),
    '--geometry', './dist-legacy/utils/geometry/index.js',
    '--math', './dist-legacy/utils/math/index.js',
    '--optimizer', './dist-legacy/utils/block-optimizer.js',
  ],
  { cwd: HERE, encoding: 'utf8' }
);

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const summary = output.match(/golden validation: (\d+) passed, (\d+) failed/);

if (!summary) {
  console.error('could not read the validator summary:\n');
  console.error(output);
  process.exit(1);
}

const failed = Number(summary[2]);
const expected = MUST_DIVERGE.length;

console.log(output.split('\n')[0]);
console.log('');

if (failed === 0) {
  console.error('The legacy implementation passed its own goldens.');
  console.error('');
  console.error('That should be impossible: the verdicts mark ' + expected + ' cases where the');
  console.error('rewrite must NOT reproduce the legacy output. Passing means the inverted');
  console.error('assertion has stopped working and the goldens no longer guard anything.');
  process.exit(1);
}

if (failed !== expected) {
  console.error(`Expected ${expected} failures, got ${failed}.`);
  console.error('');
  console.error('Every bug-fixed and undefined-behavior verdict should fail against the legacy');
  console.error('implementation, and nothing else should. A different count means a verdict was');
  console.error('added or removed without the suite being re-checked.');
  console.error('');
  console.error('Cases that must diverge:');
  for (const c of MUST_DIVERGE) console.error(`  ${c}`);
  console.error('');
  console.error('Validator output:');
  console.error(output);
  process.exit(1);
}

// The count matching is necessary but not sufficient - check it is the right cases.
const reportedFailures = [...output.matchAll(/^\s*\[FAIL\]\s+(\S+)/gm)].map((m) => m[1]);
const missing = MUST_DIVERGE.filter((c) => !reportedFailures.includes(c));
const unexpected = reportedFailures.filter((c) => !MUST_DIVERGE.includes(c));

if (missing.length || unexpected.length) {
  console.error('The right number of cases failed, but not the right ones.');
  if (missing.length) {
    console.error('\nShould have failed and did not:');
    for (const c of missing) console.error(`  ${c}`);
  }
  if (unexpected.length) {
    console.error('\nFailed but has no verdict requiring it:');
    for (const c of unexpected) console.error(`  ${c}`);
  }
  process.exit(1);
}

console.log(`self-test ok: the legacy implementation fails on exactly the ${expected} cases`);
console.log('the verdicts say it must, so the inverted assertion is doing its job.');
