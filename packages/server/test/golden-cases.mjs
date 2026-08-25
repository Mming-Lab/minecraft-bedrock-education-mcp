// The case matrix, shared by extract.mjs (records the legacy output) and validate.mjs
// (checks a new implementation against it). Keeping one definition prevents the two from
// drifting apart, which would silently weaken the comparison.
//
// `g` is the geometry module and `mathLib` the math module, so either implementation can
// be plugged in.

export function buildCases(g, mathLib) {
  const cases = [];
  function add(fn, id, run, opts = {}) {
    cases.push({ fn, id, run, expectEmpty: !!opts.expectEmpty, note: opts.note });
  }

  const P = (x, y, z) => ({ x, y, z });
  const C = P(0, 0, 0);


  // cube
  add('cube', 'r-3x3x3', () => g.calculateCubePositions(P(0, 0, 0), P(2, 2, 2)));
  add('cube', 'hollow-4x4x4', () => g.calculateCubePositions(P(0, 0, 0), P(3, 3, 3), true));
  add('cube', 'reversed-corners', () => g.calculateCubePositions(P(3, 3, 3), P(0, 0, 0)));
  add('cube', 'single-block', () => g.calculateCubePositions(P(0, 0, 0), P(0, 0, 0)));

  // sphere
  for (const r of [1, 2, 3, 5, 8]) {
    add('sphere', `r${r}`, () => g.calculateSpherePositions(C, r));
    add('sphere', `r${r}-hollow`, () => g.calculateSpherePositions(C, r, true));
  }
  add('sphere', 'r2.5-non-integer', () => g.calculateSpherePositions(C, 2.5), { note: 'B1: non-integer radius' });
  add('sphere', 'r0', () => g.calculateSpherePositions(C, 0), { expectEmpty: true });
  add('sphere', 'r-negative', () => g.calculateSpherePositions(C, -1), { expectEmpty: true, note: 'B7' });

  // cylinder / circle
  for (const axis of ['x', 'y', 'z']) {
    add('cylinder', `r3-h5-${axis}`, () => g.calculateCylinderPositions(C, 3, 5, axis));
    add('cylinder', `r3-h5-${axis}-hollow`, () => g.calculateCylinderPositions(C, 3, 5, axis, true));
    add('circle', `r5-${axis}`, () => g.calculateCirclePositions(C, 5, axis));
    add('circle', `r5-${axis}-hollow`, () => g.calculateCirclePositions(C, 5, axis, 0, true));
  }
  add('cylinder', 'h0', () => g.calculateCylinderPositions(C, 3, 0), { expectEmpty: true });
  add('cylinder', 'r1-h1', () => g.calculateCylinderPositions(C, 1, 1));

  // ellipsoid
  add('ellipsoid', 'r3-4-5', () => g.calculateEllipsoidPositions(C, 3, 4, 5));
  add('ellipsoid', 'r3-4-5-hollow', () => g.calculateEllipsoidPositions(C, 3, 4, 5, true));
  add('ellipsoid', 'rz0', () => g.calculateEllipsoidPositions(C, 3, 3, 0), { expectEmpty: true, note: 'B4: divide by zero' });
  add('ellipsoid', 'all1', () => g.calculateEllipsoidPositions(C, 1, 1, 1));

  // line
  add('line', 'diagonal', () => g.calculateLinePositions(P(0, 0, 0), P(10, 5, 3)));
  add('line', 'same-point', () => g.calculateLinePositions(P(0, 0, 0), P(0, 0, 0)));
  add('line', 'negative', () => g.calculateLinePositions(P(5, 5, 5), P(-5, -5, -5)));
  add('line', 'axis-x', () => g.calculateLinePositions(P(0, 0, 0), P(10, 0, 0)));

  // helix
  add('helix', 'h10-r3-t2', () => g.calculateHelixPositions(C, 10, 3, 2));
  add('helix', 'h20-r5-t4', () => g.calculateHelixPositions(C, 20, 5, 4));
  add('helix', 'r0', () => g.calculateHelixPositions(C, 10, 0, 3), { note: 'B8: radius 0' });
  add('helix', 't0', () => g.calculateHelixPositions(C, 10, 3, 0), { note: 'B8: zero turns' });
  add('helix', 'h0', () => g.calculateHelixPositions(C, 0, 3, 3), { expectEmpty: true });
  // A wide turn over a short rise: the sample count comes from the total length, so the
  // horizontal step exceeds one block and the winding breaks into pieces.
  add('helix', 'flat-r4-h2-t1', () => g.calculateHelixPositions(C, 2, 4, 1));
  add('helix', 'flat-r8-h2-t1', () => g.calculateHelixPositions(C, 2, 8, 1));
  add('helix', 'flat-r12-h3-t1', () => g.calculateHelixPositions(C, 3, 12, 1));

  // torus
  for (const [R, r] of [[8, 3], [5, 2], [3, 1]]) {
    add('torus', `R${R}-r${r}`, () => g.calculateTorusPositions(C, R, r), { note: 'B5: duplicates expected' });
    add('torus', `R${R}-r${r}-hollow`, () => g.calculateTorusPositions(C, R, r, true), { note: 'B5' });
  }

  // paraboloid
  add('paraboloid', 'r5-h10', () => g.calculateParaboloidPositions(C, 5, 10));
  add('paraboloid', 'r5-h10-down', () => g.calculateParaboloidPositions(C, 5, 10, 'down'));
  add('paraboloid', 'r5-h10-hollow', () => g.calculateParaboloidPositions(C, 5, 10, 'up', true));
  add('paraboloid', 'h1', () => g.calculateParaboloidPositions(C, 5, 1), { expectEmpty: true, note: 'B3: 0/0 = NaN' });
  add('paraboloid', 'h0', () => g.calculateParaboloidPositions(C, 5, 0), { expectEmpty: true });

  // hyperboloid
  add('hyperboloid', 'r5-h10', () => g.calculateHyperboloidPositions(C, 5, 10));
  add('hyperboloid', 'r5-h5-odd', () => g.calculateHyperboloidPositions(C, 5, 5), { note: 'B2: odd height' });
  add('hyperboloid', 'r5-h10-waist0', () => g.calculateHyperboloidPositions(C, 5, 10, 0));
  add('hyperboloid', 'r5-h10-hollow', () => g.calculateHyperboloidPositions(C, 5, 10, 0.5, true));
  add('hyperboloid', 'h1', () => g.calculateHyperboloidPositions(C, 5, 1));

  // bezier
  add('bezier', 'one-control', () => g.calculateBezierPositions(P(0, 0, 0), P(10, 0, 0), [P(5, 10, 0)]));
  add('bezier', 'no-control', () => g.calculateBezierPositions(P(0, 0, 0), P(10, 0, 0), []));
  add('bezier', 'cubic', () => g.calculateBezierPositions(P(0, 0, 0), P(20, 0, 0), [P(5, 10, 0), P(15, -10, 0)]));
  add('bezier', 'segments-1', () => g.calculateBezierPositions(P(0, 0, 0), P(10, 0, 0), [P(5, 5, 0)], 1));
  add('bezier', 'many-controls-30', () => {
    const cps = [];
    for (let i = 1; i <= 30; i++) cps.push(P(i, i % 5, 0));
    return g.calculateBezierPositions(P(0, 0, 0), P(40, 0, 0), cps);
  }, { note: 'B6: factorial overflow probe' });

  // rotation
  add('rotate', 'x90', () => [mathLib.rotatePoint3D(P(1, 0, 0), C, 'y', 90)]);
  add('rotate', 'roundtrip-360', () => [mathLib.rotatePoint3D(P(3, 4, 5), C, 'y', 360)]);
  add('rotate', 'array-90', () => mathLib.rotatePointsArray([P(1, 0, 0), P(0, 1, 0), P(0, 0, 1)], C, 'z', 90));


  return cases;
}

