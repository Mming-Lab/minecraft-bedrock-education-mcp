// Runs the MCP server's geometry and the MakeCode geometry extension over the same shapes
// and reports where they disagree.
//
// The point is NOT to decide which one wins on count. It is to find the cases where one
// implementation violates an invariant the other satisfies, because those are the places
// the rewrite must not inherit from the weaker side.
//
//   node build.mjs && node compare.mjs
//
// Requires tools/golden-extract to have been built (it provides the MCP side).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const LEGACY = path.join(HERE, '..', 'golden-extract', 'dist-legacy', 'utils');
if (!fs.existsSync(LEGACY)) {
  console.error('The MCP side is not built. Run `npm run extract` in tools/golden-extract first.');
  process.exit(1);
}

const toUrl = (p) => 'file:///' + p.split(path.sep).join('/');
const mcp = await import(toUrl(path.join(LEGACY, 'geometry', 'index.js')));

const ext = require(path.join(HERE, 'built', 'ext.cjs'));
const revision = fs.readFileSync(path.join(HERE, 'built', 'REVISION'), 'utf8').trim();

// --- adapters ---------------------------------------------------------------------------
// The two APIs differ in more than naming, so each pairing below states the mapping
// explicitly rather than assuming the arguments line up.
const P = (x, y, z) => ({ x, y, z });
const W = (x, y, z) => ext.world(x, y, z);
const A = ext.Axis;

/** MakeCode Position[] -> plain {x,y,z}[] */
function fromExt(positions) {
  return positions.map((p) => ({ x: p.getValue(A.X), y: p.getValue(A.Y), z: p.getValue(A.Z) }));
}

const WORLD = { X_MIN: -30000000, X_MAX: 30000000, Y_MIN: -64, Y_MAX: 320, Z_MIN: -30000000, Z_MAX: 30000000 };

function measure(positions) {
  const keys = new Set();
  let dup = 0;
  let nonInteger = 0;
  let nonFinite = 0;
  let outOfBounds = 0;

  for (const { x, y, z } of positions) {
    const k = `${x},${y},${z}`;
    if (keys.has(k)) dup++;
    else keys.add(k);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      nonFinite++;
      continue;
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) nonInteger++;
    if (
      x < WORLD.X_MIN || x > WORLD.X_MAX || y < WORLD.Y_MIN || y > WORLD.Y_MAX ||
      z < WORLD.Z_MIN || z > WORLD.Z_MAX
    ) outOfBounds++;
  }

  return { count: positions.length, distinct: keys.size, dup, nonInteger, nonFinite, outOfBounds, keys };
}

function violations(m) {
  const out = [];
  if (m.nonFinite) out.push(`I9:${m.nonFinite}`);
  if (m.nonInteger) out.push(`I1:${m.nonInteger}`);
  if (m.dup) out.push(`I2:${m.dup}`);
  if (m.outOfBounds) out.push(`I4:${m.outOfBounds}`);
  if (m.count === 0) out.push('I3:empty');
  return out;
}

// --- pairings ----------------------------------------------------------------------------
const pairs = [];
function pair(shape, id, mcpRun, extRun, mapping) {
  pairs.push({ shape, id, mcpRun, extRun, mapping });
}

const C = P(0, 0, 0);
const CE = W(0, 0, 0);

for (const r of [1, 2, 3, 5, 8]) {
  pair('sphere', `r${r}`,
    () => mcp.calculateSpherePositions(C, r),
    () => fromExt(ext.coordinates.getSpherePositions(CE, r, false, 1.0)),
    'identical arguments; density pinned to 1.0 because lower values sample with Math.random()');
  pair('sphere', `r${r}-hollow`,
    () => mcp.calculateSpherePositions(C, r, true),
    () => fromExt(ext.coordinates.getSpherePositions(CE, r, true, 1.0)),
    'identical arguments');
}
pair('sphere', 'r2.5-non-integer',
  () => mcp.calculateSpherePositions(C, 2.5),
  () => fromExt(ext.coordinates.getSpherePositions(CE, 2.5, false, 1.0)),
  'identical arguments');

for (const [R, r] of [[8, 3], [5, 2], [3, 1]]) {
  pair('torus', `R${R}-r${r}`,
    () => mcp.calculateTorusPositions(C, R, r),
    () => fromExt(ext.coordinates.getTorusPositions(CE, R, r)),
    'identical arguments');
  pair('torus', `R${R}-r${r}-hollow`,
    () => mcp.calculateTorusPositions(C, R, r, true),
    () => fromExt(ext.coordinates.getTorusPositions(CE, R, r, true)),
    'identical arguments');
}

