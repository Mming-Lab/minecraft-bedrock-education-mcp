// D-6: does the retry actually fire, and does 16 cubed come back whole?
//
// `world.read_region` guesses 24 blocks per chat line and halves on refusal. The guess is not
// arbitrary - 24 carried 4096 blocks of ordinary terrain once - but it depends entirely on how
// long the block names turn out to be, and the names are what the read is *for*. A region of
// air, stone and dirt averages three characters a name; `waxed_oxidized_cut_copper_stairs` is
// thirty-two. At 24 per line that is well past the ~505 characters a chat line survives, and
// every line vanishes whole.
//
// The unit tests prove the halving happens when the bridge refuses. What they cannot show is
// that a real region of long-named blocks *causes* a refusal rather than something else -
// a truncation, a silent short answer, a timeout. If it causes something else, the retry is
// aimed at a failure that does not occur and the read comes back wrong instead of slow.
//
// The region is also the largest the tool allows: 16x16x16, which is where MAX_REGION_BLOCKS
// was set from a measurement made before any of this code existed.
//
// The block is chosen by trying candidates and reading one back, rather than by trusting a
// name from a wiki. A name that does not exist in this build would fail as "nothing was
// placed", which looks nothing like what it is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** See d4-roundtrip: the runner caches modules across rebuilds, and `?t=` does not reach imports. */
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

/** Long names, longest first. Whichever one this build actually has wins. */
const CANDIDATES = [
  'waxed_oxidized_cut_copper_stairs',
  'cracked_polished_blackstone_bricks',
  'polished_blackstone_brick_wall',
  'cracked_deepslate_bricks',
  'stone_brick_stairs',
];

const SIZE = 16;
const HEIGHT_ABOVE_PLAYER = 24;

/** Records what the bridge sends, so the retry can be seen from outside. */
function transportOver(session, seen) {
  const listeners = new Set();
  const sent = [];
  let at = seen;
  const pump = setInterval(() => {
    while (at < session.events.length) {
      const message = session.events[at++]?.event?.message;
      if (typeof message === 'string') for (const listener of [...listeners]) listener(message);
    }
  }, 10);

  return {
    stop: () => clearInterval(pump),
    sent,
    transport: {
      async send(commandLine) {
        sent.push(commandLine);
        await session.command(commandLine, { timeout: 12000 });
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
      const reply = await session.command(commandLine, { timeout: 12000 });
      if (reply.timedOut) throw new Error(`no reply to ${commandLine}`);
      return {
        commandLine,
        statusCode: reply.body?.statusCode ?? 0,
        statusMessage: reply.body?.statusMessage ?? '',
      };
    },
  };
}

const perMessagesIn = (sent) =>
  sent
    .filter((line) => line.includes('mcp:readregion'))
    .map((line) => Number(/"perMessage":(\d+)/.exec(line)?.[1] ?? 0));

export async function run(session, { log, dump }) {
  const control = session.events.length;
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(800);
  if (session.events.length === control) {
    session.note('reading', 'No PlayerMessage at all. Nothing below this line means anything.');
    return;
  }

  const { BridgeClient, toolsFor } = await serverModules();
  const { transport, stop, sent } = transportOver(session, session.events.length);

  try {
    const bridge = new BridgeClient(transport, { firstLineMs: 10000, quietMs: 2000 });
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

    const probeAt = { x: player.x, y: player.y + HEIGHT_ABOVE_PLAYER, z: player.z };

    // --- 1. which of these names does this build actually have? ------------------------------
    //
    // Placed and read back, not assumed. A name this version does not know would place nothing
    // and the region would come back as air - which reads as "the read is broken" rather than
    // "the block does not exist".
    let block = null;
    const tried = [];
    for (const candidate of CANDIDATES) {
      await tools.get('build.cube').handler({ corner1: probeAt, corner2: probeAt, block: candidate });
      await session.wait(300);
      const check = await tools.get('world.get_block').handler({ position: probeAt });
      tried.push({ candidate, got: check.block });
      if (check.block === `minecraft:${candidate}`) {
        block = candidate;
        break;
      }
    }
    session.note('block_probe', { tried, chosen: block });
    if (!block) {
      session.note('reading', 'none of the candidate long-named blocks exist in this build; add more candidates');
      log('STOPPING: no usable block');
      return;
    }

    // --- 2. fill 16 cubed with it -------------------------------------------------------------
    const origin = { x: probeAt.x - 8, y: probeAt.y, z: probeAt.z - 8 };
    const corner2 = { x: origin.x + SIZE - 1, y: origin.y + SIZE - 1, z: origin.z + SIZE - 1 };

    const built = await tools.get('build.cube').handler({ corner1: origin, corner2, block });
    session.note('build', {
      block,
      name_length: block.length,
      blockCount: built.blockCount,
      commandCount: built.commandCount,
      unsent: built.unsent,
    });
    await session.wait(1000);

    // --- 3. read it back, and watch the retry --------------------------------------------------
    const from = sent.length;
    const startedAt = Date.now();
    let region = null;
    let failure = null;
    try {
      region = await tools.get('world.read_region').handler({ corner1: origin, corner2 });
    } catch (error) {
      failure = error.message;
    }
    const attempts = perMessagesIn(sent.slice(from));

    session.note('read', {
      ms: Date.now() - startedAt,
      per_message_attempts: attempts,
      retried: attempts.length > 1,
      failure,
    });

    if (region) {
      const counts = new Map();
      for (const layer of region.layers)
        for (const row of layer.rows)
          for (const symbol of row) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);

      const wanted = Object.entries(region.palette).find(([, name]) => name === block)?.[0] ?? null;
      session.note('region', {
        size: region.size,
        volume: region.size.x * region.size.y * region.size.z,
        unread: region.unknown,
        palette: region.palette,
        of_the_chosen_block: wanted ? counts.get(wanted) : 0,
        all_of_it: wanted ? counts.get(wanted) === SIZE ** 3 : false,
      });
      fs.writeFileSync(
        path.join(dump, 'longnames.txt'),
        `${block} (${block.length} chars)\nperMessage attempts: ${attempts.join(' -> ')}\n\n` +
          region.layers[0].rows.join('\n') +
          '\n',
        'utf8'
      );
    }

    // --- 4. put it back -------------------------------------------------------------------------
    await tools.get('build.cube').handler({ corner1: origin, corner2, block: 'air' });
    await session.wait(600);
    const cleared = await tools.get('world.read_region').handler({ corner1: origin, corner2 });
    session.note('cleanup', { palette: cleared.palette });

    session.note(
      'reading',
      failure
        ? `A 16-cubed region of ${block} could not be read: ${failure}. perMessage went ${attempts.join(' -> ')}.`
        : attempts.length > 1
          ? `The retry fired as designed: perMessage went ${attempts.join(' -> ')} and the full ${SIZE ** 3} blocks came back. Long block names do cause a refusal, which is the failure the halving is aimed at.`
          : `No retry was needed - ${SIZE ** 3} blocks of a ${block.length}-character name came back at perMessage ${attempts[0]}. The first guess is safer than the arithmetic suggested, so the halving is still untested against real loss.`
    );
  } finally {
    stop();
  }
}
