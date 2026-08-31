// Measuring a build, and refusing to mark it.
//
//   node test/assess.test.mjs
//
// Two things are being protected here, and only one of them is arithmetic.
//
// The arithmetic: a pair must be counted once, not twice, and a block that maps to itself is
// not a match worth counting - both would inflate every ratio and make a lopsided build look
// better than it is.
//
// The other: a pair where one side was never read is neither a match nor a mismatch. Folding
// it into mismatches would let a slow chunk load tell a child their careful work is crooked.
// That is the same distinction the layer grid draws between `.` and `?`, applied one level up.

import assert from 'node:assert/strict';

import { toLayers } from '../dist/world/layers.js';
import { measureSymmetry, measureComposition } from '../dist/world/measure.js';
import { toolsFor, offlineRunner } from '../dist/tools/index.js';

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

const ORIGIN = { x: 0, y: 64, z: 0 };

/**
 * Builds a region from rows of characters, bottom layer first.
 *
 * Written the way the grid reads, so a test's intent is visible: 'a' is stone, 'b' is dirt,
 * '.' is air, '?' is unread.
 */
function region(layers, origin = ORIGIN) {
  const size = { x: layers[0][0].length, y: layers.length, z: layers[0].length };
  const named = { a: 'stone', b: 'dirt', c: 'gold_block', '.': 'air', '?': null };
  const blocks = [];
  for (let x = 0; x < size.x; x++)
    for (let y = 0; y < size.y; y++)
      for (let z = 0; z < size.z; z++) blocks.push(named[layers[y][z][x]]);
  return toLayers(origin, size, blocks);
}

console.log('symmetry');

await test('a mirrored build matches across the axis it was mirrored on', async () => {
  // Symmetric east-west, not north-south. Getting one right and the other wrong is the whole
  // point: an axis-blind check would call this symmetric.
  const r = region([['a.a', 'aaa']]);

  const x = measureSymmetry(r, 'mirror_x');
  assert.equal(x.mismatchCount, 0);
  assert.ok(x.comparedPairs > 0, 'nothing was compared, so a pass here means nothing');

  const z = measureSymmetry(r, 'mirror_z');
  assert.ok(z.mismatchCount > 0, 'this build is not symmetric north-south');
});

await test('each pair is counted once, and the middle column is not counted at all', async () => {
  // Width 3: column 0 pairs with column 2, column 1 pairs with itself. One row, one layer, so
  // exactly one pair should be compared - not two, and not three.
  const r = region([['aba']]);
  const x = measureSymmetry(r, 'mirror_x');

  assert.equal(x.comparedPairs, 1, 'a self-pair or a double count would show up here');
  assert.equal(x.matchingPairs, 1);
  assert.equal(x.matchRatio, 1);
});

await test('a mismatch is reported with world coordinates on both sides', async () => {
  const r = region([['a.b']], { x: 100, y: 64, z: 200 });
  const x = measureSymmetry(r, 'mirror_x');

  assert.equal(x.mismatchCount, 1);
  assert.deepEqual(x.mismatches[0].a, { x: 100, y: 64, z: 200 });
  assert.equal(x.mismatches[0].aBlock, 'stone');
  assert.deepEqual(x.mismatches[0].b, { x: 102, y: 64, z: 200 });
  assert.equal(x.mismatches[0].bBlock, 'dirt');
});

await test('an unread block makes a pair indeterminate, never a mismatch', async () => {
  // The failure this exists to prevent: a chunk that had not loaded telling a child their
  // build is lopsided.
  const r = region([['a?a', 'aba']]);
  const x = measureSymmetry(r, 'mirror_x');

  assert.equal(x.indeterminatePairs, 0, 'the ? is the middle column, which pairs with itself');
  const withEdge = measureSymmetry(region([['?.a']]), 'mirror_x');
  assert.equal(withEdge.indeterminatePairs, 1);
  assert.equal(withEdge.mismatchCount, 0, 'unread was counted as a mismatch');
  assert.equal(withEdge.comparedPairs, 0);
  assert.equal(withEdge.matchRatio, null, 'a ratio out of nothing should be null, not 0 or 1');
});

await test('half a turn is not the same question as a mirror', async () => {
  // Point symmetric, and not symmetric across either axis on its own.
  const r = region([['a..', '...', '..a']]);

  assert.equal(measureSymmetry(r, 'rotate_180').mismatchCount, 0);
  assert.ok(measureSymmetry(r, 'mirror_x').mismatchCount > 0);
  assert.ok(measureSymmetry(r, 'mirror_z').mismatchCount > 0);
});

