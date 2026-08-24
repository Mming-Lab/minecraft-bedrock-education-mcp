// B-1: does the Script API actually run, and how much can it say?
//
// A behavior pack is installed in the world with a script that answers `/scriptevent` by
// calling `world.sendMessage`. Anything it says arrives back over the socket the MCP server
// already has, so the pair is a request/response channel needing no networking from inside
// the game - which matters, because a client cannot open a socket of its own.
//
// If this works it outranks both other read paths. Commands cannot name a block without
// being told what to look for and cost a round trip each; the world file is exact and
// unlimited but needs the server on the same machine, which rules out the iPads and
// Chromebooks Education Edition runs on. `getBlock().typeId` has neither problem.
//
// The question is bandwidth. A 16x16x16 region is 4096 blocks, and if a chat line carries a
// few dozen of them that region is a hundred messages. This measures what actually arrives.

const say = (r) => (r.body?.statusMessage ?? '').replace(/§./g, '');
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

export async function run(session, { log }) {
  // Chat is the return path, so it has to be subscribed before anything is asked.
  await session.wait(500);

  // The runner registers PlayerMessage before any connection, because socket-be decides its
  // subscriptions from the handlers on the server and a rig cannot add one later. An earlier
  // version of this rig called session.subscribe() and read an events array nothing filled,
  // so it reported 'the pack did not load' about a channel nobody was listening on.
  // The control, and the reason the last two runs proved nothing: this rig asks the game a
  // question and then looks at chat, but nothing in it ever makes the game *say* anything, so
  // an empty chat log is equally consistent with 'the script did not answer' and 'nobody was
  // listening'. A /say the runner sends itself separates the two before anything else runs.
  const beforeControl = session.events.length;
  const sayReply = await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(1200);
  const chatWorks = session.events.length > beforeControl;
  session.note('say_accepted', !sayReply.timedOut);
  session.note('chat_reaches_the_socket', chatWorks);
  session.note('chat_control_events', session.events.slice(beforeControl).map((e) => JSON.stringify(e).slice(0, 200)));

  if (!chatWorks) {
    session.note(
      'reading',
      'A /say the runner sent did not come back as an event, so the chat channel is not being delivered at all. Nothing can be concluded about the Script API until that is fixed - it is the return path the bridge depends on.'
    );
    log('STOPPING: ' + session.notes.reading);
    return;
  }

  const seen = () => session.events.filter((e) => JSON.stringify(e).includes('MCPB'));
  session.note('bridge_messages_before', seen().length);

  // --- is the pack loaded at all? --------------------------------------------------------
  const ping = await session.command('scriptevent mcp:ping p1 {}', { timeout: 8000 });
  session.note('scriptevent_accepted', accepted(ping));
  session.note('scriptevent_reply', { code: ping.body?.statusCode ?? null, message: say(ping) });
  await session.wait(1500);

  const afterPing = seen();
  session.note('bridge_replied', afterPing.length > 0);
  session.note('bridge_first_message', afterPing[0] ? JSON.stringify(afterPing[0]).slice(0, 400) : null);

  if (afterPing.length === 0) {
    session.note(
      'reading',
      'The scriptevent command was ' + (accepted(ping) ? 'accepted' : 'refused') +
        ' but nothing came back on chat. Either the pack is not loaded (the world needs reloading after a pack is added), the manifest names a @minecraft/server version this build does not have, or world.sendMessage does not reach the socket. The game shows pack errors on the world screen.'
    );
    log('STOPPING: ' + session.notes.reading);
    return;
  }

  // --- one block, exactly ----------------------------------------------------------------
  const before = seen().length;
  await session.command('setblock ~5 ~-1 ~5 minecraft:lapis_block replace');
  await session.wait(300);
  await session.command('scriptevent mcp:getblock g1 {"x":5,"y":-1,"z":5}', { timeout: 8000 });
  await session.wait(1500);
  session.note('getblock_messages', seen().slice(before).map((e) => JSON.stringify(e).slice(0, 300)));

  // --- how much fits, and how fast -------------------------------------------------------
  for (const [count, chars] of [[10, 100], [50, 200], [100, 400]]) {
    const from = seen().length;
    const startedAt = Date.now();
    await session.command(`scriptevent mcp:bench b${count} {"count":${count},"chars":${chars}}`, { timeout: 10000 });
    await session.wait(4000);
    const arrived = seen().length - from;
    session.note(`bench_${count}x${chars}`, {
      sent: count,
      arrived,
      lost: count + 1 - arrived,
      ms: Date.now() - startedAt,
    });
    log(`  bench ${count} x ${chars} chars: ${arrived} messages arrived`);
  }

  // --- a real region ---------------------------------------------------------------------
  const regionFrom = seen().length;
  const startedAt = Date.now();
  await session.command('scriptevent mcp:readregion r1 {"x1":0,"y1":-61,"z1":0,"x2":7,"y2":-58,"z2":7,"perMessage":40}', { timeout: 10000 });
  await session.wait(6000);
  const regionMessages = seen().slice(regionFrom);
  session.note('region_8x4x8', {
    blocks: 8 * 4 * 8,
    messagesArrived: regionMessages.length,
    ms: Date.now() - startedAt,
  });
  session.note('region_sample', regionMessages.slice(0, 3).map((e) => JSON.stringify(e).slice(0, 300)));

  session.note('reading', 'The bridge answered. Read the bench_* notes for how much of what it sent actually arrived.');
  log('');
  log(session.notes.reading);
}
