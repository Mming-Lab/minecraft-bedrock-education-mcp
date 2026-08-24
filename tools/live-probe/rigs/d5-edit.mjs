// D-5: read it, change three characters, send it back.
//
// D-14 claims a layer grid is easier to steer than a parameter because it can be edited in
// place and proof-read before it is sent. That claim has an implementation and a set of unit
// tests, and neither of them has ever touched a world.
//
// So this does the loop for real: build a small hut, read the region, change a door and a
// window into air, mark the floor as leave-alone, write it back, and read it again. Then check
// that exactly the intended blocks changed and nothing else did.
//
// The floor is the interesting part. It goes back as `?`, which means "do not touch". If `?`
// were treated as air - the confusion the notation is designed to prevent - the floor would be
// gone, and the failure would be a model clearing ground it had never looked at. Making the
// floor a different block from the walls means the check cannot pass by accident: gold is
// either still there or it is not.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The server's modules, genuinely fresh.
 *
 * The runner outlives rebuilds and caches every module a rig imports. A `?t=` query only
 * makes the named module new - its own imports come back out of the cache - so the tree is
 * copied somewhere unused and imported from there. Under `packages/server`, so `zod` still
 * resolves. See d4-roundtrip, where two live runs were lost to this.
 */
async function serverModules() {
  const server = path.join(HERE, '..', '..', '..', 'packages', 'server');
  const cache = path.join(server, '.rig-cache');
  fs.rmSync(cache, { recursive: true, force: true });
  const to = path.join(cache, String(Date.now()));
  fs.cpSync(path.join(server, 'dist'), to, { recursive: true });

  const url = (...parts) => pathToFileURL(path.join(to, ...parts)).href;
  const [{ BridgeClient }, { toolsFor }] = await Promise.all([
    import(url('bridge', 'client.js')),
    import(url('tools', 'index.js')),
  ]);
  return { BridgeClient, toolsFor };
}

const FLOOR = 'gold_block';
const WALL = 'stone';
const HEIGHT_ABOVE_PLAYER = 20;

/** A hut: gold floor, stone walls with a hollow middle, stone roof. */
const HUT = [
  ['aaaaa', 'aaaaa', 'aaaaa', 'aaaaa', 'aaaaa'],
  ['bbbbb', 'b...b', 'b...b', 'b...b', 'bbbbb'],
  ['bbbbb', 'b...b', 'b...b', 'b...b', 'bbbbb'],
  ['bbbbb', 'bbbbb', 'bbbbb', 'bbbbb', 'bbbbb'],
];