await test('a quarter turn is refused on a footprint that is not square', async () => {
  // Not a fault in the build. There is simply nothing to compare it against.
  const r = region([['aa', 'aa', 'aa']]);
  const q = measureSymmetry(r, 'rotate_90');

  assert.equal(q.applicable, false);
  assert.equal(q.comparedPairs, 0);
  assert.equal(q.matchRatio, null);
});

await test('a quarter turn is measured on a square one', async () => {
  const solid = measureSymmetry(region([['aa', 'aa']]), 'rotate_90');
  assert.equal(solid.applicable, true);
  assert.equal(solid.mismatchCount, 0);

  const corner = measureSymmetry(region([['a.', '..']]), 'rotate_90');
  assert.ok(corner.mismatchCount > 0, 'one corner alone is not quarter-turn symmetric');
});

await test('the mismatch list is capped, and the count is not', async () => {
  const rows = ['ab'.repeat(20)];
  const r = region([rows]);
  const x = measureSymmetry(r, 'mirror_x', { maxMismatches: 3 });

  assert.equal(x.mismatches.length, 3);
  assert.ok(x.mismatchCount > 3, 'the total should be the real one, not the truncated one');
});

console.log('\ncomposition');

await test('a hollow box is reported as air, not as "hollow"', async () => {
  // The word is a judgement about intent. The proportion is a fact.
  const r = region([['aaa', 'aaa', 'aaa'], ['aaa', 'a.a', 'aaa'], ['aaa', 'aaa', 'aaa']]);
  const c = measureComposition(r);

  assert.equal(c.boundingVolume, 27);
  assert.equal(c.airCount, 1);
  assert.equal(c.filledCount, 26);
  assert.equal(c.footprintArea, 9);
  assert.equal(Math.round(c.airRatio * 1000) / 1000, 0.037);
  assert.equal(c.distinctBlockTypes, 1);
});

await test('blocks are counted by kind, commonest first', async () => {
  const c = measureComposition(region([['aab', 'aaa']]));
  assert.deepEqual(c.blockCounts, [
    { block: 'stone', count: 5 },
    { block: 'dirt', count: 1 },
  ]);
});

await test('a partly unread region says so rather than reporting short counts as whole', async () => {
  const c = measureComposition(region([['a?', 'aa']]));
  assert.equal(c.unknown, 1);
  assert.equal(c.complete, false);
  assert.equal(c.filledCount, 3, 'the unread block is not counted as anything');
});

console.log('\ntools');

await test('both tools read the region through the same path the reading tool uses', async () => {
  const calls = [];
  const bridge = {
    async request(action, args) {
      calls.push({ action, args });
      return {
        header: { ok: true, total: 4, parts: 1 },
        parts: [{ blocks: ['stone', 'air', 'air', 'stone'] }],
      };
    },
  };
  const tools = new Map(toolsFor(bridge, offlineRunner).map((tool) => [tool.name, tool]));

  const box = { corner1: { x: 0, y: 64, z: 0 }, corner2: { x: 1, y: 64, z: 1 } };
  const symmetry = await tools.get('assess.symmetry').handler(box);
  const composition = await tools.get('assess.composition').handler(box);

  // Same request shape as world.read_region, including the adaptive perMessage - the point of
  // sharing one reader is that the retry and the completeness check cannot drift apart.
  assert.equal(calls[0].action, 'readregion');
  assert.equal(calls[0].args.perMessage, 24);
  assert.deepEqual(symmetry.region.size, { x: 2, y: 1, z: 2 });
  assert.equal(symmetry.rotate_90.applicable, true, 'a 2x2 footprint is square');
  assert.equal(composition.filledCount, 2);
});

await test('neither tool returns a verdict, a score, or the word symmetric', async () => {
  // Guarded because it is the design decision most likely to be "improved" later. A mark
  // collapses a careless mirror and a deliberate asymmetry into one number, and only one of
  // them wants correcting.
  const tools = toolsFor({ async request() { throw new Error('unused'); } }, offlineRunner);
  for (const name of ['assess.symmetry', 'assess.composition']) {
    const tool = tools.find((t) => t.name === name);
    const fields = Object.keys(tool.outputSchema);
    for (const banned of ['score', 'grade', 'passed', 'verdict', 'symmetric', 'rating']) {
      assert.ok(!fields.includes(banned), `${name} grew a "${banned}" field`);
    }
    assert.match(tool.description, /NOT/, `${name} should say what it will not do`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
