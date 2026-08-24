// A-5: how does the AI find out what is in the world?
//
// The one question the whole design rests on, and the only one still open. What is settled:
// `testforblock` is out, because this client localises statusMessage and translates the
// block name inside it; `execute if block` decides on statusCode alone and so survives
// translation; and getchunkdata, getchunks and gettopsolidblock all exist after all.
//
// What is not settled is what those three actually return, and how fast the per-block path
// is. Both are measurable in one connection, so this rig measures them instead of the
// design continuing to reason about them.
//
// Three things, in order of how much they would change the answer:
//
//   1. getchunkdata - the syntax, and the whole reply body. If this returns bulk data, every
//      other path becomes a fallback.
//   2. gettopsolidblock - the whole reply body. socket-be reads blockName and position off
//      it; whether this build sends them is worth knowing before anything depends on it.
//   3. execute if block - the throughput. If a region read is one command per block, the
//      only question that matters is how many per second, serial and in parallel.
//
// Places a small marker column and reads it back. Nothing large.

/** The whole body, not a summary - the point is to find out what fields exist. */
const full = (r) => (r.timedOut ? { timedOut: true } : r.body ?? null);
const code = (r) => (r.timedOut ? null : (r.body?.statusCode ?? null));
const accepted = (r) => !r.timedOut && (code(r) ?? -1) >= 0;

async function announce(session, text) {
  await session.command(`say §b[probe]§r ${text}`, { timeout: 3000 });
}

export async function run(session, { log, dump }) {
  await announce(session, 'reading experiments - stay in the game, about 90 seconds.');

  // ---------------------------------------------------------------------------------------
  log('phase 1: getchunkdata - syntax and reply body');
  // ---------------------------------------------------------------------------------------
  //
  // Every form here is a guess; the command is undocumented and /help does not list it, so
  // there is nothing to read. mcwss is the only public parser and the note taken from it was
  // `getchunkdata <dimension> <chunkX> <chunkZ> <height>`, so that ordering leads. All of
  // them are sent and all the replies kept, because a refusal that names the offending
  // argument is itself a clue about the shape.

  const chunkForms = [
    'getchunkdata overworld 0 0 0',
    'getchunkdata overworld 0 0 100',
    'getchunkdata overworld 0 0',
    'getchunkdata 0 0 0',
    'getchunkdata 0 0',
    'getchunkdata ~ ~ ~',
    'getchunkdata',
    'getchunks overworld',
    'getchunks',
  ];

  const chunkResults = {};
  for (const form of chunkForms) {
    const reply = await session.command(form, { timeout: 8000 });
    chunkResults[form] = full(reply);
    log(`  ${accepted(reply) ? 'ACCEPTED' : 'refused '}  ${form}`);
    if (accepted(reply)) log(`     body keys: ${Object.keys(reply.body ?? {}).join(', ')}`);
  }
  session.note('getchunkdata_forms', chunkResults);
  session.note('getchunkdata_accepted', Object.entries(chunkResults).filter(([, b]) => (b?.statusCode ?? -1) >= 0).map(([k]) => k));

  // ---------------------------------------------------------------------------------------
  log('phase 2: gettopsolidblock - the whole reply');
  // ---------------------------------------------------------------------------------------

  const topForms = ['gettopsolidblock ~ ~ ~', 'gettopsolidblock ~ 320 ~', 'gettopsolidblock'];
  const topResults = {};
  for (const form of topForms) {
    const reply = await session.command(form, { timeout: 8000 });
    topResults[form] = full(reply);
    log(`  ${accepted(reply) ? 'ACCEPTED' : 'refused '}  ${form}`);
    if (accepted(reply)) log(`     ${JSON.stringify(reply.body)}`);
  }
  session.note('gettopsolidblock_forms', topResults);

  // querytarget exists too, and would give the player's position without a chat round trip.
  const target = await session.command('querytarget @s', { timeout: 8000 });
  session.note('querytarget', full(target));

  // ---------------------------------------------------------------------------------------
  log('phase 3: execute if block - throughput');
  // ---------------------------------------------------------------------------------------
  //
  // This is the number the design needs if bulk reading turns out not to exist. Reading a
  // 16x16x16 region one block at a time is 4096 commands; whether that is six seconds or six
  // minutes decides whether the tool can offer it at all.

  // A known column to read back, so the timings are over real hits and misses rather than
  // over air.
  await session.command('setblock ~2 ~-2 ~2 minecraft:diamond_block replace');
  await session.wait(200);

  const serialStart = Date.now();
  const SERIAL = 20;
  let serialHits = 0;
  for (let i = 0; i < SERIAL; i++) {
    const r = await session.command('execute if block ~2 ~-2 ~2 minecraft:diamond_block run say .', { timeout: 8000 });
    if (accepted(r)) serialHits++;
  }
  const serialMs = Date.now() - serialStart;
  session.note('serial_20_ms', serialMs);
  session.note('serial_per_command_ms', Math.round(serialMs / SERIAL));
  session.note('serial_hits', serialHits);
  log(`  serial: ${SERIAL} commands in ${serialMs}ms (${Math.round(serialMs / SERIAL)}ms each)`);

  // In flight together. The legacy notes mention a hundred-command ceiling with
  // TooManyPendingRequests past it; this is the first chance to see it.
  for (const width of [10, 50, 100]) {
    const start = Date.now();
    const replies = await Promise.all(
      Array.from({ length: width }, (_, i) =>
        session.command(`execute if block ~2 ~-2 ~2 minecraft:diamond_block run say ${i}`, { timeout: 20000 })
      )
    );
    const ms = Date.now() - start;
    const ok = replies.filter((r) => accepted(r)).length;
    const timedOut = replies.filter((r) => r.timedOut).length;
    const errors = [...new Set(replies.filter((r) => !accepted(r) && !r.timedOut).map((r) => r.body?.statusMessage))];
    session.note(`parallel_${width}`, { ms, ok, timedOut, perCommandMs: Math.round(ms / width), errors });
    log(`  parallel ${width}: ${ms}ms, ${ok} ok, ${timedOut} timed out${errors.length ? `, errors: ${errors.join(' | ')}` : ''}`);
    await session.wait(500);
  }

  // ---------------------------------------------------------------------------------------
  log('phase 4: agent inspect');
  // ---------------------------------------------------------------------------------------
  //
  // socket-be's author concluded these return no data. That conclusion was formed while the
  // library was discarding `action:agent` frames, so it is worth one look.

  const agentResults = {};
  for (const command of ['agent', 'agent inspect forward', 'agent detect forward', 'agent tp']) {
    const reply = await session.command(command, { timeout: 6000 });
    agentResults[command] = full(reply);
    log(`  ${accepted(reply) ? 'ACCEPTED' : 'refused '}  ${command}`);
  }
  session.note('agent_forms', agentResults);

  const bulk = session.notes.getchunkdata_accepted ?? [];
  const perCommand = session.notes.serial_per_command_ms;
  const best = session.notes.parallel_100 ?? session.notes.parallel_50 ?? session.notes.parallel_10;
  session.note(
    'reading',
    bulk.length
      ? `getchunkdata answers to ${bulk.length} form(s) - read getchunkdata_forms for the body, that decides the design.`
      : `getchunkdata refused every form tried, so bulk reading is not available through it. Per-block costs ${perCommand}ms serial; ${best ? `${best.ok} of a batch came back in ${best.ms}ms` : 'no parallel figure'}.`
  );

  await announce(session, '§aDONE§r - you can alt-tab now.');
  log('');
  log(session.notes.reading);
}