for (const [rx, ry, rz] of [[3, 4, 5], [1, 1, 1], [5, 5, 5]]) {
  pair('ellipsoid', `r${rx}-${ry}-${rz}`,
    () => mcp.calculateEllipsoidPositions(C, rx, ry, rz),
    () => fromExt(ext.coordinates.getEllipsoidPositions(CE, rx, ry, rz)),
    'identical arguments');
}

for (const [r, h] of [[3, 5], [5, 10], [1, 1]]) {
  pair('cylinder', `r${r}-h${h}`,
    () => mcp.calculateCylinderPositions(C, r, h, 'y'),
    () => fromExt(ext.coordinates.getCylinderPositions(CE, r, h)),
    'MCP takes an axis parameter and is pinned to "y"; the extension is always vertical');
}

for (const r of [3, 5, 10]) {
  pair('circle', `r${r}`,
    () => mcp.calculateCirclePositions(C, r, 'y'),
    () => fromExt(ext.coordinates.getCirclePositions(CE, r, A.Y)),
    'identical arguments');
  pair('circle', `r${r}-hollow`,
    () => mcp.calculateCirclePositions(C, r, 'y', 0, true),
    () => fromExt(ext.coordinates.getCirclePositions(CE, r, A.Y, true)),
    'MCP has an extra offset parameter, pinned to 0');
}

pair('line', 'diagonal',
  () => mcp.calculateLinePositions(P(0, 0, 0), P(10, 5, 3)),
  () => fromExt(ext.coordinates.getLinePositions(W(0, 0, 0), W(10, 5, 3))),
  'identical arguments');
pair('line', 'axis-x',
  () => mcp.calculateLinePositions(P(0, 0, 0), P(10, 0, 0)),
  () => fromExt(ext.coordinates.getLinePositions(W(0, 0, 0), W(10, 0, 0))),
  'identical arguments');

for (const [h, r, t] of [[10, 3, 2], [20, 5, 4]]) {
  pair('helix', `h${h}-r${r}-t${t}`,
    () => mcp.calculateHelixPositions(C, h, r, t),
    () => fromExt(ext.coordinates.getHelixPositions(CE, r, h, t)),
    'argument order differs: MCP is (start, height, radius, turns), the extension is (center, radius, height, turns)');
}

for (const [r, h] of [[5, 10], [3, 8]]) {
  pair('paraboloid', `r${r}-h${h}`,
    () => mcp.calculateParaboloidPositions(C, r, h),
    () => fromExt(ext.coordinates.getParaboloidPositions(CE, r, h)),
    'identical arguments');
}

// The hyperboloid parameterisations differ in kind, not just in order.
//   MCP:       (center, radius, height, waist)  waist is a RATIO; r(t) = radius * sqrt(waist^2 + t^2)
//              so the waist radius is radius*waist and the end radius is radius*sqrt(waist^2+1)
//   extension: (center, baseRadius, waistRadius, height)  both radii are ABSOLUTE
// Matching them means converting the ratio into the two absolute radii.
for (const [radius, waistRatio, height] of [[5, 0.5, 10], [6, 0.4, 11]]) {
  const waistRadius = radius * waistRatio;
  const baseRadius = radius * Math.sqrt(waistRatio * waistRatio + 1);
  pair('hyperboloid', `r${radius}-w${waistRatio}-h${height}`,
    () => mcp.calculateHyperboloidPositions(C, radius, height, waistRatio),
    () => fromExt(ext.coordinates.getHyperboloidPositions(CE, Math.round(baseRadius), Math.round(waistRadius), height)),
    `MCP waist is a ratio; converted to absolute radii waist=${waistRadius.toFixed(2)} base=${baseRadius.toFixed(2)} (rounded for the extension)`);
}

