// D-1: does the bridge client hold up against the real game?
//
// Everything above the socket is now implemented and tested against a fake add-on:
// `encodeRequest`, `parseLine`, `assemble`, and the timeouts in `BridgeClient`. All of it
// rests on two claims that were measured once, by hand, and then written into constants:
//
//   1. A chat line over ~484 characters vanishes *whole* rather than being truncated.
//   2. Therefore a long answer must be split, and the header's `parts` count is what makes a
//      vanished line detectable.
//
// Claim 2 is the one that matters, and it has never been exercised end to end. `assemble()`
// refusing an incomplete set is only worth something if an incomplete set actually occurs the
// way the design says it does - a header that arrives, some parts that arrive, and no error
// anywhere from the game. If instead the game truncates, or drops the header, or refuses the
// command outright, then the protection is aimed at the wrong failure.
//
// So this rig deliberately asks for lines that are too long, and checks that the *client*
// catches it. A pass here means the detection works on real hardware; a failure says the
// model of the limit is wrong, which is worth more than another green test.
//
// It also produces the number §4.2 of the implementation plan leaves open: what `perMessage`
// should be. That depends on how long real block names are, which cannot be known before
// reading them, so it is measured here rather than guessed.
//
// The transport is the runner's session rather than SocketBridgeTransport. Not to avoid
// testing it - it has its own tests against a fake game - but because the runner owns the
// only live connection, and taking it over would cost a reconnect, which only a human can do.

import { BridgeClient } from '../../../packages/server/dist/bridge/client.js';
import { itemsPerLine, MAX_LINE, parseLine } from '../../../packages/server/dist/bridge/protocol.js';

/**
 * A BridgeTransport backed by the runner's session.
 *
 * The runner pushes every PlayerMessage onto `session.events`; it has no way to hand out a
 * listener, and changing it would mean restarting it, which would drop the connection. So
 * this polls the array instead. Ten milliseconds is far below the 1.5s quiet window that ends
 * a reply, so the polling cannot be what decides whether an answer looks complete.
 */
