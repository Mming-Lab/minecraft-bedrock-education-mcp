// Property tests for the geometry.
//
// The goldens pin specific shapes to specific outputs. That catches a change, but only where
// a case exists — every bug the golden extraction recorded was found at some
// radius nobody had thought to try. A fractional radius, an odd height, a waist of zero:
// each was a hole in the parameter space rather than a mistake in a formula.
//
// So these check properties that must hold for every input, and let fast-check search for
// the input that breaks them.
//
//   node test/geometry.property.test.mjs   (after `tsc`)

import assert from 'node:assert/strict';
import fc from 'fast-check';
import * as g from '../dist/geometry/index.js';
import { rotatePoint, rotatePositions } from '../dist/geometry/rotation.js';

const RUNS = Number(process.env.PROPERTY_RUNS ?? 200);

let passed = 0;
let failed = 0;

function property(name, ...args) {
  try {
    fc.assert(fc.property(...args), { numRuns: RUNS });
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(error.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
}

// --- generators ----------------------------------------------------------------------------
// Centres are kept well inside the world so that a shape's own extent cannot push a block
// past a boundary. Clipping at the edge is correct behaviour, but it would make the
// translation property fail for a reason that has nothing to do with translation.

const MARGIN = 100;
const centre = fc.record({
  x: fc.integer({ min: -1000, max: 1000 }),
  y: fc.integer({ min: -64 + MARGIN, max: 320 - MARGIN }),
  z: fc.integer({ min: -1000, max: 1000 }),
});

const radius = fc.integer({ min: 1, max: 12 });
const smallRadius = fc.integer({ min: 1, max: 8 });
const length = fc.integer({ min: 1, max: 16 });
const axis = fc.constantFrom('x', 'y', 'z');
const hollow = fc.boolean();

/**
 * Every shape, parameterised by its centre.
 *
 * `at(origin)` rather than a plain thunk, so the translation property can rebuild the same
 * shape somewhere else. An earlier version used a thunk and asked for an optional `runAt`
 * that nothing provided, so the property returned early and tested nothing at all while
 * reporting a pass.
 */
const anyShape = fc
  .tuple(centre, radius, radius, length, axis, hollow, fc.integer({ min: 0, max: 9 }))
  .map(([c, r1, r2, h, ax, hol, pick]) => {
    const builders = [
      { name: `cuboid`, at: (o) => g.cuboid(o, { x: o.x + r1, y: o.y + r2, z: o.z + h }, hol) },
      { name: `sphere r=${r1}`, at: (o) => g.sphere(o, r1, hol) },
      { name: `ellipsoid ${r1},${r2},${r1}`, at: (o) => g.ellipsoid(o, r1, r2, r1, hol) },
      { name: `disc r=${r1} ${ax}`, at: (o) => g.disc(o, r1, ax, hol) },
      { name: `cylinder r=${r1} h=${h} ${ax}`, at: (o) => g.cylinder(o, r1, h, ax, hol) },
      { name: `cone r=${r1} h=${h} ${ax}`, at: (o) => g.cone(o, r1, h, ax, hol) },
      { name: `torus R=${r1 + r2} r=${r2} ${ax}`, at: (o) => g.torus(o, r1 + r2, r2, ax, hol) },
      { name: `paraboloid r=${r1} h=${h + 1} ${ax}`, at: (o) => g.paraboloid(o, r1, h + 1, ax, hol) },
      { name: `hyperboloid ${r1 + r2}/${r2} h=${h + 1} ${ax}`, at: (o) => g.hyperboloid(o, r1 + r2, r2, h + 1, ax, hol) },
      { name: `line`, at: (o) => g.line(o, { x: o.x + r1, y: o.y + r2, z: o.z + h }) },
    ];
    const builder = builders[pick % builders.length];
    return {
      name: builder.name,
      centre: c,
      run: () => builder.at(c),
      runAt: (delta) => builder.at({ x: c.x + delta.x, y: c.y + delta.y, z: c.z + delta.z }),
    };
  });

const key = (p) => `${p.x},${p.y},${p.z}`;

console.log(`geometry properties (${RUNS} runs each)`);

// --- the invariants the goldens record violations of ------------------------------------------

property('every coordinate is an integer', anyShape, (shape) => {
  for (const p of shape.run()) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.z)) {
      throw new Error(`${shape.name} emitted ${key(p)}`);
    }
  }
  return true;
});

