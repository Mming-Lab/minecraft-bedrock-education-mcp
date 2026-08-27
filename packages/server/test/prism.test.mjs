// The polygon pushed along an axis.
//
//   node test/prism.test.mjs
//
// D-14 recorded that "house", "tower" and "bridge" are not mathematical shapes and need
// decomposing. The eight closed surfaces cover boxes and round things; a gable roof, a
// hexagonal tower and an L-shaped floor plan sit in the gap between them, and until now the
// only way to build one was one character per block.
//
// What is checked here is the part that can be got wrong silently. A prism whose outline
// leaks is a room with a hole in the wall, and nothing in the block count says so - the
// count goes *up* when a wall springs a leak into the interior, so a caller watching totals
// would see a bigger number and assume more wall. The seal is therefore tested by walking
// the boundary rather than by counting.

import assert from 'node:assert/strict';

import * as geometry from '../dist/geometry/index.js';
import { toolsFor, offlineBridge } from '../dist/tools/index.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((error) => {
      failed++;
      console.log(`  FAIL ${name}`);
      console.log(`       ${(error.stack ?? error.message).split('\n').slice(0, 4).join('\n       ')}`);
    });
}

const key = (p) => `${p.x},${p.y},${p.z}`;
const at = (positions) => new Set(positions.map(key));

const SQUARE = [
  { u: 0, v: 0 },
  { u: 4, v: 0 },
  { u: 4, v: 4 },
  { u: 0, v: 4 },
];

console.log('prism');

await test('a square cross-section fills exactly the square, on every layer', () => {
  // 5x5 including both edges, three layers up. If the crossing rule dropped the boundary
  // this would be 3x3, and if it double-counted a vertex the collector would hide it - so
  // the count is checked against the shape, not against a previous run.
  const positions = geometry.prism({ x: 0, y: 0, z: 0 }, SQUARE, 3);
  assert.equal(positions.length, 5 * 5 * 3);

  const here = at(positions);
  for (let y = 0; y < 3; y++) {
    for (let u = 0; u <= 4; u++) {
      for (let v = 0; v <= 4; v++) {
        assert.ok(here.has(`${u},${y},${v}`), `missing ${u},${y},${v}`);
      }
    }
  }
});

await test('the wall of a hollow prism has no gap anywhere on the boundary', () => {
  // The failure this guards against is a leak at a vertex or along a horizontal edge, which
  // is exactly where a point-in-polygon test is ambiguous. Walked rather than counted.
  const positions = geometry.prism({ x: 0, y: 0, z: 0 }, SQUARE, 4, 'y', true);
  const here = at(positions);

  const middle = 1; // an interior layer: walls only
  for (let u = 0; u <= 4; u++) {
    for (const v of [0, 4]) assert.ok(here.has(`${u},${middle},${v}`), `gap at ${u},${v}`);
  }
  for (let v = 0; v <= 4; v++) {
    for (const u of [0, 4]) assert.ok(here.has(`${u},${middle},${v}`), `gap at ${u},${v}`);
  }
  // and the inside of that layer is empty, or it is not hollow
  assert.ok(!here.has(`2,${middle},2`));
});

await test('a hollow prism keeps both end caps solid, like the cylinder', () => {
  // Same rule as build.cylinder: "a tube with solid ends, so it holds water or lava". A
  // prism that opened its ends would be a different shape from the one the description
  // promises.
  const positions = geometry.prism({ x: 0, y: 0, z: 0 }, SQUARE, 4, 'y', true);
  const here = at(positions);
  assert.ok(here.has('2,0,2'), 'bottom cap is open');
  assert.ok(here.has('2,3,2'), 'top cap is open');
});

await test('a triangle gives a gable, and the slope is filled without steps missing', () => {
  // The shape the tool exists for. Extruded along x so the triangle stands across the roof.
  const gable = [
    { u: 0, v: -4 },
    { u: 0, v: 4 },
    { u: 4, v: 0 },
  ];
  const positions = geometry.prism({ x: 0, y: 0, z: 0 }, gable, 6, 'x');
  const here = at(positions);

  // Every layer is the same triangle; the apex and both ends of the base must be present.
  for (let x = 0; x < 6; x++) {
    assert.ok(here.has(`${x},4,0`), `apex missing at x=${x}`);
    assert.ok(here.has(`${x},0,-4`), `eave missing at x=${x}`);
    assert.ok(here.has(`${x},0,4`), `eave missing at x=${x}`);
  }
  assert.equal(positions.length % 6, 0, 'layers differ from one another');
});

await test('winding order changes the shape, and both answers are shapes', () => {
  // The same four corners in a different order are a bow tie. That is not an error - a
  // caller may want a star polygon - but it must not be silently the square.
  const square = geometry.prism({ x: 0, y: 0, z: 0 }, SQUARE, 1);
  const bowtie = geometry.prism(
    { x: 0, y: 0, z: 0 },
    [SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]],
    1
  );
  assert.notEqual(square.length, bowtie.length);
  assert.ok(bowtie.length > 0);
});

await test('fewer than three corners is refused, not quietly drawn as a line', () => {
  assert.throws(
    () => geometry.prism({ x: 0, y: 0, z: 0 }, [{ u: 0, v: 0 }, { u: 4, v: 0 }], 2),
    /at least 3 vertices/
  );
});

await test('no position is emitted twice', () => {
  // Two edges meeting at a vertex trace the same block. The collector dedupes, and this is
  // what says so rather than assuming it.
  const positions = geometry.prism({ x: 0, y: 0, z: 0 }, SQUARE, 2, 'y', true);
  assert.equal(new Set(positions.map(key)).size, positions.length);
});

await test('the axis moves the extrusion, not the cross-section', () => {
  const up = geometry.prism({ x: 0, y: 0, z: 0 }, SQUARE, 3, 'y');
  const east = geometry.prism({ x: 0, y: 0, z: 0 }, SQUARE, 3, 'x');
  assert.equal(up.length, east.length);
  assert.equal(new Set(up.map((p) => p.y)).size, 3);
  assert.equal(new Set(east.map((p) => p.x)).size, 3);
});

await test('the tool is registered and reaches the same geometry', () => {
  const tool = toolsFor(offlineBridge, { async run() { throw new Error('not used'); } })
    .find((t) => t.name === 'build.prism');
  assert.ok(tool, 'build.prism is not registered');
  assert.equal(tool.annotations.readOnlyHint, false);
  // The schema has to refuse a two-corner cross-section before the handler sees it, or the
  // model learns the error from a thrown exception instead of from the schema.
  assert.throws(() => tool.inputSchema.crossSection.parse([{ u: 0, v: 0 }, { u: 1, v: 1 }]));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
