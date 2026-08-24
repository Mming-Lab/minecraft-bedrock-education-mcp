// A-3: find the boundary between what answers and what does not.
//
//   node probe.mjs --rig a3-ladder
//
// Two live sessions have shown the same thing: `/help` answers, and nothing else does. Not
// an error - no frame at all. 82 commands out, 48 replies in, and all 48 were the help ones.
//
// Two guesses have been made about why and neither survived being looked up. The wiki gives
// `sendcommandfeedback` (default true) as suppressing feedback "in chat" and does not say
// whether it reaches a socket caller; the one source that mentions the combination says it
// may produce an *empty statusMessage*, which is not what we see. And the request envelope
// is right - it matches the documented format, and /help is answered through the same one.
//
// So this rig stops guessing at the cause and measures the boundary instead. It is cheap:
// about 25 commands, each with a short timeout, and every one of them is a fact.
//
// Nothing here changes a block until the last group, and that group only runs if something
// before it answered.

const status = (r) => ({
  code: r.body?.statusCode ?? null,
  message: (r.body?.statusMessage ?? '').replace(/§./g, '') || null,
  timedOut: !!r.timedOut,
});
const answered = (r) => !r.timedOut;

const TIMEOUT = 4000;
// Shortened by the self-test, which has no one to move around in a world.
const EVENT_WAIT = Number(process.env.PROBE_EVENT_WAIT ?? 20000);

export async function run(session, { log }) {
  // ---------------------------------------------------------------------------------------
  log('the control: does /help still answer?');
  // ---------------------------------------------------------------------------------------

  const control = await session.command('help 1', { timeout: TIMEOUT });
  session.note('control_help', status(control));
  if (!answered(control)) {
    session.note('diagnosis', 'Even /help is silent this time. That is different from the last two sessions and points at the socket or the session rather than at the world.');
    log('STOPPING: /help is silent, which is not the state this rig was written for.');
    return;
  }

  // ---------------------------------------------------------------------------------------
  log('ladder: which kinds of command answer?');
  // ---------------------------------------------------------------------------------------
  //
  // Ordered from least to most privileged, and from "needs nothing" to "changes the world".
  // Whatever the cause is, it draws a line somewhere in this list, and the line is the
  // finding. `gamerule sendcommandfeedback` with no value is the query form - if it answers,
  // it reports the current value and settles that question outright.

  const LADDER = [
    ['help_page', 'help 2'],
    ['help_command', 'help say'],
    ['list', 'list'],
    ['gamerule_query', 'gamerule sendcommandfeedback'],
    ['gamerule_query_other', 'gamerule commandblockoutput'],
    ['time_query', 'time query daytime'],
    ['testfor_self', 'testfor @s'],
    ['say', 'say probe'],
    ['me', 'me probes'],
    ['tellraw', 'tellraw @s {"rawtext":[{"text":"probe"}]}'],
    ['titleraw', 'titleraw @s actionbar {"rawtext":[{"text":"probe"}]}'],
    ['scoreboard_list', 'scoreboard objectives list'],
    ['tickingarea_list', 'tickingarea list'],
    ['worldbuilder_query', 'worldbuilder'],
    ['gamerule_set', 'gamerule sendcommandfeedback true'],
    ['setblock', 'setblock ~ ~-3 ~ minecraft:gold_block replace'],
  ];

  const ladder = {};
  for (const [name, command] of LADDER) {
    const reply = await session.command(command, { timeout: TIMEOUT });
    ladder[name] = { command, ...status(reply) };
    log(`  ${answered(reply) ? 'ANSWERED' : 'silent  '}  ${command}`);
  }
  session.note('ladder', ladder);
  session.note('ladder_answered', Object.entries(ladder).filter(([, r]) => !r.timedOut).map(([k]) => k));
  session.note('ladder_silent', Object.entries(ladder).filter(([, r]) => r.timedOut).map(([k]) => k));

  // ---------------------------------------------------------------------------------------
  log('origin: does the command source change anything?');
  // ---------------------------------------------------------------------------------------
  //
  // Every command so far went out as `origin: {type: "player"}`, which is what every public
  // implementation sends. It is worth three commands to find out whether this build wants
  // something else, because if it does, no amount of checking world settings would ever have
  // found it.

  const origins = {};
  for (const type of ['player', 'server', 'automationPlayer', 'commandBlock']) {
    const reply = await session.raw('commandRequest', {
      origin: { type },
      commandLine: 'say probe origin ' + type,
      version: 1,
    }, { timeout: TIMEOUT });
    origins[type] = status(reply);
    log(`  ${answered(reply) ? 'ANSWERED' : 'silent  '}  origin=${type}`);
  }
  session.note('origin_types', origins);
  session.note('origin_any_answered', Object.entries(origins).filter(([, r]) => !r.timedOut).map(([k]) => k));

  // ---------------------------------------------------------------------------------------
  log('events: does the server push anything at all?');
  // ---------------------------------------------------------------------------------------
  //
  // This separates "the server is not answering me" from "the server is not talking at all".
  // If a subscribed event arrives, the server->client direction works and the problem is
  // specific to command replies. If nothing arrives either, that is a much bigger clue.

  const before = session.events.length;
  for (const name of ['PlayerMessage', 'BlockPlaced', 'BlockBroken', 'PlayerTravelled', 'PlayerTransform']) {
    session.subscribe(name);
  }
  log('  subscribed. Move around and type something in chat - waiting ' + Math.round(EVENT_WAIT / 1000) + ' seconds.');
  await session.wait(EVENT_WAIT);

  const events = session.events.slice(before);
  session.note('events_received', events.length);
  session.note('event_names', [...new Set(events.map((e) => e.body?.eventName ?? e.header?.eventName))]);
  session.note('server_pushes_events', events.length > 0);

  // ---------------------------------------------------------------------------------------
  // What the numbers mean, stated only as far as they go.
  // ---------------------------------------------------------------------------------------

  const answeredCount = Object.values(ladder).filter((r) => !r.timedOut).length;
  let reading;
  if (answeredCount === Object.keys(ladder).length) {
    reading = 'Everything answered. Whatever caused the silence in the previous sessions is not present now - compare this world and this session against those.';
  } else if (answeredCount <= 2) {
    reading = `Only ${answeredCount} of ${Object.keys(ladder).length} answered, and /help is among them. Command replies are not reaching this socket. events_received says whether the server is pushing anything at all.`;
  } else {
    reading = `${answeredCount} of ${Object.keys(ladder).length} answered. The boundary is between "${session.notes.ladder_answered.at(-1)}" and "${session.notes.ladder_silent[0]}" - that pair is the finding.`;
  }
  session.note('reading', reading);

  log('');
  log(reading);
}
