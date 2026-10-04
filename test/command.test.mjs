// The escape hatch, and the two things it is allowed to do to what it was handed.
//
//   node test/command.test.mjs
//
// There is nothing to check about what a command *means* - that is the game's business, and
// the whole point of this tool is that it does not know. What is worth checking is the narrow
// band where it does touch the string: a leading slash comes off, a line break is refused, and
// everything else arrives at the runner byte for byte. A tool that quietly rewrote a command
// would be worse than no tool, because the thing that ran would not be the thing that was read.

import assert from 'node:assert/strict';
import { z } from 'zod';

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

/** A runner that records what it was sent and answers with whatever the test wants. */
function runnerAnswering(reply = {}) {
  const sent = [];
  return {
    sent,
    async run(commandLine) {
      sent.push(commandLine);
      // The same shape socket-be produces: a code and a message, plus whatever else the
      // command returned, all in one flat record.
      const data = { statusCode: 0, statusMessage: '', ...reply };
      return {
        commandLine,
        statusCode: data.statusCode,
        statusMessage: data.statusMessage,
        data,
      };
    },
  };
}

const tool = (runner) => toolsFor(offlineBridge, runner).find((t) => t.name === 'world.run_command');

/** Runs it through its own schemas, the way the SDK will. */
async function call(runner, args) {
  const definition = tool(runner);
  const parsed = z.object(definition.inputSchema).parse(args);
  const result = await definition.handler(parsed);
  return z.object(definition.outputSchema).parse(result);
}

console.log('world.run_command');

await test('the command reaches the game exactly as written', async () => {
  const runner = runnerAnswering();
  const result = await call(runner, { command: 'give @a diamond_pickaxe 1' });

  assert.deepEqual(runner.sent, ['give @a diamond_pickaxe 1']);
  assert.equal(result.command, 'give @a diamond_pickaxe 1');
});

await test('a leading slash is how it is typed, not how it is sent', async () => {
  // Which form a model writes is a coin flip. Both have to work, and both have to send the
  // same line - otherwise the same lesson behaves differently depending on how it was phrased.
  const runner = runnerAnswering();
  await call(runner, { command: '/time set noon' });
  await call(runner, { command: 'time set noon' });

  assert.deepEqual(runner.sent, ['time set noon', 'time set noon']);
});

await test('surrounding whitespace is trimmed, inner spacing is not', async () => {
  const runner = runnerAnswering();
  await call(runner, { command: '  say  hello   world  ' });
  assert.deepEqual(runner.sent, ['say  hello   world']);
});

await test('a line break is refused before anything is sent', async () => {
  // Not because a second command is known to get through, but because a string with a break
  // in it was assembled wrong, and half of it arriving is the worst of the outcomes.
  const runner = runnerAnswering();
  assert.throws(() => z.object(tool(runner).inputSchema).parse({ command: 'say hi\nkill @a' }));
  assert.deepEqual(runner.sent, [], 'nothing should have been sent');
});

await test('an empty command is refused, slashes included', async () => {
  const runner = runnerAnswering();
  assert.throws(() => z.object(tool(runner).inputSchema).parse({ command: '   ' }));
  await assert.rejects(call(runner, { command: '///' }), /slashes/);
  assert.deepEqual(runner.sent, [], 'nothing should have been sent');
});

await test('a negative status code is an answer, not a failure', async () => {
  // "0 blocks filled" is negative and describes a fill that ran. Judging the code here would
  // turn a delivered command into a reported error.
  const runner = runnerAnswering({ statusCode: -2147483648, statusMessage: '0 blocks filled' });
  const result = await call(runner, { command: 'fill 0 64 0 0 64 0 stone' });

  assert.equal(result.statusCode, -2147483648);
  assert.equal(result.statusMessage, '0 blocks filled');
});

await test('a field this tool has never heard of still comes back', async () => {
  // The reason `data` is passed through whole: querytarget puts its actual answer in
  // `details`, and there is no list of which commands do that.
  const runner = runnerAnswering({ details: '[{"uniqueId":"a"}]' });
  const result = await call(runner, { command: 'querytarget @a' });

  assert.equal(result.data.details, '[{"uniqueId":"a"}]');
});

await test('nothing connected fails with something a person can act on', async () => {
  // The default runner is the offline one, which is what an unbound server registers.
  await assert.rejects(call(undefined, { command: 'time set noon' }), /connect/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
