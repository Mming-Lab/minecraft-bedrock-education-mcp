// A-4: prove what the silence was, then immediately use the working world.
//
//   node probe.mjs --rig a4-focus
//
// Three sessions produced the same shape: `/help` answers, everything else is silent, no
// pushed events at all. a3-ladder narrowed it down - 14 of 16 rungs silent, all four
// origin.type values silent, and zero events in twenty seconds after subscribing to five of
// them. Nothing was reaching the game server, and the game server was not saying anything
// either.
//
// `/help` is the exception because it is answered by the client from its own command table.
// So the client is alive and the world is not, which is what Bedrock does when its window
// loses focus: single-player worlds pause, and there is no setting to turn that off. Every
// session so far was run by someone who typed /connect and then switched to a terminal to
// say they had - pausing the world each time, right before the rig started asking it things.
//
// This rig polls until the world answers, records exactly when it started, and then runs the
// whole battery. The timeline is the evidence and the battery is the point: the expensive
// part of a live session is getting a world that responds, so once there is one, nothing
// should be left unasked.

import { runBattery } from './_battery.mjs';

const answered = (r) => !r.timedOut;

const POLL_EVERY = 2000;
// Ten minutes, because the person it is waiting for has to be in the game for the whole run
// and cannot be told when to go back. The first version waited ninety seconds and spent all
// of it on a paused world, which is the same mistake as before wearing a different hat: the
// only way to say "the rig is ready" was a terminal the player had to alt-tab to, and
// alt-tabbing is what pauses the world.
const GIVE_UP_AFTER = Number(process.env.PROBE_FOCUS_WAIT ?? 600000);

/**
 * Says something in the game.
 *
 * The whole reason this rig kept failing is that its only output was a terminal nobody could
 * look at without breaking the thing being measured. Once the world is answering, it can be
 * told what is happening in the one place the player is already looking.
 */
async function announce(session, text) {
  await session.command(`say §b[probe]§r ${text}`, { timeout: 3000 });
}

export async function run(session, { log, dump }) {
  log('waiting for the world to answer. Stay in the game window - do not alt-tab.');
  log(`polling every ${POLL_EVERY / 1000}s for up to ${GIVE_UP_AFTER / 1000}s.`);
  log('progress will be announced in the game chat once the world responds.');

  const timeline = [];
  const startedAt = Date.now();
  let liveAt = null;

  while (Date.now() - startedAt < GIVE_UP_AFTER) {
    // A read-only query: it needs the server, and it changes nothing if the world is running
    // after all. `say` would spam the chat of whoever is watching.
    const reply = await session.command('time query daytime', { timeout: POLL_EVERY });
    const at = Date.now() - startedAt;
    timeline.push({ at, answered: answered(reply) });

    if (answered(reply)) {
      liveAt = at;
      log(`  the world answered at ${(at / 1000).toFixed(1)}s`);
      break;
    }
    if (timeline.length % 5 === 0) log(`  still silent at ${(at / 1000).toFixed(0)}s`);
  }

  session.note('focus_timeline', timeline);
  session.note('world_answered_after_ms', liveAt);
  session.note('polls_before_answer', timeline.length);

  if (liveAt === null) {
    session.note('world_responds', false);
    session.note(
      'diagnosis',
      `The world stayed silent for the whole ${GIVE_UP_AFTER / 1000}s while /help kept working. ` +
        'Bedrock pauses single-player worlds when the window loses focus and offers no setting to stop it, ' +
        'so the first thing to rule out is whether the game window was focused for that whole time. ' +
        'The documented way to keep a world running while looking at something else is to open the ' +
        'inventory or a chest first - a container being open keeps it ticking. If the window WAS focused ' +
        'the whole time, this is not the pause and the next thing to check is whether the world has ' +
        'cheats enabled.'
    );
    log('');
    log('STOPPING: the world never answered.');
    return;
  }

  session.note('world_responds', true);
  // Stated as what it is: the world was silent and then it was not. Whether that was the
  // window regaining focus is for whoever was at the keyboard to confirm.
  session.note(
    'reading',
    liveAt <= POLL_EVERY
      ? 'The world answered on the first poll, so it was never paused during this session.'
      : `The world was silent for ${(liveAt / 1000).toFixed(1)}s and then answered, with nothing changing on this end. Something outside the socket started it - if the game window was brought into focus around then, that is the pause.`
  );

  log('');
  log('world is live - running the full battery');

  await announce(session, 'world is awake. Running measurements - stay in the game.');
  await announce(session, 'this takes about two minutes. I will say DONE when it is safe to alt-tab.');

  let failure = null;
  try {
    await runBattery(session, { log, dump });
  } catch (error) {
    failure = String(error.message ?? error);
    session.note('battery_error', failure);
    log('battery threw:', error.stack ?? failure);
  }

  // Said even when the battery threw, because the person in the game needs to know they can
  // stop staring at it either way.
  await announce(session, failure ? `§cFAILED§r: ${failure.slice(0, 80)}` : '§aDONE§r - you can alt-tab now.');
  const rejected = session.notes.corpus_rejected_count;
  if (failure === null) {
    await announce(
      session,
      `${Object.keys(session.notes).length} answers recorded${rejected === undefined ? '' : `, ${rejected} commands rejected`}.`
    );
  }
}
