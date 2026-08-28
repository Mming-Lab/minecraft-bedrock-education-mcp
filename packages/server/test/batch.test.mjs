// Many shapes in one call.
//
//   node test/batch.test.mjs
//
// Measured on a real session: a tree of 49 curves spent 98% of its 385 seconds on the calls
// themselves. A regression over 152 calls from that session found `ms = 2058 - 1.24 x fills`
// with R-squared 0.0017 and a negative slope - how much a call places does not measurably
// affect how long it takes, and how many calls there are is the whole cost.
//
// So what is worth testing here is not speed, which cannot be measured without a game. It is
// the two things a batch can get wrong that separate calls could not:
//
//   - overlaps. Two shapes claiming one block must resolve *before* any command is generated,
//     because the placer runs sixty-four fills at once and its own comment says order does not
//     matter "because the boxes are disjoint" - true for one shape, false for two.
//   - which entry failed. One bad entry in five hundred has to name itself, or the caller is
//     told only that something somewhere is wrong.
//
// The schema is also checked against what the SDK actually emits, because the whole case for
// this tool over ten plural ones rests on `required` surviving per branch, and asserting that
// from the zod side would only prove zod agrees with itself.

import assert from 'node:assert/strict';
import { z } from 'zod';

import { toolsFor, offlineBridge, MAX_SHAPES } from '../dist/tools/index.js';
import { resetPlans, getPlan } from '../dist/plan/store.js';

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

const tool = (runner) => toolsFor(offlineBridge, runner).find((t) => t.name === 'build.batch');
const P = (x, y, z) => ({ x, y, z });

console.log('batch');

await test('one call places several kinds of shape', async () => {
  resetPlans();
  const runner = fakeRunner();
  const result = await tool(runner).handler({
    shapes: [
      { type: 'cube', corner1: P(0, 0, 0), corner2: P(2, 0, 2), block: 'stone' },
      { type: 'sphere', center: P(20, 0, 0), radius: 2, block: 'oak_log' },
      { type: 'curve', start: P(40, 0, 0), end: P(48, 6, 0), controlPoints: [P(44, 0, 0)], block: 'oak_log' },
    ],
  });
  assert.equal(result.shapeCount, 3);
  assert.equal(result.placed, true);
  assert.ok(result.blockCount > 9);
  // Two materials, so two groups - and the commonest first.
  assert.deepEqual(result.blocks.map((b) => b.block).sort(), ['oak_log', 'stone']);
});

await test('overlapping shapes are written once, and the later one wins', async () => {
  // The reason overlaps have to resolve before commands are generated. Two cubes covering the
  // same block, different materials: separate calls would write it twice and the second
  // command would answer "0 blocks filled". Here it is written once, as the second block.
  resetPlans();
  const runner = fakeRunner();
  const result = await tool(runner).handler({
    shapes: [
      { type: 'cube', corner1: P(0, 0, 0), corner2: P(3, 0, 0), block: 'stone' },
      { type: 'cube', corner1: P(2, 0, 0), corner2: P(5, 0, 0), block: 'oak_log' },
    ],
  });
  assert.equal(result.blockCount, 6, 'x from 0 to 5 is six blocks');
  assert.equal(result.overlaps, 2, 'x=2 and x=3 were claimed twice');
  const oak = result.blocks.find((b) => b.block === 'oak_log');
  assert.equal(oak.count, 4, 'the later shape should own the two it shares');
  // Every command carries one material, and no position is filled by two of them.
  assert.ok(runner.sent.every((line) => line.includes('stone') !== line.includes('oak_log')));
});

await test('a bad entry names its own index', async () => {
  // One entry in five hundred. Without the index the caller is told only that something is
  // wrong, and has to resend all of them to find out which.
  resetPlans();
  await assert.rejects(
    () =>
      tool(fakeRunner()).handler({
        shapes: [
          { type: 'cube', corner1: P(0, 0, 0), corner2: P(2, 0, 2), block: 'stone' },
          { type: 'sphere', center: P(0, 0, 0), radius: 3, block: 'stone' },
          { type: 'revolution', center: P(0, 0, 0), shape: 'hyperboloid', height: 6, block: 'stone' },
        ],
      }),
    /shapes\[2\].*revolution/
  );
});

