// Extracts expected output from the legacy geometry implementation so the rewrite can be
// measured against it.
//
// Golden files are NOT automatically treated as "correct". Each case carries a verdict:
//
//   equivalent          the rewrite must match exactly
//   bug-fixed           the rewrite must NOT match; the legacy output is defective
//   undefined-behavior  the rewrite must reject the input instead of returning silently
//   unreviewed          not yet judged; the suite fails while any of these remain
//
// The `bug-fixed` verdict is the point of this design: a plain golden test would freeze
// the legacy bugs into the new implementation.
//
//   node extract.mjs

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEGACY = path.join(HERE, 'dist-legacy', 'utils');
const OUT = path.join(HERE, '..', '..', 'tests', 'golden');

// Human judgments live apart from the extracted data so re-running never overwrites them.
const VERDICTS = JSON.parse(fs.readFileSync(path.join(HERE, 'verdicts.json'), 'utf8'));

const geometry = await import(pathToUrl(path.join(LEGACY, 'geometry', 'index.js')));
const mathLib = await import(pathToUrl(path.join(LEGACY, 'math', 'index.js')));
const optimizer = await import(pathToUrl(path.join(LEGACY, 'block-optimizer.js')));

function pathToUrl(p) {
  return 'file:///' + p.split(path.sep).join('/');
}

// --- world bounds, mirrored from src/utils/geometry/coordinate-utils.ts ---------------
const WORLD = { X_MIN: -30000000, X_MAX: 30000000, Y_MIN: -64, Y_MAX: 320, Z_MIN: -30000000, Z_MAX: 30000000 };

const LARGE_CASE_THRESHOLD = 2000;

// --- normalisation --------------------------------------------------------------------
// Duplicates are kept, not removed: whether the legacy code emits them is part of what is
// being recorded. Non-integer coordinates are kept unrounded for the same reason.
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

  // Only meaningful when every coordinate is finite; a NaN cannot be a grid neighbour.
  const components = nonFiniteCount === 0 && tuples.length > 0 ? componentCount(tuples) : 1;

  return { tuples, dupCount, nonIntegerCount, nonFiniteCount, outOfBoundsCount, components, distinct: seen.size };
}

function diagnostics(tuples) {
  if (tuples.length === 0) return null;
  const finite = tuples.filter(([x, y, z]) => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
  if (finite.length === 0) return null;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const sum = [0, 0, 0];
  for (const t of finite) {
    for (let i = 0; i < 3; i++) {
      if (t[i] < min[i]) min[i] = t[i];
      if (t[i] > max[i]) max[i] = t[i];
      sum[i] += t[i];
    }
  }
  return {
    bbox: { min, max },
    centroid: sum.map((s) => Number((s / finite.length).toFixed(6))),
  };
}

function hash(tuples) {
  return createHash('sha256').update(JSON.stringify(tuples)).digest('hex');
}

// --- invariants -----------------------------------------------------------------------
// A case that violates none of these is safe to promote to `equivalent` without a human
// reading it. A case that violates one is queued for review.
/**
 * How many separate pieces the blocks fall into, treating diagonal contact as touching.
 *
 * A shape in more than one piece is not buildable as one thing. This was added after a
 * property test found that a flat helix - a wide radius over a short rise - came out in two
 * or three pieces, at parameters no fixed case happened to cover.
 */
function componentCount(tuples) {
  const remaining = new Set(tuples.map(([x, y, z]) => `${x},${y},${z}`));
  let count = 0;

  while (remaining.size) {
    count++;
    const first = remaining.values().next().value;
    remaining.delete(first);
    const queue = [first.split(',').map(Number)];

    while (queue.length) {
      const [x, y, z] = queue.pop();
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const k = `${x + dx},${y + dy},${z + dz}`;
            if (remaining.delete(k)) queue.push(k.split(',').map(Number));
          }
    }
  }
  return count;
}

function invariantViolations(n) {
  const out = [];
  if (n.nonFiniteCount) out.push(`I9:non-finite(${n.nonFiniteCount})`);
  if (n.nonIntegerCount) out.push(`I1:non-integer(${n.nonIntegerCount})`);
  if (n.dupCount) out.push(`I2:duplicates(${n.dupCount})`);
  if (n.outOfBoundsCount) out.push(`I4:out-of-bounds(${n.outOfBoundsCount})`);
  if (n.components > 1) out.push(`I5:disconnected(${n.components})`);
  return out;
}

// --- case matrix (shared with validate.mjs) ------------------------------------------
import { buildCases, buildOptimizerCases } from './cases.mjs';

const cases = buildCases(geometry, mathLib);

const P = (x, y, z) => ({ x, y, z });
const C = P(0, 0, 0);
const g = geometry;

// --- run ------------------------------------------------------------------------------
// Clear only the directories this script owns. `tests/golden` also holds output from
// geometry-compare and dump-schemas, and wiping the tree wholesale silently destroyed
// theirs.
for (const owned of new Set(cases.map((c) => c.fn))) {
  fs.rmSync(path.join(OUT, owned), { recursive: true, force: true });
}
fs.rmSync(path.join(OUT, 'block-optimizer'), { recursive: true, force: true });
fs.rmSync(path.join(OUT, 'REPORT.md'), { force: true });

const summary = { equivalent: 0, unreviewed: 0, 'undefined-behavior': 0, error: 0 };
const review = [];
let written = 0;

