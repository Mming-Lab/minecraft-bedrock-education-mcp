// D-2: which channel is the add-on actually speaking on, and where exactly does a line die?
//
// Two things came out of D-1 that do not fit what the design says.
//
// **The name prefix.** The design records that `say` arrives as `[Kai_U] MCPB|...` and `tell`
// arrives bare, and that the add-on was switched to `tell` so a 172-line read is private
// rather than dropped in front of a whole class. In D-1 the add-on's `ping` reply arrived
// *with* the prefix. Either the prefix is not the tell/say tell-tale it was taken for, or the
// pack loaded in this world predates the switch. Both are testable and they call for opposite
// responses - one changes the design note, the other changes nothing but the installed files -
// so this asks the question directly instead of picking the likelier answer.
//
// The `channel` handler sends the same payload both ways, tagged `.say` and `.tell`. Whatever
// the prefix means, those two lines mean it differently, and `ping` can then be placed
// against them.
//
// **The line limit.** D-1 saw 457 characters arrive whole and a ~660-character line vanish.
// The constant in use is 460, which leaves it sitting just *above* the longest line ever
// observed to survive rather than below it. The earlier measurement of 484 arriving and 487
// vanishing was made at a coarser step and on the `say` path. This walks the boundary in
// fives, on both paths, so the constant rests on where the cliff is rather than on two points
// either side of it.

const RE_PREFIX = /^\[[^\]]*\]\s/;

/** Every bridge line said since `from`, with the tag it was sent under. */
function said(session, from) {
  return session.events
    .slice(from)
    .map((event) => event.event?.message ?? '')
    .filter((message) => message.includes('MCPB|'));
}

function findTagged(lines, tag) {
  const line = lines.find((message) => message.includes(`|${tag}|`));
  if (!line) return null;
  return { chars: line.length, prefixed: RE_PREFIX.test(line), sample: line.slice(0, 60) };
}

export async function run(session, { log }) {
  const control = session.events.length;
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(800);
  if (session.events.length === control) {
    session.note('reading', 'No PlayerMessage at all. Nothing below this line means anything.');
    return;
  }

  // --- 1. is the add-on there, and how does its own reply look? ----------------------------
  const pingFrom = session.events.length;
  await session.command('scriptevent mcp:ping pg {}', { timeout: 8000 });
  await session.wait(1500);
  const ping = findTagged(said(session, pingFrom), 'pg');
  session.note('ping', ping);
  if (!ping) {
    session.note('reading', 'The add-on did not answer. Reload the world so the pack loads.');
    log('STOPPING: the add-on is not answering');
    return;
  }

  // --- 2. the same payload down both paths, so the prefix can be attributed -----------------
  const bothFrom = session.events.length;
  await session.command('scriptevent mcp:channel cc {"chars":120}', { timeout: 8000 });
  await session.wait(2000);
  const lines = said(session, bothFrom);
  const viaSay = findTagged(lines, 'cc.say');
  const viaTell = findTagged(lines, 'cc.tell');
  session.note('via_say', viaSay);
  session.note('via_tell', viaTell);

  // The reading, stated rather than left for someone to infer from three rows.
  let verdict;
  if (!viaSay || !viaTell) {
    verdict = 'One of the two paths produced nothing, so the prefix cannot be attributed. Check the pack version.';
  } else if (viaSay.prefixed === viaTell.prefixed) {
    verdict = `Both paths arrive ${viaSay.prefixed ? 'with' : 'without'} the name prefix, so the prefix does not distinguish them and the design note that says it does is wrong.`;
  } else if (ping.prefixed === viaSay.prefixed) {
    verdict = 'The prefix does distinguish them, and ping looks like say - so the pack loaded in this world is the older one that broadcasts. Reinstall tools/mcp-bridge and restart the game before the classroom claim means anything.';
  } else {
    verdict = 'The prefix does distinguish them, and ping looks like tell. The pack is current; D-1 read a stale line.';
  }
  session.note('channel_in_use', verdict);
  log(`  ${verdict}`);

  // --- 3. where the cliff is ----------------------------------------------------------------
  //
  // `chars` is the filler only; the tag and id ride in front of it, and `say` adds the name at
  // the far end. So the number that matters is the length of what *arrived*, which is measured
  // rather than computed - the whole failure mode here is a line that never arrives to measure.
  const sweep = [];
  for (const chars of [400, 430, 450, 460, 465, 470, 475, 480, 485, 490, 500, 520]) {
    const from = session.events.length;
    await session.command(`scriptevent mcp:channel L${chars} {"chars":${chars}}`, { timeout: 8000 });
    await session.wait(1200);
    const got = said(session, from);
    const row = {
      chars,
      say: findTagged(got, `L${chars}.say`)?.chars ?? null,
      tell: findTagged(got, `L${chars}.tell`)?.chars ?? null,
    };
    sweep.push(row);
    log(`  filler ${chars}:  say ${row.say ?? 'GONE'}  tell ${row.tell ?? 'GONE'}`);
  }
  session.note('length_sweep', sweep);

  const arrived = (key) => sweep.filter((row) => row[key] !== null).map((row) => row[key]);
  const vanished = (key) => sweep.filter((row) => row[key] === null).map((row) => row.chars);
  const longest = (key) => arrived(key).reduce((most, n) => Math.max(most, n), 0);

  session.note('limits', {
    say: { longest_arrived: longest('say'), filler_sizes_that_vanished: vanished('say') },
    tell: { longest_arrived: longest('tell'), filler_sizes_that_vanished: vanished('tell') },
  });

  session.note(
    'reading',
    vanished('say').length === 0 && vanished('tell').length === 0
      ? `Nothing vanished up to a 520-character filler. The ceiling is higher than the sweep, so MAX_LINE has more headroom than assumed - widen the sweep before raising it.`
      : `Longest line that arrived whole: say ${longest('say')}, tell ${longest('tell')}. MAX_LINE must sit below the smaller of those, with room for a player name the server cannot know in advance.`
  );
}