await test('fewer than two shapes is refused at the schema, not in the handler', () => {
  // The whole use of the minimum: it decides "one shape or many" mechanically instead of
  // asking the description to explain when to use which.
  const schema = tool(fakeRunner()).inputSchema.shapes;
  assert.throws(() => schema.parse([{ type: 'cube', corner1: P(0, 0, 0), corner2: P(1, 0, 1), block: 'stone' }]));
  assert.doesNotThrow(() =>
    schema.parse([
      { type: 'cube', corner1: P(0, 0, 0), corner2: P(1, 0, 1), block: 'stone' },
      { type: 'cube', corner1: P(4, 0, 0), corner2: P(5, 0, 1), block: 'stone' },
    ])
  );
});

await test('every shape tool has a branch, so none can be reached only one at a time', () => {
  // Built from buildTools rather than written out, which is what stops the branch list drifting
  // from the tool list. design/tool-surface-audit.md measured what a second ledger costs: the
  // legacy sequence tool advertised eight cross-tool actions and eight of them did not exist.
  const shapes = toolsFor(offlineBridge, fakeRunner())
    .filter((t) => t.name.startsWith('build.') && t.inputSchema.dryRun && t.name !== 'build.batch')
    .map((t) => t.name.slice('build.'.length));
  const json = z.toJSONSchema(z.object({ s: tool(fakeRunner()).inputSchema.shapes }));
  const items = json.properties.s.items;
  const covered = (items.anyOf ?? items.oneOf).map((b) => b.properties.type.const);
  assert.deepEqual(covered.sort(), shapes.sort());
});

await test('the JSON Schema keeps required accurate on each branch', () => {
  // The case for one batch tool over ten plural ones rests entirely on this. D-6 rejected the
  // legacy action enum because "the input schema became the union of every action's parameters,
  // so nothing could be marked required". A discriminated union does not do that — and the
  // check has to be against what the SDK emits, since asserting it from the zod side would
  // only prove zod agrees with itself.
  const json = z.toJSONSchema(z.object({ s: tool(fakeRunner()).inputSchema.shapes }));
  const items = json.properties.s.items;
  const branches = items.anyOf ?? items.oneOf;
  const required = Object.fromEntries(branches.map((b) => [b.properties.type.const, b.required.sort()]));

  assert.deepEqual(required.cube, ['block', 'corner1', 'corner2', 'type']);
  assert.deepEqual(required.sphere, ['block', 'center', 'type']);
  assert.deepEqual(required.curve, ['block', 'controlPoints', 'end', 'start', 'type']);
  // A const, not a free enum to be guessed at.
  for (const branch of branches) assert.equal(typeof branch.properties.type.const, 'string');
});

await test('dryRun keeps the whole set as one plan and sends nothing', async () => {
  // One planId for the tree, not forty-nine. plan.preview takes one id, so a batch is the only
  // way to draw a whole tree before growing it.
  resetPlans();
  const runner = fakeRunner();
  const result = await tool(runner).handler({
    shapes: [
      { type: 'cube', corner1: P(0, 0, 0), corner2: P(2, 0, 2), block: 'stone' },
      { type: 'sphere', center: P(20, 0, 0), radius: 2, block: 'stone' },
    ],
    dryRun: true,
  });
  assert.equal(result.placed, false);
  assert.equal(result.commandCount, 0);
  assert.equal(runner.sent.length, 0, 'a dry run reached the game');
  assert.equal(getPlan(result.planId).positions.length, result.blockCount);
});

await test('states ride with the entry they belong to', async () => {
  resetPlans();
  const runner = fakeRunner();
  await tool(runner).handler({
    shapes: [
      { type: 'cube', corner1: P(0, 0, 0), corner2: P(0, 0, 0), block: 'oak_stairs', states: { weirdo_direction: 2 } },
      { type: 'cube', corner1: P(4, 0, 0), corner2: P(4, 0, 0), block: 'oak_stairs', states: { weirdo_direction: 0 } },
    ],
  });
  // Two different facings of the same block are two groups, not one.
  assert.equal(runner.sent.filter((l) => l.includes('weirdo_direction')).length, 2);
  assert.ok(runner.sent.some((l) => l.includes('=2')));
  assert.ok(runner.sent.some((l) => l.includes('=0')));
});

await test('the cap is stated in the schema rather than discovered', () => {
  const schema = tool(fakeRunner()).inputSchema.shapes;
  const many = Array.from({ length: MAX_SHAPES + 1 }, () => ({
    type: 'cube', corner1: P(0, 0, 0), corner2: P(1, 0, 1), block: 'stone',
  }));
  assert.throws(() => schema.parse(many));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
