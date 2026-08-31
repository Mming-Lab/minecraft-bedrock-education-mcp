// Reading the world, against a stand-in add-on.
//
//   node test/world-tools.test.mjs
//
// Two things are checked here and they are not the same thing. The first is the layer
// encoding, which is pure: given a list of block names, is the grid the right way round, and
// does it keep "air" and "never looked" apart. The second is what the tools do with a reply -
// in particular what they do with a *bad* reply, which is where the interesting failures are.
//
// A region read that quietly comes back short is the failure this whole path is built to
// prevent: the model would be handed a smaller building than the one that is there and would
// have no way to tell. The bridge refuses an answer with a missing part; the tool's job is to
// retry with shorter lines rather than pass the refusal on, and to give up loudly rather than
// return what it managed to get.

import assert from 'node:assert/strict';

import { BridgeProtocolError } from '../dist/bridge/protocol.js';
import { toLayers, indexOf, RegionTooVariedError } from '../dist/world/layers.js';
import { toolsFor, offlineBridge, expectedAddonVersion } from '../dist/tools/index.js';

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

/** A bridge whose answers a test writes itself. Records what it was asked, in order. */
function fakeBridge(answer) {
  const calls = [];
  return {
    calls,
    async request(action, args) {
      calls.push({ action, args });
      return answer(action, args, calls.length);
    },
  };
}

const tools = (bridge) => new Map(toolsFor(bridge).map((tool) => [tool.name, tool]));
const ORIGIN = { x: 0, y: 64, z: 0 };

console.log('layer encoding');

await test('the grid is x across, z down, and bottom layer first', async () => {
  // A 2x2x2 with a single marker, so a transposition cannot hide behind symmetry. The add-on
  // walks x outermost, then y, then z.
  const size = { x: 2, y: 2, z: 2 };
  const blocks = new Array(8).fill('air');
  blocks[indexOf(size, 1, 0, 1)] = 'stone'; // east, bottom, south

  const region = toLayers(ORIGIN, size, blocks);

  assert.equal(region.layers.length, 2);
  assert.equal(region.layers[0].y, 64, 'first layer should be the lowest');
  assert.equal(region.layers[1].y, 65);
  // rows[z][x]: the marker is at x=1, z=1, so the second character of the second row.
  assert.deepEqual(region.layers[0].rows, ['..', '.a']);
  assert.deepEqual(region.layers[1].rows, ['..', '..']);
  assert.equal(region.palette.a, 'stone');
  assert.equal(region.palette['.'], 'air');
});

await test('air and never-looked-at are different characters', async () => {
  const size = { x: 3, y: 1, z: 1 };
  const region = toLayers(ORIGIN, size, ['air', null, 'stone']);

  assert.equal(region.layers[0].rows[0], '.?a');
  assert.equal(region.unknown, 1);
  // The palette has to say what `?` means, or the distinction is only in this file's head.
  assert.match(region.palette['?'], /not read/);
});

await test('the commonest block gets the first letter, and ties break by name', async () => {
  const size = { x: 6, y: 1, z: 1 };
  const region = toLayers(ORIGIN, size, ['dirt', 'stone', 'stone', 'stone', 'dirt', 'cobblestone']);

  assert.equal(region.palette.a, 'stone', 'three stone should outrank two dirt');
  assert.equal(region.palette.b, 'dirt');
  assert.equal(region.palette.c, 'cobblestone');
});

await test('the same region encodes the same way twice', async () => {
  // Two blocks with equal counts: without a tie-break the palette could swap between reads,
  // and two identical grids would look like something had changed.
  const size = { x: 4, y: 1, z: 1 };
  const blocks = ['stone', 'dirt', 'dirt', 'stone'];
  const first = toLayers(ORIGIN, size, blocks);
  const second = toLayers(ORIGIN, size, [...blocks]);

  assert.deepEqual(first.palette, second.palette);
  assert.deepEqual(first.layers, second.layers);
});

await test('a list that does not fill the box is refused', async () => {
  // A short list means lines went missing on the way, and encoding it anyway would produce a
  // perfectly plausible smaller building.
  assert.throws(
    () => toLayers(ORIGIN, { x: 4, y: 4, z: 4 }, new Array(60).fill('stone')),
    /64 blocks but 60 arrived/
  );
});

await test('more kinds than there are symbols is refused, not silently merged', async () => {
  const kinds = 70;
  const blocks = Array.from({ length: kinds }, (_, i) => `block_${i}`);
  assert.throws(() => toLayers(ORIGIN, { x: kinds, y: 1, z: 1 }, blocks), RegionTooVariedError);
});

console.log('\nworld tools');

