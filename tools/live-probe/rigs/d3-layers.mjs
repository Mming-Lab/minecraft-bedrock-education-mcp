// D-3: run the actual MCP tools against the actual world, and look at what a model would see.
//
// Everything up to here has been checked against a stand-in: the tools work when the bridge
// answers the way a test says it does. What no test can settle is whether the *output* is any
// good - whether a region read comes back as something a model can reason about, or as a wall
// of characters that happens to be shorter than a wall of names.
//
// So this calls the real `world.*` tools over the live connection and writes the grid out as
// text, unmodified, for a person to look at. If the terrain is legible in it - ground here,
// air above, the shape of what is built - then the encoding is doing its job. If it is not,
// that is worth knowing before any more is built on top of it.
//
// It also exercises the retry that no fake can honestly test: `perMessage` starts at 24 and
// halves on refusal, and whether 24 survives depends on how long the block names in this
// particular patch of world turn out to be.

import fs from 'node:fs';
import path from 'node:path';

import { BridgeClient } from '../../../packages/server/dist/bridge/client.js';
import { toolsFor } from '../../../packages/server/dist/tools/index.js';

/** Same adapter as d1: the runner owns the socket, so chat is read from its event array. */
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

/** The grid as a person would want to read it: highest layer first, so it looks like a view. */
function render(region) {
  const lines = [
    `origin ${region.origin.x},${region.origin.y},${region.origin.z}   size ${region.size.x}x${region.size.y}x${region.size.z}   unread ${region.unknown}`,
    '',
    'palette',
    ...Object.entries(region.palette).map(([symbol, name]) => `  ${symbol}  ${name}`),
    '',
  ];
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

  const { transport, stop } = transportOver(session, session.events.length);

  try {
    const bridge = new BridgeClient(transport, { firstLineMs: 8000, quietMs: 1500 });
    const tools = new Map(toolsFor(bridge).map((tool) => [tool.name, tool]));

    // Where the player is standing, so the region has something in it other than stone.
    const target = await session.command('querytarget @s', { timeout: 6000 });
    let at = null;
    try {
      const position = JSON.parse(target.body.details)[0].position;
      at = { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) };
    } catch {
      /* recorded below */
    }
    if (!at) {
      session.note('reading', 'could not find the player, so there is nowhere to read');
      return;
    }
    session.note('player_at', at);

    // --- one block, with its states -----------------------------------------------------------
    const under = { x: at.x, y: at.y - 1, z: at.z };
    const startedBlock = Date.now();
    const block = await tools.get('world.get_block').handler({ position: under });
    session.note('get_block', { ...block, ms: Date.now() - startedBlock });

    // --- a region, as layers ------------------------------------------------------------------
    const corner1 = { x: at.x - 7, y: at.y - 3, z: at.z - 7 };
    const corner2 = { x: at.x + 8, y: at.y + 4, z: at.z + 8 };
    const startedRegion = Date.now();
    let region = null;
    try {
      region = await tools.get('world.read_region').handler({ corner1, corner2 });
    } catch (error) {
      session.note('read_region', `FAILED: ${error.message}`);
    }

    if (region) {
      const text = render(region);
      fs.writeFileSync(path.join(dump, 'region.txt'), text + '\n', 'utf8');
      session.note('read_region', {
        ms: Date.now() - startedRegion,
        size: region.size,
        volume: region.size.x * region.size.y * region.size.z,
        unread: region.unknown,
        kinds: Object.keys(region.palette).length,
        palette: region.palette,
        chars_in_grid: region.layers.reduce(
          (total, layer) => total + layer.rows.reduce((n, row) => n + row.length, 0),
          0
        ),
      });
      // The point of the whole exercise, in the log where it will be seen.
      log('');
      for (const line of text.split('\n').slice(0, 40)) log(`  ${line}`);
      log('');
    }

    // --- what is alive ------------------------------------------------------------------------
    const entities = await tools.get('world.entities').handler({ center: at, radius: 24 });
    session.note('entities', entities);

    // --- a container, if the earlier rigs left one behind -------------------------------------
    const chestAt = { x: at.x + 3, y: at.y - 1, z: at.z + 3 };
    const container = await tools.get('world.container').handler({ position: chestAt });
    session.note('container', container);

    session.note(
      'reading',
      region
        ? `A ${region.size.x}x${region.size.y}x${region.size.z} region read in ${Date.now() - startedRegion}ms as ${Object.keys(region.palette).length} kinds of block. The grid is in region.txt; judge it by whether the terrain is legible in it.`
        : 'The region did not come back. See read_region above.'
    );
  } finally {
    stop();
  }
}
