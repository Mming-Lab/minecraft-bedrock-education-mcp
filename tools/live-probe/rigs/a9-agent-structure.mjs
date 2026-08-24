// A-9: does `agent inspect` return anything, and where does `structure save` put it?
//
// ## agent
//
// `agent inspect forward` answers statusCode 0 with 「エージェントの検査アクション成功」 - the
// action succeeded - and nothing about what was inspected. socket-be's author concluded from
// the same silence that these commands return no data. That conclusion was reached while the
// library was discarding every frame whose messagePurpose was not on its list, printing
// `[Network] Invalid message purpose:` and returning, and `action:agent` is not on that list.
//
// So the runner now taps the socket directly, ahead of socket-be, and keeps every frame. If
// the inspection result arrives as a second frame, it lands in raw-frames.jsonl whatever its
// purpose, and in unrecognised-frames.json if socket-be would have dropped it. If nothing
// arrives, the original conclusion was right for a different reason than was given.
//
// The agent has to exist first, which is what `agent tp` is for.
//
// ## structure
//
// `/structure save` reports success, but there is no .mcstructure anywhere under the world
// folder - Bedrock keeps structures in the world's LevelDB, which is why the name comes back
// namespaced as `mystructure:`. The database is readable while the game runs (shared read
// works, measured), but its blocks are zlib-compressed, so a plain scan finds nothing.
//
// This saves under a name distinctive enough to search for and notes the moment it did, so
// the database can be checked immediately afterwards. What that settles is whether the data
// reaches disk promptly - the point on which the whole read-the-world-from-the-file idea
// depends.

const body = (r) => (r.timedOut ? null : (r.body ?? null));
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;
const brief = (r) => ({ code: body(r)?.statusCode ?? null, message: (body(r)?.statusMessage ?? '').replace(/§./g, '') || null, keys: Object.keys(body(r) ?? {}) });

async function announce(session, text) {
  await session.command(`say §b[probe]§r ${text}`, { timeout: 3000 });
}

export async function run(session, { log }) {
  await announce(session, 'agent and structure - about a minute.');

  // ---------------------------------------------------------------------------------------
  log('phase 1: the agent');
  // ---------------------------------------------------------------------------------------

  // Bring it into existence next to the player. Without this every later command answers
  // about an agent that is not there.
  const tp = await session.command('agent tp', { timeout: 8000 });
  session.note('agent_tp', brief(tp));
  await session.wait(500);

  // Something known in front of it, so an inspection that works has a specific answer to
  // give and a wrong answer is recognisable. `agent tp` puts the agent at the player, so
  // "forward" depends on facing - both the block under it and the one ahead get marked.
  await session.command('setblock ~ ~-1 ~ minecraft:diamond_block replace');
  await session.wait(300);

  const agentCommands = [
    'agent inspect forward',
    'agent inspect down',
    'agent inspect up',
    'agent inspectdata forward',
    'agent inspectdata down',
    'agent detect forward',
    'agent detect down',
    'agent detectredstone forward',
    'agent getitemcount 1',
    'agent getposition',
  ];

  const agentResults = {};
  for (const command of agentCommands) {
    const reply = await session.command(command, { timeout: 6000 });
    agentResults[command] = { ...brief(reply), body: body(reply) };
    log(`  ${accepted(reply) ? 'ok     ' : 'refused'}  ${command}  -> ${JSON.stringify(body(reply))}`);
    // A second frame, if there is one, needs a moment to arrive before the next command
    // muddies which request it belongs to.
    await session.wait(400);
  }
  session.note('agent_results', agentResults);
  session.note(
    'agent_bodies_carry_more_than_status',
    Object.values(agentResults).some((r) => r.keys.some((k) => k !== 'statusCode' && k !== 'statusMessage'))
  );

  // ---------------------------------------------------------------------------------------
  log('phase 2: structure save');
  // ---------------------------------------------------------------------------------------
  //
  // A name no other data could contain, so a hit in the database is unambiguous.
  const name = 'zzprobe_marker_7fq3';
  session.note('structure_name', name);

  // A small volume of known blocks, so a decoded structure can be checked against what was
  // put there rather than merely parsed without error.
  await session.command('setblock ~1 ~-1 ~1 minecraft:gold_block replace');
  await session.command('setblock ~2 ~-1 ~1 minecraft:redstone_block replace');
  await session.command('setblock ~1 ~-1 ~2 minecraft:emerald_block replace');
  await session.wait(400);

  const saved = await session.command(`structure save ${name} ~ ~-1 ~ ~2 ~-1 ~2 disk`, { timeout: 10000 });
  session.note('structure_save', brief(saved));
  session.note('structure_saved_at_ms', Date.now());

  // memory mode too, under a second name, so the two can be told apart on disk afterwards.
  const memName = 'zzprobe_memory_7fq3';
  const savedMem = await session.command(`structure save ${memName} ~ ~-1 ~ ~2 ~-1 ~2 memory`, { timeout: 10000 });
  session.note('structure_save_memory', brief(savedMem));

  // Loading it back proves the save is real regardless of whether the file can be found:
  // if the blocks reappear somewhere else, the data exists in the world.
  const loaded = await session.command(`structure load ${name} ~5 ~-1 ~5`, { timeout: 10000 });
  session.note('structure_load', brief(loaded));

  const check = await session.command('gettopsolidblock ~6 320 ~6', { timeout: 8000 });
  session.note('loaded_block_check', body(check));

  await announce(session, '§aDONE§r - you can alt-tab now.');
  log('');
  log('agent frames, if any, are in raw-frames.jsonl / unrecognised-frames.json');
}
