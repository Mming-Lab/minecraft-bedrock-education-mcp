// The measurements themselves, split out so more than one rig can run them.
//
// a2-world reaches these through its own gate; a4-focus reaches them the moment it sees the
// world answer. Neither should own them, because the expensive part of a live session is
// getting a world that responds - once there is one, every question should be asked.

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

export async function runBattery(session, { log, dump }) {
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
