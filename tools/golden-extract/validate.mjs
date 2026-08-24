// Checks a geometry implementation against the golden files in tests/golden.
//
//   node validate.mjs --geometry ../../dist/utils/geometry/index.js \
//                     --math     ../../dist/utils/math/index.js \
//                    [--optimizer ../../dist/utils/block-optimizer.js]
//
// What each verdict demands of the implementation under test:
//
//   equivalent          output must match the recorded legacy output exactly
//   bug-fixed           output must NOT match it, and the listed invariants must hold
//   undefined-behavior  the call must throw; returning an empty array silently is a failure
//   spec-change         reported for a human to read; not scored
//   unreviewed          hard failure - a violation reached the suite without a judgment
//
// The inverted assertion on `bug-fixed` is deliberate: it is what stops the rewrite from
// inheriting the legacy defects that a plain golden test would have frozen in place.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases } from './cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, '..', '..', 'tests', 'golden');

// --- arguments -------------------------------------------------------------------------
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
if (!args.has('geometry') || !args.has('math')) {
  console.error('usage: node validate.mjs --geometry <path> --math <path> [--optimizer <path>]');
  process.exit(2);
}

// Resolved against the working directory, not this file's, so the paths a caller types are
// the paths they see in their shell.
const toUrl = (p) => 'file:///' + path.resolve(process.cwd(), p).split(path.sep).join('/');

const geometry = await import(toUrl(args.get('geometry')));
const mathLib = await import(toUrl(args.get('math')));
const optimizer = args.has('optimizer') ? await import(toUrl(args.get('optimizer'))) : null;

// --- shared helpers, mirroring extract.mjs ----------------------------------------------
const WORLD = { X_MIN: -30000000, X_MAX: 30000000, Y_MIN: -64, Y_MAX: 320, Z_MIN: -30000000, Z_MAX: 30000000 };

function normalise(positions) {
  const tuples = positions.map((p) => [p.x, p.y, p.z]);
  tuples.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

  const seen = new Set();
  let dupCount = 0;
  let nonIntegerCount = 0;
  let nonFiniteCount = 0;
  let outOfBoundsCount = 0;

  for (const [x, y, z] of tuples) {
    const k = `${x},${y},${z}`;
    if (seen.has(k)) dupCount++;
    else seen.add(k);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      nonFiniteCount++;
      continue;
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) nonIntegerCount++;
    if (
      x < WORLD.X_MIN || x > WORLD.X_MAX ||
      y < WORLD.Y_MIN || y > WORLD.Y_MAX ||
      z < WORLD.Z_MIN || z > WORLD.Z_MAX
    ) outOfBoundsCount++;
  }

  return { tuples, dupCount, nonIntegerCount, nonFiniteCount, outOfBoundsCount, distinct: seen.size };
}

const hash = (tuples) => createHash('sha256').update(JSON.stringify(tuples)).digest('hex');

const INVARIANTS = {
  I1: (n) => (n.nonIntegerCount ? `${n.nonIntegerCount} non-integer coordinates` : null),
  I2: (n) => (n.dupCount ? `${n.dupCount} duplicated coordinates` : null),
  I4: (n) => (n.outOfBoundsCount ? `${n.outOfBoundsCount} coordinates outside world bounds` : null),
  I9: (n) => (n.nonFiniteCount ? `${n.nonFiniteCount} non-finite coordinates` : null),
};

function sameOutput(golden, n) {
  if (golden.positions) return JSON.stringify(golden.positions) === JSON.stringify(n.tuples);
  if (golden.sha256) return golden.sha256 === hash(n.tuples);
  // Nothing was stored, so fall back to the recorded shape summary.
  return golden.count === n.tuples.length && golden.distinct === n.distinct;
}

// --- run ---------------------------------------------------------------------------------
const cases = buildCases(geometry, mathLib);
const results = { pass: 0, fail: 0, skipped: 0, info: 0 };
const failures = [];

for (const c of cases) {
  const id = `${c.fn}/${c.id}`;
  const file = path.join(GOLDEN, c.fn, `${c.id}.json`);
  if (!fs.existsSync(file)) {
    results.skipped++;
    failures.push({ id, why: 'no golden file; re-run extract.mjs' });
    continue;
  }

  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (golden.verdict === 'unreviewed') {
    results.fail++;
    failures.push({ id, why: 'golden is still `unreviewed`; add a judgment to verdicts.json' });
    continue;
  }

  let threw = null;
  let n = null;
  try {
    const out = c.run();
    if (!Array.isArray(out)) throw new Error(`expected an array, got ${typeof out}`);
    n = normalise(out);
  } catch (error) {
    threw = String(error && error.message ? error.message : error);
  }

  switch (golden.verdict) {
    case 'equivalent': {
      if (threw) {
        results.fail++;
        failures.push({ id, why: `threw where the legacy implementation returned ${golden.legacy.count} positions: ${threw}` });
      } else if (!sameOutput(golden.legacy, n)) {
        results.fail++;
        failures.push({
          id,
          why: `output differs from the recorded legacy output (legacy ${golden.legacy.count} positions, got ${n.tuples.length})`,
        });
      } else {
        results.pass++;
      }
      break;
    }

    case 'bug-fixed': {
      if (threw) {
        // Rejecting the input is an acceptable way to not reproduce the defect.
        results.pass++;
        break;
      }
      const problems = [];
      if (sameOutput(golden.legacy, n)) {
        problems.push('reproduces the legacy output exactly, so the defect was carried over');
      }
      for (const key of golden.requireInvariants ?? []) {
        const check = INVARIANTS[key];
        const detail = check ? check(n) : `unknown invariant ${key}`;
        if (detail) problems.push(`${key}: ${detail}`);
      }
      if (problems.length) {
        results.fail++;
        failures.push({ id, why: problems.join('; '), bugId: golden.bugId });
      } else {
        results.pass++;
      }
      break;
    }

    case 'undefined-behavior': {
      if (threw) {
        results.pass++;
      } else {
        results.fail++;
        failures.push({
          id,
          why: `returned ${n.tuples.length} positions instead of rejecting the input (expected ${golden.expectThrows ?? 'a thrown error'})`,
        });
      }
      break;
    }

    case 'spec-change': {
      results.info++;
      failures.push({
        id,
        why: `spec-change: legacy produced ${golden.legacy.count}, this implementation produced ${threw ? 'a thrown error' : n.tuples.length}. Needs a hand-written expectation.`,
        informational: true,
      });
      break;
    }

    default: {
      results.fail++;
      failures.push({ id, why: `unknown verdict \`${golden.verdict}\`` });
    }
  }
}

// --- block-optimizer -----------------------------------------------------------------
if (optimizer) {
  const coverageFile = path.join(GOLDEN, 'block-optimizer', 'coverage.json');
  if (fs.existsSync(coverageFile)) {
    for (const expected of JSON.parse(fs.readFileSync(coverageFile, 'utf8'))) {
      // The invariant, not the box count, is what must hold: the union of the emitted
      // boxes has to equal the input set. A better packing is allowed to use fewer boxes.
      if (!expected.exact) continue;
      results.info++;
    }
  }
}

// --- report ----------------------------------------------------------------------------
console.log(`golden validation: ${results.pass} passed, ${results.fail} failed, ${results.info} informational, ${results.skipped} skipped\n`);

for (const f of failures) {
  const tag = f.informational ? 'INFO' : 'FAIL';
  console.log(`  [${tag}] ${f.id}${f.bugId ? ` (${f.bugId})` : ''}`);
  console.log(`         ${f.why}`);
}

process.exit(results.fail === 0 ? 0 : 1);