property('no coordinate is NaN or Infinity', anyShape, (shape) => {
  for (const p of shape.run()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      throw new Error(`${shape.name} emitted ${key(p)}`);
    }
  }
  return true;
});

property('no coordinate is emitted twice', anyShape, (shape) => {
  const positions = shape.run();
  const distinct = new Set(positions.map(key));
  if (distinct.size !== positions.length) {
    throw new Error(`${shape.name}: ${positions.length} emitted, ${distinct.size} distinct`);
  }
  return true;
});

property('every coordinate is inside the world', anyShape, (shape) => {
  for (const p of shape.run()) {
    if (p.y < -64 || p.y > 320) throw new Error(`${shape.name} emitted ${key(p)}`);
  }
  return true;
});

property('a valid shape is never empty', anyShape, (shape) => {
  const positions = shape.run();
  if (positions.length === 0) throw new Error(`${shape.name} produced nothing`);
  return true;
});

// --- relationships between calls ----------------------------------------------------------------

property(
  'translating the centre translates the whole shape',
  anyShape,
  fc.record({
    x: fc.integer({ min: -50, max: 50 }),
    y: fc.integer({ min: -30, max: 30 }),
    z: fc.integer({ min: -50, max: 50 }),
  }),
  (shape, delta) => {
    // Rebuilding at a shifted centre must give the shifted set. A shape that rounds against
    // absolute coordinates rather than relative ones fails here and nowhere else.
    const here = shape.run();
    const shifted = new Set(here.map((p) => `${p.x + delta.x},${p.y + delta.y},${p.z + delta.z}`));
    const moved = shape.runAt(delta);

    if (moved.length !== here.length) {
      throw new Error(`${shape.name}: ${here.length} blocks here, ${moved.length} after moving`);
    }
    for (const p of moved) {
      if (!shifted.has(key(p))) throw new Error(`${shape.name}: ${key(p)} is not in the shifted set`);
    }
    return true;
  }
);

property(
  'a hollow shape is contained in the solid one',
  centre,
  smallRadius,
  length,
  axis,
  (c, r, h, ax) => {
    // Checked per shape rather than through anyShape, because the hollow flag has to vary
    // while everything else stays fixed.
    const pairs = [
      ['sphere', () => g.sphere(c, r, false), () => g.sphere(c, r, true)],
      ['ellipsoid', () => g.ellipsoid(c, r, r + 1, r, false), () => g.ellipsoid(c, r, r + 1, r, true)],
      ['disc', () => g.disc(c, r, ax, false), () => g.disc(c, r, ax, true)],
      ['cylinder', () => g.cylinder(c, r, h, ax, false), () => g.cylinder(c, r, h, ax, true)],
      ['cone', () => g.cone(c, r, h, ax, false), () => g.cone(c, r, h, ax, true)],
      ['torus', () => g.torus(c, r * 2, r, ax, false), () => g.torus(c, r * 2, r, ax, true)],
      ['cuboid', () => g.cuboid(c, { x: c.x + r, y: c.y + r, z: c.z + r }, false),
                 () => g.cuboid(c, { x: c.x + r, y: c.y + r, z: c.z + r }, true)],
    ];

    for (const [name, solidFn, hollowFn] of pairs) {
      const solid = new Set(solidFn().map(key));
      const shell = hollowFn();
      if (shell.length === 0) throw new Error(`${name}: hollow produced nothing`);
      if (shell.length > solid.size) throw new Error(`${name}: hollow has more blocks than solid`);
      for (const p of shell) {
        if (!solid.has(key(p))) throw new Error(`${name}: hollow block ${key(p)} is outside the solid shape`);
      }
    }
    return true;
  }
);

property('a sphere is symmetric about its centre', centre, radius, hollow, (c, r, hol) => {
  const set = new Set(g.sphere(c, r, hol).map(key));
  for (const p of g.sphere(c, r, hol)) {
    const mirrored = `${2 * c.x - p.x},${2 * c.y - p.y},${2 * c.z - p.z}`;
    if (!set.has(mirrored)) throw new Error(`${key(p)} has no opposite block`);
  }
  return true;
});

