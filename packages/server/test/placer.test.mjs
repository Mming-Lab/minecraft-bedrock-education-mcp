// Placing what the shape tools computed.
//
//   node test/placer.test.mjs
//
// Until this existed, every building tool stopped one step short: it worked out the positions
// a shape covers, summarised them, and returned. Nothing was placed. A model calling
// build.sphere got a confident report of a sphere that was not there.
//
// What is checked here is mostly about failure, because the successful case is a fill command
// and there is not much to get wrong about it. The failures are subtler:
//
//   - Bedrock's negative status codes do not mean refused, and treating them as errors would
//     report working builds as broken.
//   - A command that never left is a real failure and has to be visible.
//   - Everything failing to leave is a missing connection, not a partial build, and saying so
//     once is more use than a report of nothing having happened.

import assert from 'node:assert/strict';

import { placeBlocks, commandsFor, MAX_IN_FLIGHT } from '../dist/execute/placer.js';
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

/** A runner that accepts everything and remembers what it was asked, and how many at once. */
function fakeRunner({ answer } = {}) {
  const sent = [];
  let inFlight = 0;
  let peak = 0;
  return {
    sent,
    get peak() {
      return peak;
    },
    async run(commandLine) {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // A turn of the event loop, so concurrency is real rather than an artefact of every
      // call resolving before the next begins.
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      sent.push(commandLine);
      const outcome = answer?.(commandLine);
      if (outcome instanceof Error) throw outcome;
      return outcome ?? { commandLine, statusCode: 0, statusMessage: '' };
    },
  };
}

/** A solid box of positions, which the packer should turn into one fill. */
function box(size) {
  const positions = [];
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++) positions.push({ x, y: 64 + y, z });
  return positions;
}

/** Isolated blocks, one fill each - the worst case for command count. */
function scattered(count) {
  return Array.from({ length: count }, (_, i) => ({ x: i * 2, y: 64, z: 0 }));
}

console.log('placing blocks');

await test('a solid box becomes one fill', async () => {
  const runner = fakeRunner();
  const report = await placeBlocks(runner, box(4), 'stone');

  assert.equal(report.blockCount, 64);
  assert.equal(report.commandCount, 1);
  assert.equal(runner.sent.length, 1);
  assert.match(runner.sent[0], /^fill 0 64 0 3 67 3 minecraft:stone replace$/);
});

await test('scattered blocks become one fill each', async () => {
  const runner = fakeRunner();
  const report = await placeBlocks(runner, scattered(10), 'stone');

  assert.equal(report.blockCount, 10);
  assert.equal(report.commandCount, 10);
});

await test('no more than the measured number of commands is in flight', async () => {
  // 100 concurrent commands was measured to be safe once; 64 stays under it. Unbounded is not
  // an option - a shape can be thousands of positions, and a game that silently drops
  // commands under load would look exactly like a shape that built wrong.
  const runner = fakeRunner();
  await placeBlocks(runner, scattered(200), 'stone');

  assert.equal(runner.sent.length, 200);
  assert.ok(runner.peak <= MAX_IN_FLIGHT, `${runner.peak} commands were in flight at once`);
  assert.ok(runner.peak > 1, 'commands were sent one at a time; 200 fills would crawl');
});

await test('a negative status is reported, not treated as a failure', async () => {
  // "0 blocks filled" is negative and describes a command that ran. Of seventeen commands in
  // an earlier corpus, eight looked refused and one actually was.
  const runner = fakeRunner({
    answer: (commandLine) => ({ commandLine, statusCode: -2147483648, statusMessage: '0 個のブロックで満たしました' }),
  });
  const report = await placeBlocks(runner, box(2), 'stone');

  assert.equal(report.commandCount, 1);
  assert.equal(report.unsent.length, 0, 'a negative code is not a failure to send');
  assert.equal(report.negative.length, 1);
  assert.match(report.negative[0].statusMessage, /満たしました/);
});

