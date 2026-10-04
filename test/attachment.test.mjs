// What waits for what, and the two-wave send that makes the waiting real.
//
//   node test/attachment.test.mjs
//
// The bug: a batch of a wall and the ladders on it is two groups, grouped by block, and the
// placer sends up to sixty-four fills at once. The ladder could be written first and the wall
// arriving behind it knocked it off - and both fills reported success, so nothing in the result
// said the ladder was gone.
//
// Two things are checked. The classifier, because a *support* block wrongly listed as hanging
// would move into the late wave alongside what sits on it and re-create the race somewhere
// new - so the near-miss names matter more than the obvious ones. And the wave boundary, by
// asserting that every hanging fill is sent after every supporting one, which holds whatever
// order the concurrent workers happen to finish in.

import assert from 'node:assert/strict';

import { needsSupport } from '../dist/commands/attachment.js';
import { placeGroups } from '../dist/execute/placer.js';

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

/** Records what it was sent, in the order the game would have seen it. */
function fakeRunner() {
  const sent = [];
  return {
    sent,
    async run(commandLine) {
      // A turn of the event loop, so the concurrency inside a wave is real and the ordering
      // being asserted is the wave boundary rather than an artefact of synchronous resolution.
      await new Promise((resolve) => setTimeout(resolve, 1));
      sent.push(commandLine);
      return { commandLine, statusCode: 0, statusMessage: '' };
    },
  };
}

const line = (y) => Array.from({ length: 8 }, (_, x) => ({ x, y, z: 0 }));

console.log('what hangs on something');

await test('the blocks the bug was reported for wait', () => {
  for (const block of ['ladder', 'torch', 'stone_button', 'oak_button', 'lever', 'wall_sign']) {
    assert.equal(needsSupport(block), true, `${block} should wait`);
  }
});

await test('a namespaced id is treated the same as a bare one', () => {
  assert.equal(needsSupport('minecraft:ladder'), true);
  assert.equal(needsSupport({ id: 'minecraft:torch' }), true);
  assert.equal(needsSupport({ id: 'ladder', states: { facing_direction: 2 } }), true);
});

await test('ordinary building blocks do not wait', () => {
  for (const block of ['stone', 'air', 'minecraft:oak_planks', 'glass', 'oak_stairs', 'cobblestone_wall']) {
    assert.equal(needsSupport(block), false, `${block} should not wait`);
  }
});

await test('a full block whose name resembles a hanging one does not wait', () => {
  // The dangerous direction. Any of these in the late wave would travel with the things that
  // sit on them, which is the race this change exists to remove.
  for (const block of [
    'sea_lantern',
    'coral_block',
    'tube_coral_block',
    'brown_mushroom_block',
    'mushroom_stem',
    'amethyst_block',
    'budding_amethyst',
    'grass',
    'redstone_block',
    'redstone_lamp',
    'note_block',
  ]) {
    assert.equal(needsSupport(block), false, `${block} is a full block and must not be deferred`);
  }
});

await test('their near-namesakes do wait', () => {
  for (const block of [
    'lantern',
    'soul_lantern',
    'tube_coral',
    'tube_coral_fan',
    'brown_mushroom',
    'red_mushroom',
    'amethyst_cluster',
    'large_amethyst_bud',
    'short_grass',
    'tall_grass',
    'redstone_wire',
  ]) {
    assert.equal(needsSupport(block), true, `${block} should wait`);
  }
});

await test("Education Edition's coloured torches are torches", () => {
  // Their names end in the colour rather than in `torch`, so a suffix match would miss them.
  assert.equal(needsSupport('colored_torch_bp'), true);
  assert.equal(needsSupport('colored_torch_rg'), true);
});

console.log('\ntwo waves');

await test('every ladder fill is sent after every wall fill', async () => {
  const runner = fakeRunner();
  // The ladder group first in the argument list, which is the order that used to lose.
  const report = await placeGroups(runner, [
    { block: 'ladder', positions: line(65) },
    { block: 'stone', positions: line(64) },
  ]);

  const lastWall = runner.sent.findLastIndex((c) => c.includes('stone'));
  const firstLadder = runner.sent.findIndex((c) => c.includes('ladder'));
  assert.ok(lastWall >= 0 && firstLadder >= 0, `both kinds should have been sent: ${runner.sent}`);
  assert.ok(
    firstLadder > lastWall,
    `the ladder went out before the wall was finished: ${JSON.stringify(runner.sent)}`
  );
  assert.equal(report.commandCount, runner.sent.length);
});

await test('a build with nothing hanging is still one wave', async () => {
  const runner = fakeRunner();
  const report = await placeGroups(runner, [
    { block: 'stone', positions: line(64) },
    { block: 'glass', positions: line(65) },
  ]);
  assert.equal(report.commandCount, 2);
  assert.equal(runner.sent.length, 2);
});

await test('a build of nothing but ladders still places them', async () => {
  // Nothing to wait for is not a reason to wait forever: the first wave is empty and the
  // second one carries the lot.
  const runner = fakeRunner();
  const report = await placeGroups(runner, [{ block: 'ladder', positions: line(64) }]);
  assert.equal(report.commandCount, 1);
  assert.equal(runner.sent.length, 1);
  assert.match(runner.sent[0], /ladder/);
});

await test('both waves are counted in one report', async () => {
  const runner = fakeRunner();
  const report = await placeGroups(runner, [
    { block: 'stone', positions: line(64) },
    { block: 'torch', positions: line(65) },
  ]);
  assert.equal(report.blockCount, 16, 'eight stone and eight torches');
  assert.equal(report.commandCount, 2);
  assert.deepEqual(report.unsent, []);
  assert.deepEqual(report.negative, []);
});

await test('a negative answer from either wave is reported', async () => {
  const runner = {
    sent: [],
    async run(commandLine) {
      runner.sent.push(commandLine);
      return commandLine.includes('ladder')
        ? { commandLine, statusCode: -2147483648, statusMessage: '0 blocks filled' }
        : { commandLine, statusCode: 0, statusMessage: '' };
    },
  };
  const report = await placeGroups(runner, [
    { block: 'stone', positions: line(64) },
    { block: 'ladder', positions: line(65) },
  ]);
  assert.equal(report.negative.length, 1);
  assert.match(report.negative[0].commandLine, /ladder/);
});

await test('nothing connected is still one error rather than a report of nothing', async () => {
  // Both waves fail, and the combined check has to see that as a missing connection - not as a
  // first wave that worked and a second that did not.
  const dead = {
    async run() {
      throw new Error('Minecraft is not connected. In the game, run /connect localhost:19131.');
    },
  };
  await assert.rejects(
    placeGroups(dead, [
      { block: 'stone', positions: line(64) },
      { block: 'ladder', positions: line(65) },
    ]),
    /connect/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
