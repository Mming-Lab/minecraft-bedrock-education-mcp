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

  const rungs = {
    list: await session.command('list', { timeout: 6000 }),
    say: await session.command('say probe: liveness check', { timeout: 6000 }),
    setblock: await session.command('setblock ~ ~-3 ~ minecraft:gold_block replace', { timeout: 6000 }),
  };
  for (const [name, reply] of Object.entries(rungs)) {
    session.note(`gate_${name}`, status(reply));
  }

  if (!answered(rungs.setblock)) {
    // Say what the evidence supports, and no more. Each of these is a different thing for a
    // person to go and check, so guessing wrong costs another whole session.
    let diagnosis;
    if (!answered(rungs.list)) {
      diagnosis = 'nothing answers at all - the socket is connected but no command is being processed';
    } else if (!answered(rungs.say)) {
      diagnosis = '`list` answers but `say` does not: the session is alive and the world is not running. Most likely the game is paused - in single player the world stops while the pause menu is open or the window is in the background. Keep the game focused and in the world while the rig runs.';
    } else {
      diagnosis = '`say` answers but `setblock` does not: the world is running, so this is permission. Check that cheats are enabled for the world and that the player is an operator (/op, or the world settings).';
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
  // Confirming absence against the command list rather than against a syntax guess. The
  // previous run established these are not in /help; this checks that calling them fails the
  // same way, so the finding does not rest on how /help chooses to answer.

  const absent = {};
  for (const command of ['getchunkdata', 'getchunks', 'gettopsolidblock', 'querytarget']) {
    absent[command] = status(await session.command(command, { timeout: 5000 }));
  }
  session.note('absent_commands', absent);

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
