// The packer, checked by its contract rather than by its output.
//
//   node test/optimize.test.mjs
//
// There is no right answer to compare against: many packings of the same blocks are correct,
// and a better one is an improvement, not a regression. What is not negotiable is the union -
// every block asked for, and no block that was not. So the fixed cases below pin the shapes
// that motivated the rewrite, and the random ones search for a set where the union breaks.
//
// Random sets are the point. The legacy packer passed 78 measured cases because every one of
// them was a single dense shape; the first sparse input broke it. fast-check finds those on
// its own.

import assert from 'node:assert/strict';
import fc from 'fast-check';

import { optimizeToBoxes, volumeOf } from '../dist/commands/optimize.js';
import { buildFillCommand, FILL_VOLUME_LIMIT } from '../dist/commands/build.js';
import { sphere, cuboid, torus, helix } from '../dist/geometry/index.js';

const RUNS = Number(process.env.PROPERTY_RUNS ?? 300);

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
    console.log(`       ${error.message.split('\n').slice(0, 8).join('\n       ')}`);
  }
}

const key = (x, y, z) => `${x},${y},${z}`;

/** Everything the packing has to satisfy, in one place, so every case checks all of it. */
function checkPacking(positions, options) {
  const result = optimizeToBoxes(positions, options);
  const input = new Set(positions.map((p) => key(p.x, p.y, p.z)));
  const covered = new Set();
  let overlaps = 0;

  for (const box of result.boxes) {
    assert.ok(box.from.x <= box.to.x && box.from.y <= box.to.y && box.from.z <= box.to.z,
      `box corners are not ordered: ${JSON.stringify(box)}`);
    for (let x = box.from.x; x <= box.to.x; x++)
      for (let y = box.from.y; y <= box.to.y; y++)
        for (let z = box.from.z; z <= box.to.z; z++) {
          const k = key(x, y, z);
          if (covered.has(k)) overlaps++;
          covered.add(k);
        }
  }

  for (const k of input) assert.ok(covered.has(k), `not covered: ${k}`);
  for (const k of covered) assert.ok(input.has(k), `covered but never asked for: ${k}`);
  assert.equal(overlaps, 0, `${overlaps} blocks are covered by more than one box`);
  assert.equal(result.blockCount, input.size, 'blockCount should count distinct blocks');
  assert.equal(result.fillCount, result.boxes.length);

  const limit = options?.maxVolume ?? FILL_VOLUME_LIMIT;
  for (const box of result.boxes) {
    assert.ok(volumeOf(box) <= limit, `box of ${volumeOf(box)} exceeds the ${limit} limit`);
  }
  return result;
}

console.log('block packing');

// --- the case the legacy packer gets wrong ----------------------------------------------

test('two blocks with a gap between them do not become one box', () => {
  const result = checkPacking([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }]);
  // The legacy packer answered one box spanning x=0..5, filling four blocks nobody asked
  // for, because 0 and 5 are adjacent in the sorted list of distinct x values.
  assert.equal(result.boxes.length, 2);
});

test('two separate regions stay separate', () => {
  const region = (x0) => {
    const out = [];
    for (let x = x0; x < x0 + 2; x++)
      for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) out.push({ x, y, z });
    return out;
  };
  const result = checkPacking([...region(0), ...region(10)]);
  assert.equal(result.boxes.length, 2, 'one box per region');
});

// --- shapes -----------------------------------------------------------------------------

const SHAPES = {
  'solid cube 4^3': cuboid({ x: 0, y: 0, z: 0 }, { x: 3, y: 3, z: 3 }, false),
  'hollow cube 6^3': cuboid({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 }, true),
  'solid sphere r5': sphere({ x: 0, y: 0, z: 0 }, 5, false),
  'hollow sphere r5': sphere({ x: 0, y: 0, z: 0 }, 5, true),
  'torus': torus({ x: 0, y: 0, z: 0 }, 6, 2, 'y', false),
  'helix': helix({ x: 0, y: 0, z: 0 }, 4, 10, 2, 'y'),
};

for (const [name, positions] of Object.entries(SHAPES)) {
  test(`${name} packs exactly`, () => {
    const result = checkPacking(positions);
    assert.ok(result.boxes.length <= positions.length, 'packing should never make more commands than blocks');
  });
}