property('a sphere fits its radius exactly', centre, radius, (c, r) => {
  const positions = g.sphere(c, r, false);
  let maxDistance = 0;
  let reachesEdge = false;
  for (const p of positions) {
    const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
    if (d > maxDistance) maxDistance = d;
    if (Math.abs(p.x - c.x) === r || Math.abs(p.y - c.y) === r || Math.abs(p.z - c.z) === r) {
      reachesEdge = true;
    }
  }
  if (maxDistance > r + 0.001) throw new Error(`a block sits ${maxDistance} from the centre, radius is ${r}`);
  if (!reachesEdge) throw new Error(`nothing reaches the requested radius of ${r}`);
  return true;
});

property('a cylinder has exactly the requested number of layers', centre, smallRadius, length, axis, (c, r, h, ax) => {
  const along = { x: 'x', y: 'y', z: 'z' }[ax];
  const layers = new Set(g.cylinder(c, r, h, ax, false).map((p) => p[along]));
  if (layers.size !== h) throw new Error(`asked for ${h} layers, got ${layers.size}`);
  return true;
});

property('a hyperboloid is narrowest at its waist', centre, smallRadius, smallRadius, (c, base, waistOffset) => {
  const waist = Math.max(0, base - waistOffset);
  const height = 11;
  const widths = new Map();
  for (const p of g.hyperboloid(c, base, waist, height, 'y', false)) {
    const layer = p.y - c.y;
    widths.set(layer, Math.max(widths.get(layer) ?? 0, Math.abs(p.x - c.x)));
  }
  const middle = widths.get(5) ?? 0;
  const bottom = widths.get(0) ?? 0;
  const top = widths.get(10) ?? 0;
  if (middle > bottom || middle > top) {
    throw new Error(`base=${base} waist=${waist}: widths bottom=${bottom} middle=${middle} top=${top}`);
  }
  return true;
});

// --- curves -----------------------------------------------------------------------------------

property('a line has no gaps', centre, centre, (a, b) => {
  const positions = g.line(a, b);
  for (let i = 1; i < positions.length; i++) {
    const p = positions[i - 1];
    const q = positions[i];
    const step = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
    if (step > 1) throw new Error(`step of ${step} between ${key(p)} and ${key(q)}`);
  }
  return true;
});

property('a line starts and ends where it was told to', centre, centre, (a, b) => {
  const set = new Set(g.line(a, b).map(key));
  if (!set.has(key(a))) throw new Error(`missing the start ${key(a)}`);
  if (!set.has(key(b))) throw new Error(`missing the end ${key(b)}`);
  return true;
});

/**
 * Whether every block in the set can be reached from the first by stepping between blocks
 * that touch, including diagonally.
 *
 * Adjacency of *consecutive array entries* is the wrong question for a curve. A curve that
 * doubles back revisits blocks, the collector drops the repeats, and what is left reads as a
 * jump even though the curve passed through continuously. Connectivity is what a builder
 * actually needs: no piece of the curve is stranded.
 */
function isConnected(positions) {
  if (positions.length === 0) return true;
  const remaining = new Set(positions.map(key));
  const queue = [positions[0]];
  remaining.delete(key(positions[0]));

  while (queue.length) {
    const p = queue.pop();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const neighbour = `${p.x + dx},${p.y + dy},${p.z + dz}`;
          if (remaining.delete(neighbour)) {
            const [x, y, z] = neighbour.split(',').map(Number);
            queue.push({ x, y, z });
          }
        }
      }
    }
  }
  return remaining.size === 0;
}

property(
  'a curve with default sampling is a connected run of blocks',
  centre,
  fc.array(fc.record({
    x: fc.integer({ min: -30, max: 30 }),
    y: fc.integer({ min: -20, max: 20 }),
    z: fc.integer({ min: -30, max: 30 }),
  }), { minLength: 1, maxLength: 4 }),
  (start, offsets) => {
    // The legacy default of 50 segments oversampled and leaned on deduplication. The rewrite
    // picks its sample count from the derivative bound instead, which is only sound if the
    // result stays in one piece.
    const controls = offsets.map((o) => ({ x: start.x + o.x, y: start.y + o.y, z: start.z + o.z }));
    const end = { x: start.x + 40, y: start.y, z: start.z };
    const positions = g.bezier(start, end, controls);
    if (!isConnected(positions)) {
      throw new Error(`the curve is in more than one piece (${positions.length} blocks)`);
    }
    return true;
  }
);

