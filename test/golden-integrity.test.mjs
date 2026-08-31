// The one check that stops a defect being recorded as correct behaviour.
//
//   node test/golden-integrity.test.mjs
//
// Every golden case carries a verdict. `equivalent` means "the rewrite must reproduce the
// legacy output exactly", which is the right thing to say about most of them and a disaster to
// say about the rest: the legacy geometry had ten known defects, and a case whose recorded
// output contains one of them must never be marked `equivalent`, or the rewrite is being
// instructed to reproduce the bug.
//
// This was half of the golden suite's self-test. The other half ran the legacy build and
// asserted that exactly the cases marked `bug-fixed` failed against it - a good check, and one
// that could only run while the legacy sources were in the tree. They are not any more.
//
// The half that survived is the half that mattered. Its own README said so: comparing verdicts
// against a validator that reads the same verdicts only proves the two agree, and downgrading
// a verdict moves both sides together and passes. This reads the *measured* legacy output
// instead - the counts recorded when the legacy code was actually run - so no amount of
// editing a verdict can make a defective case look fine.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'golden');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

console.log('golden integrity');

test('no case with a defective recorded output is marked equivalent', () => {
  const recordedAsCorrect = [];

  for (const entry of fs.readdirSync(GOLDEN, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of fs.readdirSync(path.join(GOLDEN, entry.name))) {
      if (!file.endsWith('.json')) continue;
      const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN, entry.name, file), 'utf8'));
      if (golden.verdict !== 'equivalent') continue;

      // Measured when the legacy code was run, not derived from the verdict - which is the
      // whole point. These four are the defect classes the rewrite was built to fix.
      const legacy = golden.legacy ?? {};
      const violations = [];
      if (legacy.nonFiniteCount) violations.push(`${legacy.nonFiniteCount} non-finite`);
      if (legacy.nonIntegerCount) violations.push(`${legacy.nonIntegerCount} non-integer`);
      if (legacy.dupCount) violations.push(`${legacy.dupCount} duplicated`);
      if (legacy.outOfBoundsCount) violations.push(`${legacy.outOfBoundsCount} out of bounds`);

      if (violations.length) recordedAsCorrect.push(`${golden.case}: ${violations.join(', ')}`);
    }
  }

  if (recordedAsCorrect.length) {
    throw new Error(
      `a case with a defective recorded output is marked \`equivalent\`, which tells the rewrite ` +
        `to reproduce the defect:\n       ${recordedAsCorrect.join('\n       ')}\n       ` +
        `Give each a verdict that says the rewrite must diverge: \`bug-fixed\` if the output is ` +
        `wrong, \`undefined-behavior\` if the input should have been rejected.`
    );
  }
});

test('every case still carries a verdict', () => {
  // The goldens are frozen now - nothing regenerates them - so a case that lost its verdict
  // would silently stop being checked by the rule above rather than failing loudly.
  //
  // A `case` field is what makes a file a case. `block-optimizer/coverage.json` sits in the
  // same tree and is not one - it records which shapes the packer was measured against, and
  // the validator reads it separately.
  const missing = [];
  for (const entry of fs.readdirSync(GOLDEN, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of fs.readdirSync(path.join(GOLDEN, entry.name))) {
      if (!file.endsWith('.json')) continue;
      const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN, entry.name, file), 'utf8'));
      if (golden.case === undefined) continue;
      if (!golden.verdict) missing.push(`${entry.name}/${file}`);
    }
  }
  assertEmpty(missing, 'cases with no verdict');
});

function assertEmpty(list, what) {
  if (list.length) throw new Error(`${list.length} ${what}: ${list.slice(0, 5).join(', ')}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
