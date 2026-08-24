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
