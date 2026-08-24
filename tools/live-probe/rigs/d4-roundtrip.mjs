// D-4: build something, read it back, and check it is the thing that was asked for.
//
// Everything so far has been checked on one side or the other. The geometry has sixty-eight
// golden cases and twenty-four properties, all of which run without a game and none of which
// can tell whether the positions ever became blocks. The executor has tests against a fake
// runner, which proves the right commands are produced, not that they do what they look like.
//
// The gap between them is where the box packer lives. It takes thousands of positions and
// emits a few dozen `/fill` boxes, and a bug there - an off-by-one on a boundary, a box that
// overlaps its neighbour, the over-fill bug that was already found and fixed once - produces
// commands that are individually valid and collectively wrong. No test without a world can
// see it, because the only witness is the world.
//
// So: build a sphere, read the region back, and check the shape of what is actually there.
// A sphere is a good subject because its signature is unmistakable - horizontal slices are
// circles that grow to the middle and shrink again, symmetrically - and nothing else the
// packer might produce looks like that by accident.
//
// It cleans up after itself, and checks the cleanup, because "the blocks are gone" is the
// same kind of claim as "the blocks are there" and deserves the same evidence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The server's own modules, loaded fresh every run.
 *
 * The runner cache-busts the rig but not what the rig imports, and it outlives any number of
 * rebuilds - so a plain import here pins whatever `dist` looked like the first time any rig
 * touched it. This is not hypothetical. The first run of this rig failed on
 * `negative.length`, because the runner was still holding the build tools from before they
 * placed anything, and the failure read as a bug in the rig.
 *
 * A `?t=` query on the import does not fix it: the query makes *that* module new, and its own
 * `./types.js` import has no query and comes straight back out of the cache. The second run
 * failed differently for exactly that reason.
 *
 * So the whole tree is copied somewhere new and imported from there, which gives every module
 * in it an unused URL. The copy sits under `packages/server` so that `zod` still resolves
 * through the package's own `node_modules`.
 */