property('a line is a connected run of blocks', centre, centre, (a, b) => {
  if (!isConnected(g.line(a, b))) throw new Error('the line is in more than one piece');
  return true;
});

property('a helix is a connected run of blocks', centre, smallRadius, length, fc.integer({ min: 1, max: 4 }), (c, r, h, turns) => {
  if (!isConnected(g.helix(c, r, h, turns, 'y'))) {
    throw new Error(`helix r=${r} h=${h} turns=${turns} is in more than one piece`);
  }
  return true;
});

property('a helix stays on its radius', centre, smallRadius, length, fc.integer({ min: 1, max: 6 }), (c, r, h, turns) => {
  for (const p of g.helix(c, r, h, turns, 'y')) {
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    // Each component is rounded independently, so the distance can sit slightly off r.
    if (Math.abs(d - r) > 1.5) throw new Error(`a block sits ${d.toFixed(2)} from the axis, radius is ${r}`);
  }
  return true;
});

// --- rotation -------------------------------------------------------------------------------------

property('four quarter turns return a block to where it started', centre, centre, axis, (p, origin, ax) => {
  let current = p;
  for (let i = 0; i < 4; i++) current = rotatePoint(current, origin, ax, 90);
  if (key(current) !== key(p)) throw new Error(`${key(p)} ended at ${key(current)}`);
  return true;
});

property('a full turn is a no-op', centre, centre, axis, (p, origin, ax) => {
  if (key(rotatePoint(p, origin, ax, 360)) !== key(p)) throw new Error(`360 degrees moved ${key(p)}`);
  return true;
});

property('rotation preserves distance from the axis', centre, centre, axis, fc.integer({ min: 0, max: 359 }), (p, origin, ax, degrees) => {
  const rotated = rotatePoint(p, origin, ax, degrees);
  const plane = { x: ['y', 'z'], y: ['z', 'x'], z: ['x', 'y'] }[ax];
  const before = Math.hypot(p[plane[0]] - origin[plane[0]], p[plane[1]] - origin[plane[1]]);
  const after = Math.hypot(rotated[plane[0]] - origin[plane[0]], rotated[plane[1]] - origin[plane[1]]);
  // Rounding to the block grid moves a point by at most half a block on each axis.
  if (Math.abs(before - after) > 1) {
    throw new Error(`distance ${before.toFixed(2)} became ${after.toFixed(2)} at ${degrees} degrees`);
  }
  return true;
});

property('a quarter turn of a shape keeps every block', centre, smallRadius, axis, (c, r, ax) => {
  const original = g.sphere(c, r, false);
  const rotated = rotatePositions(original, c, ax, 90);
  // A right-angle turn is a permutation of the grid, so nothing may be lost to collisions.
  if (rotated.length !== original.length) {
    throw new Error(`${original.length} blocks became ${rotated.length}`);
  }
  return true;
});

// --- rejection ---------------------------------------------------------------------------------

property('a radius that rounds below one is rejected', centre, fc.double({ min: -5, max: 0.49, noNaN: true }), (c, r) => {
  try {
    g.sphere(c, r, false);
  } catch (error) {
    if (error instanceof g.InvalidArgumentError) return true;
    throw new Error(`threw ${error.constructor.name} instead of InvalidArgumentError`);
  }
  throw new Error(`radius ${r} was accepted`);
});

property('a height that rounds below one is rejected', centre, smallRadius, fc.double({ min: -5, max: 0.49, noNaN: true }), (c, r, h) => {
  try {
    g.cylinder(c, r, h, 'y', false);
  } catch (error) {
    if (error instanceof g.InvalidArgumentError) return true;
    throw new Error(`threw ${error.constructor.name} instead of InvalidArgumentError`);
  }
  throw new Error(`height ${h} was accepted`);
});

property('a waist wider than the base is rejected', centre, smallRadius, smallRadius, (c, base, extra) => {
  try {
    g.hyperboloid(c, base, base + extra, 11, 'y', false);
  } catch (error) {
    if (error instanceof g.InvalidArgumentError) return true;
    throw new Error(`threw ${error.constructor.name} instead of InvalidArgumentError`);
  }
  throw new Error(`waist ${base + extra} was accepted with base ${base}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