test('a solid cube is one box', () => {
  assert.equal(optimizeToBoxes(SHAPES['solid cube 4^3']).boxes.length, 1);
});

test('packing a solid sphere is worth doing at all', () => {
  // If the ratio were near 1 the whole module would be pointless, so it is worth asserting
  // rather than assuming: 515 blocks should not need anything like 515 commands.
  const result = optimizeToBoxes(SHAPES['solid sphere r5']);
  assert.ok(result.blockCount / result.fillCount > 5,
    `only ${(result.blockCount / result.fillCount).toFixed(1)}x fewer commands`);
});

// --- degenerate inputs ------------------------------------------------------------------

test('an empty input packs into nothing', () => {
  const result = optimizeToBoxes([]);
  assert.deepEqual(result, { boxes: [], blockCount: 0, fillCount: 0 });
});

test('duplicates collapse, because a fill places once', () => {
  const result = checkPacking([{ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }]);
  assert.equal(result.blockCount, 1);
  assert.equal(result.boxes.length, 1);
});

test('a fractional position is refused rather than rounded', () => {
  assert.throws(() => optimizeToBoxes([{ x: 0.5, y: 0, z: 0 }]), /whole numbers/);
});

test('a box too big for one fill is split', () => {
  // 40^3 is 64000, comfortably past the limit.
  const positions = [];
  for (let x = 0; x < 40; x++)
    for (let y = 0; y < 40; y++) for (let z = 0; z < 40; z++) positions.push({ x, y, z });

  const result = checkPacking(positions);
  assert.ok(result.boxes.length > 1, 'should not have emitted one oversized box');
  assert.ok(result.boxes.length <= 4, `${result.boxes.length} boxes for a solid cuboid is too many`);
});

test('every emitted box turns into a command the fill builder accepts', () => {
  for (const [name, positions] of Object.entries(SHAPES)) {
    for (const box of optimizeToBoxes(positions).boxes) {
      const command = buildFillCommand(box.from, box.to, 'stone');
      assert.match(command, /^fill -?\d+ -?\d+ -?\d+ -?\d+ -?\d+ -?\d+ minecraft:stone replace$/,
        `${name}: ${command}`);
    }
  }
});

// --- the search -------------------------------------------------------------------------

const smallPosition = fc.record({
  x: fc.integer({ min: -6, max: 6 }),
  y: fc.integer({ min: -6, max: 6 }),
  z: fc.integer({ min: -6, max: 6 }),
});

test(`the union holds for arbitrary block sets (${RUNS} runs)`, () => {
  fc.assert(
    fc.property(fc.array(smallPosition, { minLength: 0, maxLength: 120 }), (positions) => {
      checkPacking(positions);
    }),
    { numRuns: RUNS }
  );
});

test(`the union holds for sparse, scattered sets (${RUNS} runs)`, () => {
  // Wide coordinates with few blocks: the shape of input the legacy packer never saw and
  // could not handle.
  const scattered = fc.record({
    x: fc.integer({ min: -200, max: 200 }),
    y: fc.integer({ min: -60, max: 200 }),
    z: fc.integer({ min: -200, max: 200 }),
  });
  fc.assert(
    fc.property(fc.array(scattered, { minLength: 1, maxLength: 40 }), (positions) => {
      checkPacking(positions);
    }),
    { numRuns: RUNS }
  );
});

test(`splitting respects any volume limit, not just the default (${RUNS} runs)`, () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 6 }),
      fc.integer({ min: 0, max: 6 }),
      fc.integer({ min: 0, max: 6 }),
      fc.integer({ min: 1, max: 30 }),
      (dx, dy, dz, maxVolume) => {
        const positions = [];
        for (let x = 0; x <= dx; x++)
          for (let y = 0; y <= dy; y++) for (let z = 0; z <= dz; z++) positions.push({ x, y, z });
        checkPacking(positions, { maxVolume });
      }
    ),
    { numRuns: RUNS }
  );
});

test('packing is stable: the same blocks in a different order give the same boxes', () => {
  fc.assert(
    fc.property(fc.array(smallPosition, { minLength: 1, maxLength: 60 }), (positions) => {
      const a = optimizeToBoxes(positions).boxes;
      const b = optimizeToBoxes([...positions].reverse()).boxes;
      assert.deepEqual(b, a);
    }),
    { numRuns: RUNS }
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