async function serverModules() {
  const server = path.join(HERE, '..', '..', '..', 'packages', 'server');
  const cache = path.join(server, '.rig-cache');
  // Previous copies are of no use to anyone: the point is to be new.
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

const RADIUS = 5;
const BLOCK = 'gold_block';
/** Well above the ground, so the sphere is not tangled in terrain when it is read back. */
const HEIGHT_ABOVE_PLAYER = 20;

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

/** The CommandRunner the executor wants, over the runner's session. */
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

/** How many blocks of each palette symbol are in each layer, bottom to top. */
function perLayerCounts(region, symbol) {
  return region.layers.map((layer) =>
    layer.rows.reduce((total, row) => total + [...row].filter((c) => c === symbol).length, 0)
  );
}

function symbolFor(region, name) {
  return Object.entries(region.palette).find(([, value]) => value === name)?.[0] ?? null;
}

function render(region) {
  const lines = [
    `origin ${region.origin.x},${region.origin.y},${region.origin.z}   size ${region.size.x}x${region.size.y}x${region.size.z}   unread ${region.unknown}`,
    '',
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

    const centre = { x: player.x, y: player.y + HEIGHT_ABOVE_PLAYER, z: player.z };
    const corner1 = { x: centre.x - RADIUS - 1, y: centre.y - RADIUS - 1, z: centre.z - RADIUS - 1 };
    const corner2 = { x: centre.x + RADIUS + 1, y: centre.y + RADIUS + 1, z: centre.z + RADIUS + 1 };
    session.note('centre', centre);

    // --- 1. is it empty before we start? ------------------------------------------------------
    //
    // The control. Without it, a sphere-shaped answer could be terrain that was already there,
    // and "it worked" would rest on the sphere being the only explanation - which is exactly
    // the shape of reasoning that has gone wrong four times in this project.
    const before = await tools.get('world.read_region').handler({ corner1, corner2 });
    const goldBefore = symbolFor(before, BLOCK);
    session.note('before', {
      unread: before.unknown,
      palette: before.palette,
      gold_present: goldBefore !== null,
    });
    if (before.unknown > 0) {
      session.note('reading', `${before.unknown} blocks of the box are in unloaded chunks. Move closer and rerun.`);
      log('STOPPING: part of the target area has never been read');
      return;
    }
    if (goldBefore !== null) {
      session.note('reading', 'there is already gold there; pick somewhere else before trusting this');
      log('STOPPING: the area is not empty');
      return;
    }

    // --- 2. build it -------------------------------------------------------------------------
    const startedBuild = Date.now();
    const built = await tools.get('build.sphere').handler({ center: centre, radius: RADIUS, block: BLOCK });
    session.note('build', {
      ms: Date.now() - startedBuild,
      blockCount: built.blockCount,
      commandCount: built.commandCount,
      unsent: built.unsent,
      negative: built.negative.length,
      negative_sample: built.negative[0]?.statusMessage ?? null,
    });
    await session.wait(500);

    // --- 3. read it back ----------------------------------------------------------------------
    const after = await tools.get('world.read_region').handler({ corner1, corner2 });
    fs.writeFileSync(path.join(dump, 'sphere.txt'), render(after) + '\n', 'utf8');

    const gold = symbolFor(after, BLOCK);
    if (gold === null) {
      session.note('placed', 'NOTHING. The commands went out and no gold came back.');
      session.note('reading', 'The build reported success and the world disagrees. Start with the fill commands.');
      log('STOPPING: nothing was placed');
      return;
    }

    const counts = perLayerCounts(after, gold);
    const total = counts.reduce((sum, n) => sum + n, 0);

    // --- 4. is it the shape that was asked for? -----------------------------------------------
    //
    // Three independent signatures. Any one of them could pass by luck; a packing bug that
    // satisfies all three is not a packing bug.
    const middle = Math.floor(counts.length / 2);
    const risesToMiddle = counts.slice(0, middle).every((n, i) => n <= counts[i + 1]);
    const fallsAfter = counts.slice(middle).every((n, i, list) => i === 0 || n <= list[i - 1]);
    const symmetric = counts.every((n, i) => n === counts[counts.length - 1 - i]);

    session.note('placed', {
      total,
      expected: built.blockCount,
      matches_expected: total === built.blockCount,
      per_layer: counts,
      slices_rise_to_the_middle: risesToMiddle,
      slices_fall_after: fallsAfter,
      vertically_symmetric: symmetric,
      // The bug that was already found once: the packer expanding boxes in compressed
      // coordinates, which fills blocks nobody asked for. Extra gold is its signature.
      extra_blocks: total - built.blockCount,
    });

    log('');
    for (const line of render(after).split('\n').slice(0, 30)) log(`  ${line}`);
    log('');

    // --- 5. put the world back, and check that too ---------------------------------------------
    const cleared = await tools.get('build.cube').handler({ corner1, corner2, block: 'air' });
    await session.wait(500);
    const afterClear = await tools.get('world.read_region').handler({ corner1, corner2 });
    const leftover = symbolFor(afterClear, BLOCK);
    session.note('cleanup', {
      commandCount: cleared.commandCount,
      gold_left: leftover === null ? 0 : perLayerCounts(afterClear, leftover).reduce((s, n) => s + n, 0),
    });

    const verdicts = [
      total === built.blockCount ? null : `the world has ${total - built.blockCount} more gold blocks than the build reported`,
      risesToMiddle && fallsAfter ? null : 'the horizontal slices are not a sphere profile',
      symmetric ? null : 'the sphere is not symmetric top to bottom',
    ].filter(Boolean);

    session.note(
      'reading',
      verdicts.length === 0
        ? `A radius-${RADIUS} sphere of ${built.blockCount} blocks was placed by ${built.commandCount} fills, read back, and matched exactly: same count, circular slices, symmetric. The full grid is in sphere.txt.`
        : `The sphere came back wrong: ${verdicts.join('; ')}. See sphere.txt.`
    );
  } finally {
    stop();
  }
}