await test('get_block returns the block with its states', async () => {
  const bridge = fakeBridge(() => ({
    header: { ok: true, name: 'minecraft:oak_stairs', states: { facing_direction: 2 } },
    parts: [],
  }));
  const result = await tools(bridge).get('world.get_block').handler({ position: { x: 1, y: 2, z: 3 } });

  assert.equal(result.status, 'read');
  assert.equal(result.block, 'minecraft:oak_stairs');
  assert.deepEqual(result.states, { facing_direction: 2 });
  assert.deepEqual(bridge.calls[0], { action: 'getblock', args: { x: 1, y: 2, z: 3 } });
});

await test('an unloaded chunk is an answer, not an error', async () => {
  // The distinction the whole design leans on: reporting this as a failure would have the
  // model retry, and reporting it as air would have it build into whatever is standing there.
  const bridge = fakeBridge(() => ({ header: { ok: false, error: 'chunk not loaded' }, parts: [] }));
  const result = await tools(bridge).get('world.get_block').handler({ position: { x: 1, y: 2, z: 3 } });

  assert.equal(result.status, 'not_loaded');
  assert.equal(result.block, null);
});

await test('a fault in the add-on is still an error', async () => {
  const bridge = fakeBridge(() => ({ header: { ok: false, error: 'no handler for getblock' }, parts: [] }));
  await assert.rejects(
    tools(bridge).get('world.get_block').handler({ position: { x: 1, y: 2, z: 3 } }),
    /no handler/
  );
});

await test('read_region asks for the box and returns layers', async () => {
  const bridge = fakeBridge(() => ({
    header: { ok: true, total: 8, parts: 1 },
    parts: [{ blocks: ['stone', 'air', 'air', 'air', 'air', 'air', 'air', 'air'] }],
  }));
  const result = await tools(bridge)
    .get('world.read_region')
    .handler({ corner1: { x: 2, y: 64, z: 2 }, corner2: { x: 1, y: 65, z: 1 } });

  // Corners in either order, normalised to a box with a lowest corner.
  assert.deepEqual(bridge.calls[0].args, { x1: 1, y1: 64, z1: 1, x2: 2, y2: 65, z2: 2, perMessage: 24 });
  assert.deepEqual(result.origin, { x: 1, y: 64, z: 1 });
  assert.deepEqual(result.size, { x: 2, y: 2, z: 2 });
  assert.equal(result.layers[0].rows[0][0], 'a');
});

await test('a refused answer is retried with shorter lines', async () => {
  // What happens on real hardware when the block names are longer than the guess assumed: the
  // chat line goes over the limit and vanishes whole, and the bridge refuses the set. The
  // names cannot be known before the read, so the fix is to ask again for less per line.
  const bridge = fakeBridge((_action, args, callNumber) => {
    if (callNumber < 3) {
      throw new BridgeProtocolError(`answer is incomplete: 1 of 2 parts missing (1); 2 lines arrived`);
    }
    return { header: { ok: true, total: 8, parts: 1 }, parts: [{ blocks: new Array(8).fill('stone') }] };
  });

  const result = await tools(bridge)
    .get('world.read_region')
    .handler({ corner1: { x: 0, y: 64, z: 0 }, corner2: { x: 1, y: 65, z: 1 } });

  assert.equal(result.unknown, 0);
  assert.deepEqual(
    bridge.calls.map((call) => call.args.perMessage),
    [24, 12, 6],
    'each refusal should halve the blocks per line'
  );
});

await test('a region that will not come back whole fails loudly', async () => {
  // The alternative - returning the parts that did arrive - is the one outcome that must not
  // happen: it looks exactly like a smaller region.
  const bridge = fakeBridge(() => {
    throw new BridgeProtocolError('answer is incomplete: 3 of 4 parts missing (1, 2, 3); 1 lines arrived');
  });
  await assert.rejects(
    tools(bridge)
      .get('world.read_region')
      .handler({ corner1: { x: 0, y: 64, z: 0 }, corner2: { x: 1, y: 65, z: 1 } }),
    /could not be read whole/
  );
  assert.equal(bridge.calls.length, 4, 'should stop rather than halve for ever');
});

await test('a reply with fewer blocks than it claims is refused', async () => {
  // Every part arrived, so the part count is satisfied - but one of them is short. Nothing
  // below this check would notice.
  const bridge = fakeBridge(() => ({
    header: { ok: true, total: 8, parts: 1 },
    parts: [{ blocks: ['stone', 'stone', 'stone'] }],
  }));
  await assert.rejects(
    tools(bridge)
      .get('world.read_region')
      .handler({ corner1: { x: 0, y: 64, z: 0 }, corner2: { x: 1, y: 65, z: 1 } }),
    /said 8 blocks and sent 3/
  );
});

