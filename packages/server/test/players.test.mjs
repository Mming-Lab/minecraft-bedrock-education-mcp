// Finding the players, which is where a session has to start.
//
//   node test/players.test.mjs
//
// The reply below is copied from a real Education Edition session, whitespace and all,
// including the detail that decided how this is parsed: the same JSON appears twice, once in
// `details` and once in `statusMessage` behind a translated sentence. Reading the message
// would work on an English client and fail on this one, which is exactly the trap that made
// `testforblock` unusable.

import assert from 'node:assert/strict';

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

/** Verbatim from tools/live-probe/dump — one player, Japanese client. */
const REAL_DETAILS = `[
   {
      "dimension" : 0,
      "id" : -4294967295,
      "position" : {
         "x" : 0.03751239180564880,
         "y" : -53.50066375732422,
         "z" : -2.362322807312012
      },
      "uniqueId" : "53ab992d-059a-37fc-bfe5-f018244769d7",
      "yRot" : 164.1412353515625
   }
]
`;

function runnerReturning(data) {
  const sent = [];
  return {
    sent,
    async run(commandLine) {
      sent.push(commandLine);
      // statusMessage appears both at the top level and inside `data`, because socket-be's
      // result is `{statusCode, statusMessage} & whatever else the command returned`. The fake
      // has to do the same or a test can pass against a shape the real transport never sends.
      return {
        commandLine,
        statusCode: 0,
        statusMessage: typeof data.statusMessage === 'string' ? data.statusMessage : '',
        data,
      };
    },
  };
}

const playersTool = (runner) => toolsFor(offlineBridge, runner).find((tool) => tool.name === 'world.players');

console.log('world.players');

await test('a real reply becomes positions', async () => {
  const runner = runnerReturning({ details: REAL_DETAILS });
  const result = await playersTool(runner).handler({});

  assert.deepEqual(runner.sent, ['querytarget @a']);
  assert.equal(result.count, 1);
  assert.equal(result.players[0].x, 0.0375123918056488);
  assert.equal(result.players[0].y, -53.50066375732422);
  assert.equal(result.players[0].dimension, 'overworld');
  assert.equal(result.players[0].facing, 164.1412353515625);
  assert.equal(result.players[0].uniqueId, '53ab992d-059a-37fc-bfe5-f018244769d7');
});

await test('the translated statusMessage is not what gets parsed', async () => {
  // Same JSON, behind "対象となるデータ: ". Parsing the message instead of `details` works on
  // an English client and breaks on this one - the failure mode that made testforblock
  // unusable for reading blocks.
  const runner = runnerReturning({
    details: REAL_DETAILS,
    statusMessage: `対象となるデータ: ${REAL_DETAILS}`,
  });
  const result = await playersTool(runner).handler({});
  assert.equal(result.count, 1);
});

await test('several players all come back', async () => {
  const runner = runnerReturning({
    details: JSON.stringify([
      { dimension: 0, position: { x: 1, y: 2, z: 3 }, uniqueId: 'a', yRot: 0 },
      { dimension: 1, position: { x: -10, y: 60, z: 5 }, uniqueId: 'b', yRot: 90 },
    ]),
  });
  const result = await playersTool(runner).handler({});

  assert.equal(result.count, 2);
  assert.equal(result.players[1].dimension, 'nether');
});

await test('an entry with no position is dropped, not placed at the origin', async () => {
  // A player at 0,0,0 and a player whose position did not arrive are different things, and
  // one of them is somewhere a model might then build.
  const runner = runnerReturning({
    details: JSON.stringify([{ dimension: 0, uniqueId: 'a' }, { dimension: 0, position: { x: 5, y: 6, z: 7 }, uniqueId: 'b' }]),
  });
  const result = await playersTool(runner).handler({});

  assert.equal(result.count, 1);
  assert.equal(result.players[0].x, 5);
});

await test('nobody connected is an empty list, not a failure', async () => {
  const runner = runnerReturning({ details: '[]' });
  const result = await playersTool(runner).handler({});
  assert.deepEqual(result, { players: [], count: 0 });
});

await test('a reply with no details field says what the game did answer', async () => {
  const runner = runnerReturning({ statusMessage: '構文エラー' });
  await assert.rejects(playersTool(runner).handler({}), /構文エラー/);
});

await test('a details field that is not JSON is refused', async () => {
  const runner = runnerReturning({ details: 'not json at all' });
  await assert.rejects(playersTool(runner).handler({}), /not JSON/);
});

await test('with nothing connected it says how to connect', async () => {
  await assert.rejects(
    async () => toolsFor(offlineBridge).find((tool) => tool.name === 'world.players').handler({}),
    /\/connect localhost:19131/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
