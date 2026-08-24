// A-0: prove the pipe works, and record the shape of a reply.
//
// Deliberately tiny. Everything downstream assumes a command goes out and a reply comes back
// matched by requestId; if that is wrong, it is better to find out from two commands than
// from a rig that spent three minutes before failing for a reason nobody can see.
//
//   node probe.mjs --rig a0-connect
//
// Places no blocks and changes nothing.

export async function run(session, { log }) {
  log('A-0: connection and reply shape');

  session.subscribe('PlayerMessage');
  await session.wait(300);

  const say = await session.command('say probe connected');
  session.note('round_trip_ok', !say.timedOut);
  session.note('round_trip_ms', say.rtt);

  if (say.timedOut) {
    log('  no reply within the timeout. The socket connected but nothing answers.');
    return;
  }

  // What a reply actually looks like, recorded as keys rather than assumed. The legacy
  // server reads `statusCode` and `statusMessage`; whether those are the names, and what
  // else rides along, is the question.
  session.note('reply_header_keys', Object.keys(say.header ?? {}));
  session.note('reply_body_keys', Object.keys(say.body ?? {}));
  session.note('reply_status_code', say.body?.statusCode ?? null);
  session.note('reply_status_message', say.body?.statusMessage ?? null);
  session.note('reply_message_purpose', say.header?.messagePurpose ?? null);

  // A command that certainly does not exist. The refusal is as much a contract as a success:
  // the tool layer has to tell "the game said no" apart from "the socket died".
  const nonsense = await session.command('thiscommanddoesnotexist');
  session.note('refusal_message_purpose', nonsense.header?.messagePurpose ?? null);
  session.note('refusal_status_code', nonsense.body?.statusCode ?? null);
  session.note('refusal_status_message', nonsense.body?.statusMessage ?? null);
  session.note('refusal_body_keys', Object.keys(nonsense.body ?? {}));

  // Where the player is, so later rigs can build somewhere the player can see.
  const query = await session.command('querytarget @s');
  session.note('querytarget_status', query.body?.statusCode ?? null);
  session.note('querytarget_details', query.body?.details ?? null);

  await session.wait(500);
  session.note('events_seen', session.events.length);
  session.note('event_names', [...new Set(session.events.map((e) => e.body?.eventName ?? e.header?.eventName))]);
}
