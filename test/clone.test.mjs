// Copying a region with `/clone`.
//
//   node test/clone.test.mjs
//
// This tool exists because the layer grid cannot carry block states. The add-on's region read
// sends ids alone, so a staircase read and rebuilt comes back facing whichever way is default
// - which nobody notices until the thing being moved is a house rather than a sphere. `/clone`
// never converts anything, so the states survive.
//
// What is checked here is the command string and the refusals, since that is all this tool is:
// a translation from two corners into Bedrock's argument order. Whether the blocks arrive is a
// question for world.read_region, and whether they arrive *with their states* is a question for
// a live game.

import assert from 'node:assert/strict';

import { toolsFor, offlineBridge, CLONE_VOLUME_LIMIT } from '../dist/tools/index.js';

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

function fakeRunner(outcome) {
  const sent = [];
  return {
    sent,
    async run(commandLine) {
      sent.push(commandLine);
      return { commandLine, statusCode: 0, statusMessage: '', data: {}, ...outcome };
    },
  };
}

const cloneTool = (runner) => toolsFor(offlineBridge, runner).find((tool) => tool.name === 'build.clone_region');

console.log('build.clone_region');

await test('two corners become begin, end and destination in Bedrock order', async () => {
  const runner = fakeRunner();
  const result = await cloneTool(runner).handler({
    corner1: { x: 10, y: 64, z: 20 },
    corner2: { x: 12, y: 66, z: 22 },
    destination: { x: 100, y: 64, z: 200 },
  });

  assert.deepEqual(runner.sent, ['clone 10 64 20 12 66 22 100 64 200 replace normal']);
  assert.equal(result.volume, 27);
  assert.equal(result.commandLine, runner.sent[0]);
});

await test('the corners may be given in any order', async () => {
  const runner = fakeRunner();
  await cloneTool(runner).handler({
    corner1: { x: 12, y: 66, z: 22 },
    corner2: { x: 10, y: 64, z: 20 },
    destination: { x: 0, y: 0, z: 0 },
  });

  // Normalised, so the destination always means "where the lowest corner lands" regardless of
  // which way round the caller described the box.
  assert.match(runner.sent[0], /^clone 10 64 20 12 66 22 0 0 0 /);
});

await test('move and masked reach the command as written', async () => {
  const runner = fakeRunner();
  await cloneTool(runner).handler({
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 1, y: 1, z: 1 },
    destination: { x: 5, y: 0, z: 0 },
    mask_mode: 'masked',
    clone_mode: 'move',
  });

  assert.equal(runner.sent[0], 'clone 0 0 0 1 1 1 5 0 0 masked move');
});

await test('a region over the limit is refused before anything is sent', async () => {
  const runner = fakeRunner();
  const side = Math.ceil(Math.cbrt(CLONE_VOLUME_LIMIT)) + 2;
  await assert.rejects(
    cloneTool(runner).handler({
      corner1: { x: 0, y: 0, z: 0 },
      corner2: { x: side, y: side, z: side },
      destination: { x: 1000, y: 0, z: 0 },
    }),
    new RegExp(`over /clone's ${CLONE_VOLUME_LIMIT}-block limit`)
  );
  assert.equal(runner.sent.length, 0);
});

await test('a negative status is passed through, not raised', async () => {
  // Same rule as every other write. "0 blocks cloned" is negative and describes a command that
  // ran, and the message arrives in the client's language, so neither is a verdict.
  const runner = fakeRunner({ statusCode: -2147483648, statusMessage: 'そのエリアは読み込まれていません' });
  const result = await cloneTool(runner).handler({
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 1, y: 1, z: 1 },
    destination: { x: 9, y: 0, z: 0 },
  });

  assert.equal(result.statusCode, -2147483648);
  assert.match(result.statusMessage, /読み込まれていません/);
});

await test('with nothing connected it says how to connect', async () => {
  await assert.rejects(
    async () =>
      toolsFor(offlineBridge)
        .find((tool) => tool.name === 'build.clone_region')
        .handler({
          corner1: { x: 0, y: 0, z: 0 },
          corner2: { x: 1, y: 1, z: 1 },
          destination: { x: 9, y: 0, z: 0 },
        }),
    /\/connect localhost:19131/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