await test('a command that never left is reported as unsent', async () => {
  let calls = 0;
  const runner = fakeRunner({
    answer: (commandLine) => (++calls === 2 ? new Error('socket closed') : { commandLine, statusCode: 0, statusMessage: '' }),
  });
  const report = await placeBlocks(runner, scattered(4), 'stone');

  // The other three still went. A half-built shape the caller knows about beats an exception
  // that leaves them guessing how far it got.
  assert.equal(report.commandCount, 4);
  assert.equal(report.unsent.length, 1);
  assert.match(report.unsent[0].reason, /socket closed/);
});

await test('everything failing to send is a missing connection, not a partial build', async () => {
  const runner = fakeRunner({ answer: () => new Error('Minecraft is not connected. Run /connect localhost:19131.') });
  await assert.rejects(placeBlocks(runner, scattered(5), 'stone'), /\/connect localhost:19131/);
});

await test('the commands are the same ones the command layer would build', async () => {
  // commandsFor is the dry run: same packing, same strings, nothing sent. Worth having
  // separately so a caller can see what a build would do without doing it.
  const { commands, blockCount } = commandsFor(box(3), 'minecraft:oak_planks');
  assert.equal(blockCount, 27);
  assert.deepEqual(commands, ['fill 0 64 0 2 66 2 minecraft:oak_planks replace']);
});

console.log('\nbuilding tools, bound to a connection');

await test('build.cube actually sends a fill', async () => {
  // The bound form of the tool - what the MCP client calls. Before the executor existed this
  // returned the same summary and placed nothing at all.
  const runner = fakeRunner();
  const tools = new Map(toolsFor(offlineBridge, runner).map((tool) => [tool.name, tool]));
  const result = await tools.get('build.cube').handler({
    corner1: { x: 0, y: 64, z: 0 },
    corner2: { x: 3, y: 67, z: 3 },
    block: 'stone',
  });

  assert.equal(result.blockCount, 64);
  assert.equal(result.commandCount, 1);
  assert.equal(runner.sent.length, 1, 'the tool computed a shape and placed nothing');
  assert.match(runner.sent[0], /^fill /);
});

await test('a shape tool can place a block facing a direction', async () => {
  // Until this was wired, no tool on the surface could set a block state: BlockStates was
  // defined and unused, the command layer supported it, and nothing connected the two. "Build
  // a roof out of stairs facing north" was not expressible.
  const runner = fakeRunner();
  const tools = new Map(toolsFor(offlineBridge, runner).map((tool) => [tool.name, tool]));
  await tools.get('build.cube').handler({
    corner1: { x: 0, y: 64, z: 0 },
    corner2: { x: 1, y: 64, z: 0 },
    block: 'oak_stairs',
    states: { weirdo_direction: 2 },
  });

  assert.equal(runner.sent.length, 1);
  assert.match(runner.sent[0], /minecraft:oak_stairs \["weirdo_direction"=2\]/);
});

await test('the result does not carry two thousand coordinates back to the model', async () => {
  const runner = fakeRunner();
  const tools = new Map(toolsFor(offlineBridge, runner).map((tool) => [tool.name, tool]));
  const result = await tools.get('build.sphere').handler({
    center: { x: 0, y: 64, z: 0 },
    radius: 8,
    block: 'stone',
  });

  assert.ok(result.blockCount > 2000);
  assert.equal(result.positions, undefined, 'the position list leaked into the tool result');
});

await test('a build with nothing connected says how to connect', async () => {
  const tools = new Map(toolsFor(offlineBridge).map((tool) => [tool.name, tool]));
  await assert.rejects(
    async () =>
      tools.get('build.cube').handler({
        corner1: { x: 0, y: 64, z: 0 },
        corner2: { x: 1, y: 65, z: 1 },
        block: 'stone',
      }),
    /\/connect localhost:19131/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
