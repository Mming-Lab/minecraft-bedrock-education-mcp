// A-2: the world-facing questions, with a gate in front of them.
//
//   node probe.mjs --rig a2-world
//
// The first run of a1-core connected, answered 48 help requests, and then got silence from
// all 34 commands that touch the world - four minutes of timeouts producing one bit of
// information. This rig spends three commands establishing whether the world is answering at
// all, and stops with a diagnosis if it is not.
//
// The ladder is chosen so each rung fails for a different reason:
//
//   list      needs the session, not the world      - if this is silent, the socket is wrong
//   say       needs the world to be running         - if only this is silent, it is paused
//   setblock  needs the world AND permission        - if only this is silent, it is cheats/op
//
// Coordinates are relative throughout. `querytarget` does not exist in this build, so there
// is no way to ask where the player is; `~` sidesteps needing to know.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const status = (r) => ({
  code: r.body?.statusCode ?? null,
  message: (r.body?.statusMessage ?? '').replace(/§./g, '') || null,
  timedOut: !!r.timedOut,
});
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;
const answered = (r) => !r.timedOut;

export async function run(session, { log, dump }) {
  // ---------------------------------------------------------------------------------------
  log('gate: is anything on the other end actually running?');
  // ---------------------------------------------------------------------------------------

  // `/help` is the control, because it is the one command observed to answer. It is answered
  // from the client's own command table, so it needs the socket and the command pipeline and
  // nothing else. Every other reply in this protocol is *command feedback*.
  //
  // That distinction is the whole diagnosis. Two sessions running a2-world's predecessor got
  // 48 help replies and then silence from all 34 commands that follow - not errors, silence.
  // The first gate written for this guessed a paused world, on the theory that `list` is
  // answered by the session; it is not, and `list` was silent too.
  //
  // `sendcommandfeedback` is a gamerule that suppresses command feedback. With it off, a
  // command executes normally and says nothing - which over a socket is indistinguishable
  // from a command that never ran. Education worlds do not always ship with it on.
  //
  // So the gate tries it rather than guessing further: turn the gamerule on, retry. If the
  // silence lifts, that was the cause and the rig continues. Nothing else can be concluded
  // without doing this first, because until feedback is on, every probe reads as a timeout.

  const rungs = {
    help: await session.command('help 1', { timeout: 6000 }),
    say: await session.command('say probe: liveness check', { timeout: 6000 }),
  };

  if (!answered(rungs.help)) {
    session.note('gate_help', status(rungs.help));
    session.note('world_responds', false);
    session.note('diagnosis', '`help` does not answer either. Nothing on the other end is processing commands at all - this is the socket or the session, not the world.');
    log('');
    log('STOPPING: not even /help answers.');
    return;
  }

  if (!answered(rungs.say)) {
    log('  /help answers and /say does not - trying the sendcommandfeedback gamerule');
    // Sent without waiting for a reply, because if the diagnosis is right there will not be
    // one: the command that turns feedback on is itself silent while feedback is off.
    session.send({
      header: { version: 1, requestId: crypto.randomUUID(), messagePurpose: 'commandRequest', messageType: 'commandRequest' },
      body: { origin: { type: 'player' }, commandLine: 'gamerule sendcommandfeedback true', version: 1 },
    });
    await session.wait(1500);
    rungs.sayAfterGamerule = await session.command('say probe: liveness check, take two', { timeout: 6000 });
    session.note('sendcommandfeedback_was_off', answered(rungs.sayAfterGamerule));
  }

  rungs.setblock = await session.command('setblock ~ ~-3 ~ minecraft:gold_block replace', { timeout: 6000 });

  for (const [name, reply] of Object.entries(rungs)) {
    session.note(`gate_${name}`, status(reply));
  }

  if (!answered(rungs.setblock)) {
    let diagnosis;
    if (!answered(rungs.say) && !answered(rungs.sayAfterGamerule ?? { timedOut: true })) {
      diagnosis = '`help` answers, `say` does not, and turning sendcommandfeedback on did not change that. Either the player cannot set gamerules (not an operator / cheats off for this world), or something else is swallowing command feedback. Check in the game: does typing `/say hi` in chat print anything?';
    } else {
      diagnosis = '`say` answers but `setblock` does not: commands run and report, so this is specific to changing blocks. Check that cheats are enabled and, in Education, that the player has worldbuilder permission (`/worldbuilder`) and the area is not protected.';
    }
    session.note('world_responds', false);
    session.note('diagnosis', diagnosis);
    log('');
    log('STOPPING: ' + diagnosis);
    return;
  }

  session.note('world_responds', true);
  session.note('setblock_relative_works', accepted(rungs.setblock));

  // ---------------------------------------------------------------------------------------
  log('phase 1: testforblock - does it name the block it found?');
  // ---------------------------------------------------------------------------------------
  //
  // An earlier design note claimed testforblock returns only a yes or no. That was wrong -
  // a working public implementation parses the block out of statusMessage - and this is
  // where it gets settled against this build and this client language. The string matters
  // verbatim, because a parser would have to match it, and this client is Japanese.

  await session.command('setblock ~2 ~-3 ~2 minecraft:diamond_block replace');
  await session.wait(200);

  const hit = await session.command('testforblock ~2 ~-3 ~2 minecraft:diamond_block');
  const miss = await session.command('testforblock ~2 ~-3 ~2 minecraft:stone');
  session.note('testforblock_hit', status(hit));
  session.note('testforblock_miss', status(miss));

  // sanand0/minecraft-websocket parses the block out of the failure message with this.
  const SANAND = /is (.*?) \(expected:/;
  const missMessage = status(miss).message ?? '';
  const matched = SANAND.exec(missMessage);
  session.note('testforblock_regex_matches', !!matched);
  session.note('testforblock_regex_capture', matched ? matched[1] : null);
  session.note('testforblock_is_localised', /[^\x00-\x7F]/.test(missMessage));

  // If the message is localised, a regex is the wrong instrument entirely and the block has
  // to be identified another way. `execute if block` gives a yes/no with no prose at all, so
  // it survives translation - at the cost of one command per candidate block.
  const ifBlock = await session.command('execute if block ~2 ~-3 ~2 minecraft:diamond_block run say found');
  const ifBlockMiss = await session.command('execute if block ~2 ~-3 ~2 minecraft:stone run say found');
  session.note('execute_if_block_hit', status(ifBlock));
  session.note('execute_if_block_miss', status(ifBlockMiss));
  session.note('execute_if_block_discriminates', accepted(ifBlock) && !accepted(ifBlockMiss));

  // ---------------------------------------------------------------------------------------
  log('phase 2: what this build does NOT have');
  // ---------------------------------------------------------------------------------------
  //
  // Being out of `/help` does not mean being out of the build. Help lists what it lists;
  // Bedrock has commands that are deliberately not in it - `querytarget` is the standard
  // example - and a client without permission for a command would not see it either. So
  // "unknown command" from `/help` is consistent with absent, hidden, and forbidden alike,
  // and the previous run's conclusion that these commands do not exist was not supported by
  // the evidence it had.
  //
  // What separates them is calling the command with no arguments and reading which way it
  // fails. That only means something against controls, so the list is bracketed:
  //
  //   testforblock   known present   -> whatever "exists, wrong arguments" looks like
  //   thiscommand... known absent    -> whatever "no such command" looks like
  //
  // Each unknown then gets classified by which control its reply resembles, rather than by
  // what the reply looks like to me.

  const CONTROL_PRESENT = 'testforblock';
  const CONTROL_ABSENT = 'zzznotacommandatall';

  const probes = [
    CONTROL_PRESENT,
    CONTROL_ABSENT,
    'getchunkdata',
    'getchunks',
    'gettopsolidblock',
    'querytarget',
    'agent',
  ];

  const replies = {};
  for (const command of probes) {
    replies[command] = status(await session.command(command, { timeout: 5000 }));
  }

  const present = replies[CONTROL_PRESENT];
  const missing = replies[CONTROL_ABSENT];

  // A crude similarity: the leading run of the message, which is where the game says what
  // kind of failure this is before it says anything specific to the command.
  const shape = (message) => (message ?? '').replace(/[a-z_]{3,}/gi, '*').slice(0, 40);
  // If the two controls fail the same way, this experiment cannot separate anything and
  // saying so is the result. Reporting a verdict anyway would be the same mistake as last
  // time, one layer down.
  const controlsDiffer = shape(present.message) !== shape(missing.message);

  const classify = (reply) => {
    if (reply.timedOut) return 'no answer';
    if ((reply.code ?? -1) >= 0) return 'accepted';
    if (!controlsDiffer) return 'undecidable - the controls fail identically';
    if (shape(reply.message) === shape(missing.message)) return 'absent (matches the absent control)';
    if (shape(reply.message) === shape(present.message)) return 'present (matches the present control)';
    return 'unclear - neither control';
  };

  session.note('control_present', present);
  session.note('control_absent', missing);
  session.note('controls_differ', controlsDiffer);
  session.note(
    'command_existence',
    Object.fromEntries(probes.map((c) => [c, { verdict: classify(replies[c]), ...replies[c] }]))
  );

  // ---------------------------------------------------------------------------------------
  log('phase 3: the read paths that DO exist');
  // ---------------------------------------------------------------------------------------

  // /structure save writes an .mcstructure the design could parse. Whether it is allowed
  // over a socket, and what it says, is the question.
  const saved = await session.command('structure save probe_readback ~ ~-4 ~ ~4 ~ ~4 disk');
  session.note('structure_save', status(saved));

  // /testforblocks compares two regions in one command - the whole of a symmetry check.
  const compare = await session.command('testforblocks ~ ~-4 ~ ~2 ~-4 ~2 ~10 ~-4 ~10 all');
  session.note('testforblocks', status(compare));

  // ---------------------------------------------------------------------------------------
  log('phase 4: the generated command corpus');
  // ---------------------------------------------------------------------------------------
  //
  // The corpus is written around the origin, which is nowhere near the player and may not be
  // loaded. Absolute coordinates are shifted next to the player so a refusal means the
  // syntax was refused, not that the chunk was missing. Relative and local forms go through
  // untouched - where they land is exactly what is being tested.

  const CORPUS = path.join(HERE, '..', '..', '..', 'tests', 'golden', 'commands', 'corpus.json');
  let corpus = { commands: [] };
  try {
    corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  } catch (error) {
    session.note('corpus_read_error', String(error.message));
  }

  /** Rewrites a leading run of absolute coordinates as offsets from the player. */
  const nearPlayer = (command) => {
    const parts = command.split(' ');
    return parts
      .map((part, i) => {
        if (i === 0) return part;
        if (!/^-?\d+$/.test(part)) return part;
        const n = Number(part);
        // y is the second of each triple; keep it a few blocks below the player.
        return `~${n === 0 ? '' : n}`;
      })
      .join(' ');
  };

  const results = {};
  const rejected = [];
  for (const command of corpus.commands) {
    const sent = /^\S+ [-\d]/.test(command) ? nearPlayer(command) : command;
    const reply = await session.command(sent, { timeout: 8000 });
    results[command] = { sent, ...status(reply) };
    if (!accepted(reply)) rejected.push({ command, sent, ...status(reply) });
  }
  fs.writeFileSync(path.join(dump, 'corpus-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
  session.note('corpus_total', corpus.commands.length);
  session.note('corpus_rejected_count', rejected.length);
  session.note('corpus_rejected', rejected);

  const caret = Object.entries(results).filter(([c]) => c.includes('^'));
  session.note('caret_results', caret.map(([c, r]) => ({ command: c, code: r.code, message: r.message })));
  session.note('caret_accepted', caret.every(([, r]) => (r.code ?? -1) >= 0));

  // ---------------------------------------------------------------------------------------
  log('phase 5: the fill volume limit');
  // ---------------------------------------------------------------------------------------
  //
  // FILL_VOLUME_LIMIT is the one constant in the command builder with no citation: the wiki
  // gives 32768 for Java and says nothing for Bedrock.

  const exactly = await session.command('fill ~ ~-40 ~ ~31 ~-9 ~31 minecraft:air replace', { timeout: 20000 });
  const overBy = await session.command('fill ~ ~-40 ~ ~31 ~-9 ~32 minecraft:air replace', { timeout: 20000 });
  session.note('fill_32768', status(exactly));
  session.note('fill_33792', status(overBy));
  session.note('fill_volume_limit_is_32768', accepted(exactly) && !accepted(overBy));

  if (accepted(overBy)) {
    // Searched with a 1x1xN column so the probe volume is exactly N. A cube can only bracket
    // the answer between two cubes - which is how the first version of this spun forever.
    let lo = 1;
    let hi = 32768 * 64;
    for (let step = 0; step < 40 && lo + 1 < hi; step++) {
      const mid = Math.floor((lo + hi) / 2);
      const probe = await session.command(`fill ~ ~-40 ~ ~ ~-40 ~${mid - 1} minecraft:air replace`, { timeout: 20000 });
      if (accepted(probe)) lo = mid;
      else hi = mid;
    }
    session.note('fill_volume_limit_measured', lo);
    session.note('fill_volume_limit_converged', lo + 1 === hi);
  }

  log('');
  log('done.');
}