function transportOver(session, seen) {
  const listeners = new Set();
  let at = seen;
  const pump = setInterval(() => {
    while (at < session.events.length) {
      const message = session.events[at++]?.event?.message;
      if (typeof message === 'string') for (const listener of [...listeners]) listener(message);
    }
  }, 10);

  return {
    stop: () => clearInterval(pump),
    transport: {
      async send(commandLine) {
        await session.command(commandLine, { timeout: 10000 });
      },
      onChat(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

/** Every bridge line the game said during a window, longest first. */
function bridgeLines(session, from) {
  return session.events
    .slice(from)
    .map((event) => event.event?.message ?? '')
    .filter((message) => message.includes('MCPB|'));
}

export async function run(session, { log }) {
  // The control. Chat is the return path for everything below, so "no answer" has to be
  // distinguishable from "no channel" before any of it is interpreted - that confusion has
  // already produced four wrong conclusions in this project.
  const control = session.events.length;
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(800);
  const chatWorks = bridgeLines(session, control).length > 0 || session.events.length > control;
  session.note('chat_channel', chatWorks ? 'events arriving' : 'NOTHING - stop reading here');
  if (!chatWorks) {
    session.note('reading', 'No PlayerMessage at all. Nothing below this line means anything.');
    return;
  }

  const { transport, stop } = transportOver(session, session.events.length);

  try {
    const client = new BridgeClient(transport, { firstLineMs: 8000, quietMs: 1500 });

    // --- 1. is the add-on there? ------------------------------------------------------------
    let ping;
    try {
      ping = await client.request('ping');
      session.note('ping', ping.header);
    } catch (error) {
      session.note('ping', `FAILED: ${error.message}`);
      session.note('reading', 'The add-on did not answer. Reload the world so the pack loads.');
      log('STOPPING: the add-on is not answering');
      return;
    }

    // --- 2. somewhere to read ---------------------------------------------------------------
    const target = await session.command('querytarget @s', { timeout: 6000 });
    let at = null;
    try {
      const position = JSON.parse(target.body.details)[0].position;
      at = { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) };
    } catch {
      /* recorded as null below */
    }
    if (!at) {
      session.note('reading', 'could not find the player, so there is nowhere to read');
      return;
    }
    session.note('player_at', at);

    const box = {
      x1: at.x - 4,
      y1: at.y - 2,
      z1: at.z - 4,
      x2: at.x + 3,
      y2: at.y + 1,
      z2: at.z + 3,
    };
    const volume = 8 * 4 * 8;

    // --- 3. one round trip, to learn how long the names are ----------------------------------
    //
    // `perMessage` has to be chosen before the request goes out, but it depends on names that
    // are only known after reading them. One conservative read supplies the number the rest
    // of the run - and the MCP tool - can use.
    const sample = await client.request('readregion', { ...box, perMessage: 8 });
    const sampled = sample.parts.flatMap((part) => part.blocks ?? []);
    const named = sampled.filter((name) => typeof name === 'string');
    const averageChars = named.length
      ? Math.round((named.reduce((sum, name) => sum + name.length, 0) / named.length) * 10) / 10
      : 0;

    session.note('region', { ...box, volume, returned: sampled.length, missing: sample.header.missing });
    session.note('block_name_chars', {
      average: averageChars,
      longest: named.reduce((longest, name) => Math.max(longest, name.length), 0),
      distinct: new Set(named).size,
    });
    session.note('items_per_line_recommends', itemsPerLine(4, Math.ceil(averageChars)));

    // --- 4. how big can perMessage get before lines start disappearing? ----------------------
    //
    // The interesting column is not whether a read succeeds. It is whether a read that fails
    // *fails loudly*. A silently short answer is the one failure this whole protocol exists to
    // prevent, and it would look, from up here, like a smaller region.
    const attempts = [];
    for (const perMessage of [8, 16, 24, 32, 48, 64, 96, 160]) {
      const from = session.events.length;
      const startedAt = Date.now();
      let outcome;
      try {
        const answer = await client.request('readregion', { ...box, perMessage });
        const blocks = answer.parts.flatMap((part) => part.blocks ?? []);
        outcome = {
          perMessage,
          verdict: blocks.length === volume ? 'complete' : 'SHORT BUT ACCEPTED',
          parts: answer.header.parts,
          blocks: blocks.length,
        };
      } catch (error) {
        outcome = {
          perMessage,
          verdict: /incomplete/.test(error.message) ? 'refused as incomplete' : 'other failure',
          error: error.message.slice(0, 140),
        };
      }

      const said = bridgeLines(session, from);
      outcome.longest_line = said.reduce((longest, line) => Math.max(longest, line.length), 0);
      outcome.lines = said.length;
      outcome.ms = Date.now() - startedAt;
      attempts.push(outcome);
      log(`  perMessage=${String(perMessage).padStart(3)}  ${outcome.verdict}  longest line ${outcome.longest_line}`);
      await session.wait(400);
    }
    session.note('per_message_sweep', attempts);

    // The claim under test, stated so a reader does not have to infer it from the table.
    const dropped = attempts.filter((a) => a.verdict === 'refused as incomplete');
    const silent = attempts.filter((a) => a.verdict === 'SHORT BUT ACCEPTED');
    session.note('loss_is_detected', {
      any_loss_occurred: dropped.length > 0 || silent.length > 0,
      refused: dropped.map((a) => a.perMessage),
      passed_off_as_complete: silent.map((a) => a.perMessage),
    });

    // --- 5. what the longest surviving line actually measured --------------------------------
    const survived = attempts.filter((a) => a.verdict === 'complete');
    const longestSurviving = survived.reduce((longest, a) => Math.max(longest, a.longest_line), 0);
    session.note('line_limit', {
      longest_line_that_arrived_whole: longestSurviving,
      max_line_constant: MAX_LINE,
      // A constant below every line that arrived is doing its job; one above the largest
      // observed line has never been tested at the point it matters.
      constant_is_below_observed: MAX_LINE >= longestSurviving,
    });

    // --- 6. is a bridge line still a bridge line after the round trip? -----------------------
    //
    // parseLine strips an optional `[name] ` prefix because `say` carries one and `tell` does
    // not. The add-on now uses `tell`; if that ever changed under us, every reply would still
    // arrive and none would parse.
    const anyLine = bridgeLines(session, control).find((line) => line.includes('MCPB|'));
    session.note('line_shape', {
      sample: anyLine?.slice(0, 90) ?? null,
      has_name_prefix: anyLine ? /^\[/.test(anyLine) : null,
      parses: anyLine ? parseLine(anyLine) !== null : null,
    });

    session.note(
      'reading',
      silent.length
        ? `A read came back short and was accepted at perMessage=${silent.map((a) => a.perMessage).join(', ')}. That is the failure the protocol is supposed to make impossible.`
        : dropped.length
          ? `Loss occurred at perMessage=${dropped.map((a) => a.perMessage).join(', ')} and every case was refused rather than passed off as complete.`
          : 'No line was lost at any perMessage tried, so the detection was never exercised. Raise the ceiling and run again before trusting it.'
    );
  } finally {
    stop();
  }
}