await test('a box bigger than has ever been measured is refused before the round trip', async () => {
  const bridge = fakeBridge(() => {
    throw new Error('should not have been asked');
  });
  await assert.rejects(
    tools(bridge)
      .get('world.read_region')
      .handler({ corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 31, y: 15, z: 15 } }),
    /over the 4096 limit/
  );
  assert.equal(bridge.calls.length, 0);
});

await test('a block that is not a container says so instead of failing', async () => {
  const bridge = fakeBridge(() => ({
    header: { ok: false, error: 'not a container', name: 'minecraft:stone' },
    parts: [],
  }));
  const result = await tools(bridge).get('world.container').handler({ position: { x: 0, y: 64, z: 0 } });

  assert.equal(result.status, 'not_a_container');
  assert.equal(result.block, 'minecraft:stone');
  assert.deepEqual(result.items, []);
});

await test('a container returns its occupied slots', async () => {
  const bridge = fakeBridge(() => ({
    header: { ok: true, name: 'minecraft:chest', size: 27, items: [{ slot: 0, type: 'minecraft:diamond', amount: 5 }] },
    parts: [],
  }));
  const result = await tools(bridge).get('world.container').handler({ position: { x: 0, y: 64, z: 0 } });

  assert.equal(result.status, 'read');
  assert.equal(result.size, 27);
  assert.equal(result.items[0].amount, 5);
});

await test('entities pass through with the count that was found, not only the count returned', async () => {
  const bridge = fakeBridge(() => ({
    header: { ok: true, total: 31, returned: 2, entities: [{ type: 'minecraft:cow', x: 1, y: 2, z: 3 }] },
    parts: [],
  }));
  const result = await tools(bridge)
    .get('world.entities')
    .handler({ center: { x: 0, y: 64, z: 0 }, radius: 8 });

  // `total` above `returned` is how a caller learns the list was cut short - without it a
  // truncated list reads as the whole population.
  assert.equal(result.total, 31);
  assert.equal(result.returned, 2);
  assert.equal(bridge.calls[0].args.radius, 8);
});

await test('with nothing connected, every world tool says how to connect', async () => {
  // Registered whether or not a game is there, so the model can see reading is possible and
  // report something the user can act on rather than concluding the server cannot read.
  for (const tool of toolsFor(offlineBridge)) {
    if (!tool.name.startsWith('world.')) continue;
    // Except the one whose job is to explain the others' failures. It answers instead of
    // throwing, and is checked on its own below.
    if (tool.name === 'world.bridge_status') continue;
    const args = {
      position: { x: 0, y: 64, z: 0 },
      center: { x: 0, y: 64, z: 0 },
      corner1: { x: 0, y: 64, z: 0 },
      corner2: { x: 1, y: 64, z: 1 },
    };
    await assert.rejects(async () => tool.handler(args), /\/connect localhost:19131/, tool.name);
  }
});

await test('bridge_status answers instead of failing when nothing is connected', async () => {
  // The tool someone reaches for *because* something is wrong. Throwing would make it the
  // fourth thing that does not work rather than the one that explains the other three.
  const status = await tools(offlineBridge).get('world.bridge_status').handler({});

  assert.equal(status.connected, false);
  assert.equal(status.addonVersion, null);
  assert.match(status.advice, /\/connect localhost:19131/);
});

await test('an add-on older than the server is reported, with what to do about it', async () => {
  // The failure that already happened once and went unnoticed for a day: the files on disk
  // said `tell` and the game was still running the `say` build, because pack folders are only
  // scanned at launch.
  const bridge = fakeBridge(() => ({
    header: { ok: true, version: '0.1.0', tick: 1234, players: 1 },
    parts: [],
  }));
  const status = await tools(bridge).get('world.bridge_status').handler({});

  assert.equal(status.connected, true);
  assert.equal(status.addonVersion, '0.1.0');
  assert.equal(status.upToDate, false);
  assert.match(status.advice, /closed and reopened/, 'the advice does not say a reload is not enough');
});

await test('a current add-on reports no advice at all', async () => {
  const bridge = fakeBridge(() => ({
    // Read from the shipped add-on's manifest rather than restated here, so this test cannot
    // pass against a constant that has drifted from the file the game is given.
    header: { ok: true, version: expectedAddonVersion(), tick: 99, players: 2 },
    parts: [],
  }));
  const status = await tools(bridge).get('world.bridge_status').handler({});

  assert.equal(status.upToDate, true);
  assert.equal(status.advice, null, 'a healthy bridge should have nothing to say');
  assert.equal(status.players, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
