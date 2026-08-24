// B-5: how much can the bridge actually say?
//
// The bridge works. It always did - `world.sendMessage` reaches the game's chat but not the
// socket, because PlayerMessage is a *player* event and a system message is not one. Three
// sessions were spent reading that as "scripts do not run". The fix is one line: answer with
// `player.runCommand('say ...')`, which arrives with a `[name]` prefix and does reach the
// socket.
//
// So the remaining question is capacity, and it is the one that decides the design. A 16x16x16
// region is 4096 blocks. If a chat line carries thirty of them, that region is 137 lines, and
// what matters is whether all 137 arrive and how long they take. If lines are dropped or
// rate limited, bulk reading stays with the world file and the bridge is for point queries.

const say = (r) => (r.body?.statusMessage ?? '').replace(/§./g, '');

export async function run(session, { log }) {
  const control = session.events.length;
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(1000);
  session.note('chat_reaches_the_socket', session.events.length > control);

  const collect = (from, needle) =>
    session.events.slice(from).map((e) => e.event?.message ?? '').filter((m) => m.includes(needle));

  // --- is the bridge answering on the path that reaches us? -------------------------------
  const pingFrom = session.events.length;
  await session.command('scriptevent mcp:ping p {}', { timeout: 8000 });
  await session.wait(2500);
  const pings = collect(pingFrom, 'MCPB|p|');
  session.note('bridge_answered', pings.length > 0);
  session.note('bridge_reply', pings[0] ?? null);

  if (!pings.length) {
    session.note('reading', 'The bridge did not answer on the socket. If its line shows in the game but not here, it is still using world.sendMessage - the pack needs reloading with the runCommand version.');
    log('STOPPING: ' + session.notes.reading);
    return;
  }

  // --- one block, with its states ---------------------------------------------------------
  await session.command('setblock ~2 ~-1 ~2 minecraft:oak_log ["pillar_axis"="x"] replace');
  await session.wait(400);
  const target = await session.command('querytarget @s', { timeout: 6000 });
  let at = null;
  try {
    const p = JSON.parse(target.body.details)[0].position;
    at = { x: Math.floor(p.x) + 2, y: Math.floor(p.y) - 1, z: Math.floor(p.z) + 2 };
  } catch { /* recorded null */ }

  if (at) {
    const from = session.events.length;
    await session.command(`scriptevent mcp:getblock g {"x":${at.x},"y":${at.y},"z":${at.z}}`, { timeout: 8000 });
    await session.wait(2000);
    session.note('getblock_at', at);
    session.note('getblock_reply', collect(from, 'MCPB|g|')[0] ?? null);
  }

  // --- how much gets through ---------------------------------------------------------------
  for (const [count, chars] of [[20, 100], [50, 300], [100, 600], [200, 300]]) {
    const from = session.events.length;
    const startedAt = Date.now();
    await session.command(`scriptevent mcp:bench b${count}x${chars} {"count":${count},"chars":${chars}}`, { timeout: 10000 });
    await session.wait(6000);
    const arrived = collect(from, `b${count}x${chars}.`).length;
    const longest = Math.max(0, ...collect(from, `b${count}x${chars}.`).map((m) => m.length));
    session.note(`bench_${count}x${chars}`, { sent: count, arrived, lost: count - arrived, longestLine: longest, ms: Date.now() - startedAt });
    log(`  ${String(count).padStart(3)} lines x ${chars} chars: ${arrived} arrived, longest ${longest}`);
  }

  // --- a real region -----------------------------------------------------------------------
  if (at) {
    const from = session.events.length;
    const startedAt = Date.now();
    const x1 = at.x - 4, y1 = at.y, z1 = at.z - 4;
    await session.command(
      `scriptevent mcp:readregion r {"x1":${x1},"y1":${y1},"z1":${z1},"x2":${x1 + 7},"y2":${y1 + 3},"z2":${z1 + 7},"perMessage":30}`,
      { timeout: 10000 }
    );
    await session.wait(8000);
    const lines = collect(from, 'MCPB|r');
    session.note('region_8x4x8', { blocks: 8 * 4 * 8, linesArrived: lines.length, ms: Date.now() - startedAt });
    session.note('region_sample', lines.slice(0, 2));
  }

  const b = session.notes.bench_100x600 ?? session.notes.bench_50x300;
  session.note('reading', b
    ? `${b.arrived} of ${b.sent} lines arrived, longest ${b.longestLine} chars. That is the ceiling on a one-round-trip read.`
    : 'no bench figure');
  log('');
  log(session.notes.reading);
}