for (const c of cases) {
  const dir = path.join(OUT, c.fn);
  fs.mkdirSync(dir, { recursive: true });

  let record;
  try {
    const result = c.run();
    if (!Array.isArray(result)) throw new Error(`expected an array, got ${typeof result}`);

    const n = normalise(result);
    const violations = invariantViolations(n);
    const emptyProblem = result.length === 0 && !c.expectEmpty;

    let verdict;
    if (result.length === 0 && c.expectEmpty) {
      verdict = 'undefined-behavior';
    } else if (violations.length || emptyProblem) {
      verdict = 'unreviewed';
      review.push({
        case: `${c.fn}/${c.id}`,
        violations: emptyProblem ? [...violations, 'I3:empty-for-valid-input'] : violations,
        note: c.note,
      });
    } else {
      verdict = 'equivalent';
    }

    record = {
      case: `${c.fn}/${c.id}`,
      verdict,
      note: c.note,
      legacy: {
        count: result.length,
        distinct: n.distinct,
        dupCount: n.dupCount,
        nonIntegerCount: n.nonIntegerCount,
        nonFiniteCount: n.nonFiniteCount,
        outOfBoundsCount: n.outOfBoundsCount,
        components: n.components,
        ...diagnostics(n.tuples),
      },
    };

    if (n.tuples.length <= LARGE_CASE_THRESHOLD) {
      record.legacy.positions = n.tuples;
    } else {
      record.legacy.sha256 = hash(n.tuples);
      record.legacy.storage = 'hash-only';
    }

    const override = VERDICTS[`${c.fn}/${c.id}`];
    if (override) {
      verdict = override.verdict;
      record.verdict = verdict;
      record.bugId = override.bugId;
      record.rationale = override.rationale;
      record.reference = override.reference;
      if (override.requireInvariants) record.requireInvariants = override.requireInvariants;
      if (override.expectThrows) record.expectThrows = override.expectThrows;
    }
    summary[verdict] = (summary[verdict] || 0) + 1;
  } catch (error) {
    record = {
      case: `${c.fn}/${c.id}`,
      verdict: 'unreviewed',
      note: c.note,
      legacy: { threw: String(error && error.message ? error.message : error) },
    };
    review.push({ case: `${c.fn}/${c.id}`, violations: ['THREW'], note: c.note });
    summary.error++;
  }

  fs.writeFileSync(path.join(dir, `${c.id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
  written++;
}

// --- block-optimizer: the union of the emitted boxes must equal the input set ----------
const optimizerCases = [];
function optimizerCase(id, positions, note) {
  const result = optimizer.optimizeBlocks(positions);
  const inputKeys = new Set(positions.map((p) => `${p.x},${p.y},${p.z}`));
  const covered = new Set();
  let overlaps = 0;
  for (const r of result.rectangles ?? []) {
    for (let x = r.from.x; x <= r.to.x; x++)
      for (let y = r.from.y; y <= r.to.y; y++)
        for (let z = r.from.z; z <= r.to.z; z++) {
          const k = `${x},${y},${z}`;
          if (covered.has(k)) overlaps++;
          covered.add(k);
        }
  }
  const missing = [...inputKeys].filter((k) => !covered.has(k)).length;
  const extra = [...covered].filter((k) => !inputKeys.has(k)).length;
  optimizerCases.push({
    id,
    note,
    inputCount: positions.length,
    distinctInput: inputKeys.size,
    boxes: (result.rectangles ?? []).length,
    covered: covered.size,
    missing,
    extra,
    overlaps,
    exact: missing === 0 && extra === 0,
  });
}

// The inputs come from cases.mjs, built by plain loops rather than by either geometry
// module, so that this run and the validating one pack identical blocks.
for (const c of buildOptimizerCases()) optimizerCase(c.id, c.positions, c.note);

fs.mkdirSync(path.join(OUT, 'block-optimizer'), { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'block-optimizer', 'coverage.json'),
  JSON.stringify(optimizerCases, null, 2) + '\n',
  'utf8'
);

// --- report ---------------------------------------------------------------------------
const lines = [];
lines.push('# Golden extraction report');
lines.push('');
lines.push(`Generated from the legacy implementation at \`src/utils/\`.`);
lines.push('');
lines.push(`- cases written: ${written}`);
for (const k of Object.keys(summary).sort()) {
  if (k === 'error' || summary[k] === 0) continue;
  lines.push(`- ${k}: ${summary[k]}`);
}
if (summary.error) lines.push(`- threw: ${summary.error}`);
lines.push('');
lines.push('## Cases that violated an invariant');
lines.push('');
lines.push('These were not promoted to `equivalent` automatically. Each carries a verdict');
lines.push('recorded in `verdicts.json`; anything still `unreviewed` fails the suite by design.');
lines.push('');
lines.push('| case | violations | verdict | rationale |');
lines.push('|---|---|---|---|');
for (const r of review) {
  const v = VERDICTS[r.case];
  const verdict = v ? v.verdict : '**unreviewed**';
  const why = v && v.rationale ? v.rationale.split('. ')[0] + '.' : (r.note ?? '');
  lines.push(`| ${r.case} | ${r.violations.join(', ')} | ${verdict} | ${why} |`);
}
lines.push('');
lines.push('## block-optimizer coverage');
lines.push('');
lines.push('The union of the emitted boxes must equal the input set exactly.');
lines.push('');
lines.push('| case | input | distinct | boxes | covered | missing | extra | overlaps | exact |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const o of optimizerCases) {
  lines.push(
    `| ${o.id} | ${o.inputCount} | ${o.distinctInput} | ${o.boxes} | ${o.covered} | ${o.missing} | ${o.extra} | ${o.overlaps} | ${o.exact ? 'yes' : '**NO**'} |`
  );
}
lines.push('');

fs.writeFileSync(path.join(OUT, 'REPORT.md'), lines.join('\n'), 'utf8');

console.log(lines.join('\n'));
