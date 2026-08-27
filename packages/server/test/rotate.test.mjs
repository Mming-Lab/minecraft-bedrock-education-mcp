// Turning a plan.
//
//   node test/rotate.test.mjs
//
// Every shape with a surface is square to the world: cubes take corners, cylinders and prisms
// run along x, y or z. Only build.line and build.curve can sit at an angle, and both are one
// block wide. So nothing on the tool surface could put a *face* at an angle, which is the gap
// this fills.
//
// The legacy server had build_rotate and it did not work: it walked the source box, rotated
// each coordinate, and placed a single named material there. Rotating a house gave a solid
// block of oak the shape of the house's bounding box. The `material` argument existed because
// the tool never read what was in the source. What is tested here first is that this one does
// not repeat that - the block comes from the plan, and naming one is optional.
//
// After that, the honest reporting of a lossy turn. A right angle is exact; other angles round
// onto the grid, and the count that comes back has to say so, because the damage is invisible
// in the world until somebody walks round the back of the wall.

import assert from 'node:assert/strict';

import { toolsFor, offlineBridge } from '../dist/tools/index.js';
import { storePlan, resetPlans, getPlan } from '../dist/plan/store.js';
import * as geometry from '../dist/geometry/index.js';

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

function fakeRunner() {
  const sent = [];
  return {
    sent,
    async run(commandLine) {
      sent.push(commandLine);
      return { commandLine, statusCode: 0, statusMessage: '', data: {} };
    },
  };
}

const tool = (runner) => toolsFor(offlineBridge, runner).find((t) => t.name === 'build.rotate');
const ORIGIN = { x: 0, y: 0, z: 0 };

console.log('rotate');

await test('the block comes from the plan, so nothing has to be named again', async () => {
  // The legacy tool's whole defect in one assertion. It could not do this: it had no idea what
  // was in the source, so `material` was required and everything came out one colour.
  resetPlans();
  const runner = fakeRunner();
  const planId = storePlan([{ x: 3, y: 0, z: 0 }], 'build.cube', 'oak_planks');
  const result = await tool(runner).handler({ planId, origin: ORIGIN, axis: 'y', degrees: 90 });
  assert.equal(result.block, 'oak_planks');
  assert.ok(runner.sent.some((line) => line.includes('oak_planks')));
});

await test('naming a block overrides the plan, for when that is what you want', async () => {
  resetPlans();
  const runner = fakeRunner();
  const planId = storePlan([{ x: 3, y: 0, z: 0 }], 'build.cube', 'oak_planks');
  const result = await tool(runner).handler({
    planId, origin: ORIGIN, axis: 'y', degrees: 90, block: 'stone',
  });
  assert.equal(result.block, 'stone');
});

await test('a right angle loses nothing and reports exact', async () => {
  resetPlans();
  const runner = fakeRunner();
  const slab = geometry.cuboid({ x: -5, y: 0, z: -5 }, { x: 5, y: 0, z: 5 });
  const planId = storePlan(slab, 'build.cube', 'stone');
  const result = await tool(runner).handler({ planId, origin: ORIGIN, axis: 'y', degrees: 90 });
  assert.equal(result.exact, true);
  assert.equal(result.lost, 0);
  assert.equal(result.blockCount, slab.length);
});

await test('four right angles bring a plan back to where it started', async () => {
  // The reason rotatePoint swaps components instead of using sine and cosine. Trigonometric
  // rounding drifts, and a drift of one block is invisible until the fourth turn.
  resetPlans();
  const runner = fakeRunner();
  const shape = geometry.cuboid({ x: 2, y: 0, z: 1 }, { x: 6, y: 3, z: 2 });
  const key = (p) => `${p.x},${p.y},${p.z}`;
  let current = storePlan(shape, 'build.cube', 'stone');
  for (let i = 0; i < 4; i++) {
    const r = await tool(runner).handler({ planId: current, origin: ORIGIN, axis: 'y', degrees: 90 });
    current = r.planId;
  }
  const back = getPlan(current).positions;
  assert.deepEqual(new Set(back.map(key)), new Set(shape.map(key)));
});

await test('a lossy turn says how many blocks it lost, rather than reporting a clean total', async () => {
  // Measured while designing this: a solid 21x21 face at 45 degrees keeps 365 of 441 and opens
  // 64 gaps inside itself. The damage is invisible from the front, so the number is the only
  // warning a caller gets.
  resetPlans();
  const runner = fakeRunner();
  const slab = geometry.cuboid({ x: -10, y: 0, z: -10 }, { x: 10, y: 0, z: 10 });
  const planId = storePlan(slab, 'build.cube', 'stone');
  const result = await tool(runner).handler({ planId, origin: ORIGIN, axis: 'y', degrees: 45 });
  assert.equal(result.exact, false);
  assert.equal(result.sourceBlockCount, 441);
  assert.ok(result.lost > 0, 'a 45 degree turn of a solid face reported no loss');
  assert.equal(result.blockCount + result.lost, result.sourceBlockCount);
});

await test('the same turn on an arrangement loses nothing, which is the common case', async () => {
  // Eight pillars in a ring. No surface, so nothing to tear - and this is what the tool is
  // actually for. A limit that only bites solid faces should not read as a limit on everything.
  resetPlans();
  const runner = fakeRunner();
  const ring = [];
  for (let i = 0; i < 8; i++) {
    const t = (i * Math.PI) / 4;
    ring.push({ x: Math.round(9 * Math.cos(t)), y: 0, z: Math.round(9 * Math.sin(t)) });
  }
  const planId = storePlan(ring, 'build.cube', 'stone');
  const result = await tool(runner).handler({ planId, origin: ORIGIN, axis: 'y', degrees: 45 });
  assert.equal(result.lost, 0);
  assert.equal(result.blockCount, 8);
});

await test('the turned shape becomes a plan of its own, so it can be turned again', async () => {
  resetPlans();
  const runner = fakeRunner();
  const planId = storePlan([{ x: 4, y: 0, z: 0 }], 'build.cube', 'stone');
  const once = await tool(runner).handler({ planId, origin: ORIGIN, axis: 'y', degrees: 90 });
  assert.notEqual(once.planId, planId);
  assert.equal(once.sourcePlanId, planId);
  const twice = await tool(runner).handler({
    planId: once.planId, origin: ORIGIN, axis: 'y', degrees: 90,
  });
  assert.deepEqual(getPlan(twice.planId).positions, [{ x: -4, y: 0, z: 0 }]);
});

await test('an unknown plan says what to do about it', async () => {
  resetPlans();
  await assert.rejects(
    () => tool(fakeRunner()).handler({ planId: 'nope', origin: ORIGIN, axis: 'y', degrees: 90 }),
    /dryRun/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