/**
 * Inputs for the block packer.
 *
 * Deliberately built from plain loops rather than from either geometry module. The point of
 * these cases is to compare two packers on the same blocks; if the input came from the
 * geometry, the two runs would be packing different sets wherever the shapes disagree, and
 * the comparison would mean nothing.
 *
 * The first six are the original set - all dense, all of which the legacy packer handles
 * exactly. The rest have a hole in their projection onto an axis, which is the case it gets
 * wrong: it expands over the sorted list of distinct coordinates and reads adjacency in that
 * list as adjacency in the world, so it bridges the gap and fills blocks nobody asked for.
 */
export function buildOptimizerCases() {
  const P = (x, y, z) => ({ x, y, z });
  const cases = [];
  const add = (id, positions, note) => cases.push({ id, positions, note });

  const box = (x0, y0, z0, x1, y1, z1) => {
    const out = [];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push(P(x, y, z));
    return out;
  };
  const ball = (r, hollow) => {
    const out = [];
    const inner = hollow ? (r - 1) * (r - 1) : -1;
    for (let x = -r; x <= r; x++)
      for (let y = -r; y <= r; y++)
        for (let z = -r; z <= r; z++) {
          const d = x * x + y * y + z * z;
          if (d <= r * r && d > inner) out.push(P(x, y, z));
        }
    return out;
  };

  add('solid-cube-4x4x4', box(0, 0, 0, 3, 3, 3));
  add('sphere-r5', ball(5, false));
  add('hollow-sphere-r5', ball(5, true));
  add('line', Array.from({ length: 11 }, (_, i) => P(i, Math.round(i / 2), Math.round(i * 0.3))));
  add('single', [P(0, 0, 0)]);
  add('empty', []);

  add('two-blocks-five-apart', [P(0, 0, 0), P(5, 0, 0)], 'the smallest input the legacy packer over-fills');
  add('two-clusters', [...box(0, 0, 0, 1, 1, 1), ...box(10, 0, 0, 11, 1, 1)], 'what a two-region edit looks like');
  add('gap-on-y', [P(0, 0, 0), P(0, 4, 0)]);
  add('gap-on-z', [P(0, 0, 0), P(0, 0, 7)]);
  add('hollow-shell-with-interior-gap', box(0, 0, 0, 4, 4, 4).filter(
    (p) => p.x === 0 || p.x === 4 || p.y === 0 || p.y === 4 || p.z === 0 || p.z === 4
  ));
  add('checkerboard-8', box(0, 0, 0, 7, 7, 0).filter((p) => (p.x + p.y) % 2 === 0), 'worst case for packing: every block its own box');
  add('duplicated-input', [P(1, 1, 1), P(1, 1, 1), P(1, 1, 1)], 'a fill places once, so duplicates must collapse');

  return cases;
}
