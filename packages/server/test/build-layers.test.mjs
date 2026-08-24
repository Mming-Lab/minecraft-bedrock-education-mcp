// Building from a layer grid.
//
//   node test/build-layers.test.mjs
//
// The reason this tool exists is the round trip: read a region, change a few characters, send
// it back. That only works if the reading tool's output goes into the building tool without
// being reshaped first, so the last test here does exactly that and nothing else - encode a
// region, hand it straight over, and check the same blocks come out the other side.
//
// The rest is about the two reserved characters. `.` is air and clears what is there; `?` is
// "leave alone" and must never become a command. Confusing them is not a cosmetic bug: `?` is
// what a region read writes where a chunk was not loaded, so treating it as air would clear
// ground that was never looked at.

import assert from 'node:assert/strict';

import { toolsFor, offlineBridge } from '../dist/tools/index.js';
import { toLayers } from '../dist/world/layers.js';

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
      return { commandLine, statusCode: 0, statusMessage: '' };
    },
  };
}

function layersTool(runner) {
  return toolsFor(offlineBridge, runner).find((tool) => tool.name === 'build.layers');
}

const ORIGIN = { x: 10, y: 64, z: 20 };

console.log('build.layers');

await test('characters land where the grid says they do', async () => {
  const runner = fakeRunner();
  const result = await layersTool(runner).handler({
    origin: ORIGIN,
    palette: { a: 'stone', b: 'oak_planks' },
    layers: [{ rows: ['ab'] }],
  });

  assert.equal(result.blockCount, 2);
  // x runs along the row, z down the rows, y up the layers.
  assert.ok(runner.sent.includes('fill 10 64 20 10 64 20 minecraft:stone replace'), runner.sent.join(' | '));
  assert.ok(runner.sent.includes('fill 11 64 20 11 64 20 minecraft:oak_planks replace'), runner.sent.join(' | '));
});

await test('layers stack upwards and rows run north to south', async () => {
  const runner = fakeRunner();
  await layersTool(runner).handler({
    origin: ORIGIN,
    palette: { a: 'stone' },
    layers: [{ rows: ['?', '?'] }, { rows: ['a', '?'] }],
  });

  // Second layer (y+1), first row (z+0).
  assert.deepEqual(runner.sent, ['fill 10 65 20 10 65 20 minecraft:stone replace']);
});

await test('a dot is air and does get placed', async () => {
  const runner = fakeRunner();
  const result = await layersTool(runner).handler({
    origin: ORIGIN,
    palette: {},
    layers: [{ rows: ['..'] }],
  });

  assert.equal(result.blockCount, 2, 'air is a block being placed, not an absence');
  assert.equal(result.untouched, 0);
  assert.deepEqual(runner.sent, ['fill 10 64 20 11 64 20 minecraft:air replace']);
});

await test('a question mark is left alone and reaches no command', async () => {
  // The distinction the whole notation rests on. `?` is what read_region writes where the
  // chunk was not loaded; placing air there would clear ground nobody has seen.
  const runner = fakeRunner();
  const result = await layersTool(runner).handler({
    origin: ORIGIN,
    palette: { a: 'stone' },
    layers: [{ rows: ['a??a'] }],
  });

  assert.equal(result.untouched, 2);
  assert.equal(result.blockCount, 2);
  for (const command of runner.sent) {
    assert.ok(!command.includes('11 64 20'), `a "?" position was written: ${command}`);
    assert.ok(!command.includes('12 64 20'), `a "?" position was written: ${command}`);
  }
});

await test('a row that lost a character is refused, and named', async () => {
  const runner = fakeRunner();
  await assert.rejects(
    async () =>
      layersTool(runner).handler({
        origin: ORIGIN,
        palette: { a: 'stone' },
        layers: [{ rows: ['aaa', 'aa'] }],
      }),
    /layer 0 row 1 is 2 characters and the first row is 3/
  );
  assert.equal(runner.sent.length, 0, 'a ragged grid was partly built before being refused');
});

await test('a character the palette does not name is refused, with its position', async () => {
  const runner = fakeRunner();
  await assert.rejects(
    async () =>
      layersTool(runner).handler({
        origin: ORIGIN,
        palette: { a: 'stone' },
        layers: [{ rows: ['aa'] }, { rows: ['aq'] }],
      }),
    /layer 1, row 0, column 1 is "q"/
  );
  assert.equal(runner.sent.length, 0);
});

await test('a layer whose y disagrees with the origin is refused', async () => {
  // The guard against a grid that got reordered - which would build the thing upside down and
  // look, from the tool's side, entirely reasonable.
  const runner = fakeRunner();
  await assert.rejects(
    async () =>
      layersTool(runner).handler({
        origin: ORIGIN,
        palette: { a: 'stone' },
        layers: [{ y: 64, rows: ['a'] }, { y: 70, rows: ['a'] }],
      }),
    /layer 1 says y=70 but sits at y=65/
  );
});

await test('a grid of nothing but question marks is refused rather than silently doing nothing', async () => {
  const runner = fakeRunner();
  await assert.rejects(
    async () => layersTool(runner).handler({ origin: ORIGIN, palette: {}, layers: [{ rows: ['??'] }] }),
    /nothing to build/
  );
});

await test('a bad block id in the palette is caught before anything is sent', async () => {
  const runner = fakeRunner();
  await assert.rejects(
    async () =>
      layersTool(runner).handler({
        origin: ORIGIN,
        palette: { a: 'air 0 destroy' },
        layers: [{ rows: ['a'] }],
      }),
    /palette/
  );
  assert.equal(runner.sent.length, 0);
});

await test("read_region's output goes back in unchanged", async () => {
  // The whole point. A region encoded by the reading side, palette and all - including the
  // `?` entry, whose value is a sentence rather than a block id and would fail validation if
  // the two notations had drifted apart.
  const size = { x: 3, y: 2, z: 2 };
  const blocks = [
    // x=0                x=1                 x=2
    'stone', 'stone', 'air', 'air',   'stone', null, 'air', 'air',   'stone', 'stone', 'air', 'air',
  ];
  const region = toLayers({ x: 10, y: 64, z: 20 }, size, blocks);
  assert.ok(region.palette['?'], 'the region should carry an entry for the unread block');

  const runner = fakeRunner();
  const result = await layersTool(runner).handler({
    origin: region.origin,
    palette: region.palette,
    layers: region.layers,
  });

  // Eleven of the twelve placed; the one that was never read is left alone.
  assert.equal(result.blockCount, 11);
  assert.equal(result.untouched, 1);
  assert.deepEqual(
    result.kinds.map((kind) => kind.block),
    ['minecraft:air', 'minecraft:stone']
  );
  assert.equal(result.kinds.find((k) => k.block === 'minecraft:stone').count, 5);
});

await test('with nothing connected it says how to connect', async () => {
  await assert.rejects(
    async () =>
      toolsFor(offlineBridge)
        .find((tool) => tool.name === 'build.layers')
        .handler({ origin: ORIGIN, palette: { a: 'stone' }, layers: [{ rows: ['a'] }] }),
    /\/connect localhost:19131/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