function transportOver(session, seen) {
  const listeners = new Set();
  let at = seen;
  const pump = setInterval(() => {
    while (at < session.events.length) {
      const message = session.events[at++]?.event?.message;
      if (typeof message === 'string') for (const listener of [...listeners]) listener(message);
    }
  }, 10);

  return {
    stop: () => clearInterval(pump),
    transport: {
      async send(commandLine) {
        await session.command(commandLine, { timeout: 10000 });
      },
      onChat(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

function runnerOver(session) {
  return {
    async run(commandLine) {
      const reply = await session.command(commandLine, { timeout: 10000 });
      if (reply.timedOut) throw new Error(`no reply to ${commandLine}`);
      return {
        commandLine,
        statusCode: reply.body?.statusCode ?? 0,
        statusMessage: reply.body?.statusMessage ?? '',
      };
    },
  };
}

/**
 * A region as block names rather than symbols.
 *
 * Compared by name, never by character: the palette is assigned by frequency, so knocking a
 * hole in a wall can renumber every symbol. Two grids that differ only in their palettes
 * describe the same blocks, and a character-level diff would call that a change.
 */
function namesOf(region) {
  const names = new Map();
  region.layers.forEach((layer) => {
    layer.rows.forEach((row, z) => {
      [...row].forEach((symbol, x) => {
        names.set(`${x},${layer.y},${z}`, region.palette[symbol] ?? symbol);
      });
    });
  });
  return names;
}

function differences(before, after) {
  const changed = [];
  for (const [key, name] of before) {
    const now = after.get(key);
    if (now !== name) changed.push({ at: key, from: name, to: now });
  }
  return changed;
}

function render(region) {
  const lines = [`origin ${region.origin.x},${region.origin.y},${region.origin.z}   unread ${region.unknown}`, ''];
  for (const [symbol, name] of Object.entries(region.palette)) lines.push(`  ${symbol}  ${name}`);
  lines.push('');
  for (const layer of [...region.layers].reverse()) {
    lines.push(`y = ${layer.y}`);
    for (const row of layer.rows) lines.push(`  ${row}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function run(session, { log, dump }) {
  const control = session.events.length;
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(800);
  if (session.events.length === control) {
    session.note('reading', 'No PlayerMessage at all. Nothing below this line means anything.');
    return;
  }

  const { BridgeClient, toolsFor } = await serverModules();
  const { transport, stop } = transportOver(session, session.events.length);

  try {
    const bridge = new BridgeClient(transport, { firstLineMs: 8000, quietMs: 1500 });
    const tools = new Map(toolsFor(bridge, runnerOver(session)).map((tool) => [tool.name, tool]));

    const target = await session.command('querytarget @s', { timeout: 6000 });
    let player = null;
    try {
      const position = JSON.parse(target.body.details)[0].position;
      player = { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) };
    } catch {
      /* recorded below */
    }
    if (!player) {
      session.note('reading', 'could not find the player, so there is nowhere to build');
      return;
    }

    const origin = { x: player.x - 2, y: player.y + HEIGHT_ABOVE_PLAYER, z: player.z - 2 };
    const corner2 = { x: origin.x + 4, y: origin.y + 3, z: origin.z + 4 };
    session.note('origin', origin);

    // --- 1. the control: is it empty? --------------------------------------------------------
    const empty = await tools.get('world.read_region').handler({ corner1: origin, corner2 });
    session.note('before', { unread: empty.unknown, palette: empty.palette });
    if (empty.unknown > 0 || Object.keys(empty.palette).some((s) => s !== '.')) {
      session.note('reading', 'the target box is not empty air; move and rerun');
      log('STOPPING: the area is not clear');
      return;
    }

    // --- 2. build the hut from a grid ---------------------------------------------------------
    const built = await tools.get('build.layers').handler({
      origin,
      palette: { a: FLOOR, b: WALL },
      layers: HUT.map((rows) => ({ rows })),
    });
    session.note('build', {
      blockCount: built.blockCount,
      untouched: built.untouched,
      commandCount: built.commandCount,
      kinds: built.kinds,
      unsent: built.unsent,
    });
    await session.wait(500);

    // --- 3. read it back ----------------------------------------------------------------------
    const read = await tools.get('world.read_region').handler({ corner1: origin, corner2 });
    fs.writeFileSync(path.join(dump, 'hut-built.txt'), render(read) + '\n', 'utf8');
    const beforeEdit = namesOf(read);

    const floorIntact = read.layers[0].rows.every((row) =>
      [...row].every((symbol) => read.palette[symbol] === FLOOR)
    );
    session.note('read_back', {
      palette: read.palette,
      floor_is_all_gold: floorIntact,
      unread: read.unknown,
    });

    // --- 4. edit three characters --------------------------------------------------------------
    //
    // A door in the front wall, a window in the back, and the floor marked leave-alone. Written
    // as edits to what was read, which is the thing being demonstrated: no parameters, no
    // recomputation, just characters in the grid that came back.
    const edited = read.layers.map((layer, index) => {
      if (index === 0) {
        // The floor: every position `?`. If leave-alone were treated as air, this is the layer
        // that would vanish - and the gold is what makes that unmistakable.
        return { y: layer.y, rows: layer.rows.map((row) => '?'.repeat(row.length)) };
      }
      const rows = [...layer.rows];
      if (index === 1) rows[0] = `${rows[0].slice(0, 2)}.${rows[0].slice(3)}`; // door
      if (index === 2) rows[4] = `${rows[4].slice(0, 2)}.${rows[4].slice(3)}`; // window
      return { y: layer.y, rows };
    });

    const rewritten = await tools.get('build.layers').handler({
      origin: read.origin,
      palette: read.palette,
      layers: edited,
    });
    session.note('rewrite', {
      blockCount: rewritten.blockCount,
      untouched: rewritten.untouched,
      commandCount: rewritten.commandCount,
    });
    await session.wait(500);

    // --- 5. did exactly the intended blocks change? --------------------------------------------
    const after = await tools.get('world.read_region').handler({ corner1: origin, corner2 });
    fs.writeFileSync(path.join(dump, 'hut-edited.txt'), render(after) + '\n', 'utf8');
    const changed = differences(beforeEdit, namesOf(after));

    const doorAt = `2,${origin.y + 1},0`;
    const windowAt = `2,${origin.y + 2},4`;
    const expected = new Set([doorAt, windowAt]);
    const unexpected = changed.filter((change) => !expected.has(change.at));
    const missing = [...expected].filter((key) => !changed.some((change) => change.at === key));

    const floorStillGold = after.layers[0].rows.every((row) =>
      [...row].every((symbol) => after.palette[symbol] === FLOOR)
    );

    session.note('edit_result', {
      changed,
      unexpected,
      missing,
      floor_still_gold: floorStillGold,
    });

    log('');
    for (const line of render(after).split('\n').slice(0, 34)) log(`  ${line}`);
    log('');

    // --- 6. put it back ------------------------------------------------------------------------
    await tools.get('build.cube').handler({ corner1: origin, corner2, block: 'air' });
    await session.wait(400);
    const cleared = await tools.get('world.read_region').handler({ corner1: origin, corner2 });
    session.note('cleanup', { palette: cleared.palette });

    const problems = [
      floorIntact ? null : 'the hut did not come back as it was built',
      unexpected.length === 0 ? null : `${unexpected.length} blocks changed that should not have`,
      missing.length === 0 ? null : `${missing.length} of the intended edits did not happen`,
      floorStillGold ? null : 'the floor is gone - "?" was treated as air, which is the failure this notation exists to prevent',
    ].filter(Boolean);

    session.note(
      'reading',
      problems.length === 0
        ? `Read, edited, written back: exactly the door and the window changed, and the floor marked "?" was untouched. ${rewritten.untouched} positions were left alone. The loop works on hardware.`
        : `The edit round trip went wrong: ${problems.join('; ')}.`
    );
  } finally {
    stop();
  }
}