// --- run ----------------------------------------------------------------------------------
const rows = [];
for (const p of pairs) {
  const id = `${p.shape}/${p.id}`;
  let a = null;
  let b = null;
  let aErr = null;
  let bErr = null;

  try { a = measure(p.mcpRun()); } catch (e) { aErr = String(e.message ?? e); }
  try { b = measure(p.extRun()); } catch (e) { bErr = String(e.message ?? e); }

  let overlap = null;
  if (a && b) {
    let shared = 0;
    for (const k of a.keys) if (b.keys.has(k)) shared++;
    const union = a.keys.size + b.keys.size - shared;
    overlap = union === 0 ? 1 : shared / union;
  }

  rows.push({
    id,
    mapping: p.mapping,
    mcp: a ? { ...a, keys: undefined, violations: violations(a) } : { threw: aErr },
    ext: b ? { ...b, keys: undefined, violations: violations(b) } : { threw: bErr },
    jaccard: overlap,
  });
}

// --- report ---------------------------------------------------------------------------------
const lines = [];
lines.push('# Geometry implementation comparison');
lines.push('');
lines.push(`MCP server \`src/utils/geometry\` vs \`makecode-minecraft-geometry-ext\` @ ${revision}.`);
lines.push('');
lines.push('`overlap` is the Jaccard index of the two coordinate sets: 1.00 means identical,');
lines.push('0.00 means disjoint. A low overlap is not by itself a defect - the two use different');
lines.push('rasterisation strategies - but a violation column that is populated on one side and');
lines.push('empty on the other tells the rewrite which side to follow.');
lines.push('');
lines.push('| case | MCP count / distinct | MCP violations | ext count / distinct | ext violations | overlap |');
lines.push('|---|---|---|---|---|---|');
for (const r of rows) {
  const m = r.mcp.threw ? `threw` : `${r.mcp.count} / ${r.mcp.distinct}`;
  const e = r.ext.threw ? `threw` : `${r.ext.count} / ${r.ext.distinct}`;
  const mv = r.mcp.threw ? r.mcp.threw : (r.mcp.violations.length ? r.mcp.violations.join(' ') : '-');
  const ev = r.ext.threw ? r.ext.threw : (r.ext.violations.length ? r.ext.violations.join(' ') : '-');
  const o = r.jaccard === null ? '-' : r.jaccard.toFixed(2);
  lines.push(`| ${r.id} | ${m} | ${mv} | ${e} | ${ev} | ${o} |`);
}
lines.push('');

// --- where exactly one side is clean ---------------------------------------------------------
const mcpOnly = rows.filter((r) => !r.mcp.threw && !r.ext.threw && r.mcp.violations.length && !r.ext.violations.length);
const extOnly = rows.filter((r) => !r.mcp.threw && !r.ext.threw && !r.mcp.violations.length && r.ext.violations.length);
const both = rows.filter((r) => !r.mcp.threw && !r.ext.threw && r.mcp.violations.length && r.ext.violations.length);

lines.push('## Where the implementations diverge on correctness');
lines.push('');
lines.push(`- only the MCP server violates an invariant: **${mcpOnly.length}** case(s) - follow the extension here`);
lines.push(`- only the extension violates one: **${extOnly.length}** case(s) - follow the MCP server here`);
lines.push(`- both violate one: **${both.length}** case(s) - neither is a safe baseline`);
lines.push(`- both clean: **${rows.length - mcpOnly.length - extOnly.length - both.length}** case(s)`);
lines.push('');
if (mcpOnly.length) {
  lines.push('### MCP server violates, extension does not');
  lines.push('');
  for (const r of mcpOnly) lines.push(`- \`${r.id}\`: ${r.mcp.violations.join(' ')}`);
  lines.push('');
}
if (extOnly.length) {
  lines.push('### Extension violates, MCP server does not');
  lines.push('');
  for (const r of extOnly) lines.push(`- \`${r.id}\`: ${r.ext.violations.join(' ')}`);
  lines.push('');
}
if (both.length) {
  lines.push('### Both violate');
  lines.push('');
  for (const r of both) lines.push(`- \`${r.id}\`: MCP ${r.mcp.violations.join(' ')} / ext ${r.ext.violations.join(' ')}`);
  lines.push('');
}

lines.push('## Argument mappings used');
lines.push('');
lines.push('Where the two APIs do not line up, the pairing states the conversion.');
lines.push('');
const seen = new Set();
for (const r of rows) {
  if (r.mapping === 'identical arguments' || seen.has(r.mapping)) continue;
  seen.add(r.mapping);
  lines.push(`- \`${r.id}\`: ${r.mapping}`);
}
lines.push('');

const out = path.join(HERE, '..', '..', 'tests', 'golden', 'COMPARISON.md');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log(`\nwritten to ${path.relative(path.join(HERE, '..', '..'), out)}`);
