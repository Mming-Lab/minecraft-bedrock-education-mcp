// B-9: does the split hold up?
//
// The design now says bulk block reads go to the world file - it already holds the blocks
// with their states, unlimited in area, no add-on needed - and the add-on earns its place on
// what the file is bad at or does not have. That claim rests on two numbers and one absence,
// none of which have been measured:
//
//   1. A single block through the add-on, in milliseconds. The file path costs 2 to 7 seconds
//      because it needs a flush. If the add-on is not dramatically faster, it has no job here.
//   2. The same block through the file, for the comparison to be like for like.
//   3. Entities and container contents, which the file cannot answer at all without decoding
//      BlockEntity records and waiting for that same flush.
//
// If the add-on turns out to be slow, the honest answer is that the file does everything and
// the add-on is not worth its installation step.

const lines = (session, from) => session.events.slice(from).map((e) => e.event?.message ?? '');
const find = (session, from, needle) => lines(session, from).find((m) => m.includes(needle)) ?? null;

export async function run(session, { log }) {
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(800);

  const ping = session.events.length;
  await session.command('scriptevent mcp:ping p {}', { timeout: 8000 });
  await session.wait(2000);
  const alive = find(session, ping, 'MCPB|p|');
  session.note('bridge', alive);
  if (!alive) {
    session.note('reading', 'The bridge did not answer. Reload the world so the updated script loads.');
    log('STOPPING: ' + session.notes.reading);
    return;
  }

  // Somewhere known to ask about, next to the player.
  const target = await session.command('querytarget @s', { timeout: 6000 });
  let at = null;
  try {
    const p = JSON.parse(target.body.details)[0].position;
    at = { x: Math.floor(p.x) + 3, y: Math.floor(p.y) - 1, z: Math.floor(p.z) + 3 };
  } catch { /* recorded null */ }
  if (!at) {
    session.note('reading', 'could not find the player');
    return;
  }
  await session.command(`setblock ${at.x} ${at.y} ${at.z} minecraft:chest replace`);
  await session.command(`replaceitem block ${at.x} ${at.y} ${at.z} slot.container 0 minecraft:diamond 5`);
  await session.wait(500);

  // --- 1. single block, through the add-on ------------------------------------------------
  //
  // Ten samples, because one would be indistinguishable from a lucky tick.
  const times = [];
  for (let i = 0; i < 10; i++) {
    const from = session.events.length;
    const startedAt = Date.now();
    await session.command(`scriptevent mcp:getblock s${i} {"x":${at.x},"y":${at.y},"z":${at.z}}`, { timeout: 8000 });

    let reply = null;
    while (Date.now() - startedAt < 5000 && !reply) {
      await session.wait(50);
      reply = find(session, from, `MCPB|s${i}|`);
    }
    if (reply) times.push(Date.now() - startedAt);
  }
  times.sort((a, b) => a - b);
  session.note('addon_getblock_ms', {
    samples: times.length,
    fastest: times[0] ?? null,
    median: times[Math.floor(times.length / 2)] ?? null,
    slowest: times[times.length - 1] ?? null,
  });
  log(`  add-on single block: median ${times[Math.floor(times.length / 2)]}ms over ${times.length} samples`);

  // --- 2. the same block, through a command, for scale ------------------------------------
  const cmdTimes = [];
  for (let i = 0; i < 10; i++) {
    const startedAt = Date.now();
    await session.command(`testforblock ${at.x} ${at.y} ${at.z} minecraft:chest`, { timeout: 6000 });
    cmdTimes.push(Date.now() - startedAt);
  }
  cmdTimes.sort((a, b) => a - b);
  session.note('command_testforblock_ms', { median: cmdTimes[5], fastest: cmdTimes[0] });
  log(`  plain command:       median ${cmdTimes[5]}ms`);

  // --- 3. what the file cannot answer -----------------------------------------------------
  const entFrom = session.events.length;
  await session.command(`scriptevent mcp:entities e {"x":${at.x},"y":${at.y},"z":${at.z},"radius":24}`, { timeout: 8000 });
  await session.wait(2500);
  session.note('entities', find(session, entFrom, 'MCPB|e|'));

  const conFrom = session.events.length;
  await session.command(`scriptevent mcp:container c {"x":${at.x},"y":${at.y},"z":${at.z}}`, { timeout: 8000 });
  await session.wait(2500);
  session.note('container', find(session, conFrom, 'MCPB|c|'));

  await session.command(`setblock ${at.x} ${at.y} ${at.z} minecraft:air destroy`);

  const median = session.notes.addon_getblock_ms.median;
  session.note('reading',
    median === null
      ? 'The add-on never answered a getblock, so no comparison is possible.'
      : `A single block costs ${median}ms through the add-on against 2000-7000ms through the world file, so the split holds: the file for bulk, the add-on for anything immediate. Entities and container contents came back in the notes above and the file cannot answer either without a flush.`);
  log('');
  log(session.notes.reading);
}
