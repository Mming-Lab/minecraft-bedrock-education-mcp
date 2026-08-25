// Ticking areas: the only tools under world.* that change the world.
//
//   node test/area.test.mjs
//
// They exist because `?` in a region grid was a dead end. The reading tools could say "these
// chunks are not loaded" and the advice attached to that was "read again once the area is
// loaded", with nothing on the surface able to load one.
//
// What is guarded here is mostly the arithmetic of chunks, and one piece of honesty: these are
// declared as changing the world, because a ticking area simulates what it loads. A tool that
// enabled reading and claimed to be read-only would be lying in the one field a model uses to
// decide whether it is safe to call something.

import assert from 'node:assert/strict';

import { toolsFor, offlineBridge, MAX_AREA_CHUNKS, MAX_TICKING_AREAS } from '../dist/tools/index.js';

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

const tool = (runner, name) => toolsFor(offlineBridge, runner).find((t) => t.name === name);

console.log('ticking areas');

await test('a box becomes a tickingarea add with the corners normalised', async () => {
  const runner = fakeRunner();
  const result = await tool(runner, 'world.load_area').handler({
    corner1: { x: 100, y: 64, z: 200 },
    corner2: { x: 60, y: 64, z: 150 },
    name: 'probe',
  });

  // y is dropped: a ticking area is a column of chunks, and passing a height the game ignores
  // would suggest it could be limited by one.
  assert.equal(runner.sent[0], 'tickingarea add 60 0 150 100 0 200 probe');
  assert.equal(result.name, 'probe');
});

await test('the chunk estimate counts chunks touched, not blocks divided', async () => {
  // A 2-block box that straddles a chunk boundary costs two chunks, not one. Dividing the
  // width by 16 would say one, and the limit would be checked against the wrong number.
  const runner = fakeRunner();
  const straddling = await tool(runner, 'world.load_area').handler({
    corner1: { x: 15, y: 0, z: 0 },
    corner2: { x: 16, y: 0, z: 0 },
    name: 'edge',
  });
  assert.equal(straddling.approximateChunks, 2);

  const inside = await tool(runner, 'world.load_area').handler({
    corner1: { x: 1, y: 0, z: 1 },
    corner2: { x: 14, y: 0, z: 14 },
    name: 'inside',
  });
  assert.equal(inside.approximateChunks, 1);
});

await test('a box over the chunk limit is refused before anything is sent', async () => {
  const runner = fakeRunner();
  const side = (MAX_AREA_CHUNKS + 20) * 16;
  await assert.rejects(
    tool(runner, 'world.load_area').handler({
      corner1: { x: 0, y: 0, z: 0 },
      corner2: { x: side, y: 0, z: 16 },
      name: 'toobig',
    }),
    new RegExp(`over the ${MAX_AREA_CHUNKS} a ticking area allows`)
  );
  assert.equal(runner.sent.length, 0);
  // The message has to mention the other limit too: shrinking the box is only half the advice
  // when there are ten areas in total.
  await assert.rejects(
    tool(runner, 'world.load_area').handler({
      corner1: { x: 0, y: 0, z: 0 },
      corner2: { x: side, y: 0, z: 16 },
      name: 'toobig',
    }),
    new RegExp(`only ${MAX_TICKING_AREAS} areas`)
  );
});

await test('a name that is not a bare word is refused at the schema', async () => {
  // It goes straight into a command line. The same reasoning as block ids, which reject
  // anything that could change what the command means.
  const runner = fakeRunner();
  const schema = tool(runner, 'world.load_area').inputSchema.name;
  assert.throws(() => schema.parse('probe area'));
  assert.throws(() => schema.parse('probe"'));
  assert.doesNotThrow(() => schema.parse('mcp_probe_1'));
});

await test('removing takes the name and nothing else', async () => {
  const runner = fakeRunner();
  await tool(runner, 'world.unload_area').handler({ name: 'probe' });
  assert.deepEqual(runner.sent, ['tickingarea remove probe']);
});

await test('listing passes the game text through rather than parsing it', async () => {
  // The listing is translated. Parsing it is what made testforblock unusable for reading
  // blocks, and there is no reason to repeat that here.
  const runner = fakeRunner({ statusMessage: '1 個の常時読み込み領域が見つかりました' });
  const result = await tool(runner, 'world.loaded_areas').handler({});
  assert.equal(runner.sent[0], 'tickingarea list all-dimensions');
  assert.match(result.statusMessage, /常時読み込み領域/);
});

await test('these are the only world.* tools that admit to changing the world', async () => {
  // The point of the annotation. A tool that enabled reading and claimed readOnlyHint would be
  // wrong in the one field a model uses to decide whether calling it is safe - and a ticking
  // area runs what it loads: water flows, sand falls, crops grow.
  const all = toolsFor(offlineBridge, fakeRunner());
  const writers = all.filter((t) => t.name.startsWith('world.') && t.annotations?.readOnlyHint === false);
  assert.deepEqual(
    writers.map((t) => t.name).sort(),
    ['world.load_area', 'world.unload_area']
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
