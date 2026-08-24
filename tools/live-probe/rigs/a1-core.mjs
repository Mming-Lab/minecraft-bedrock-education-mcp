// A-1, A-3, A-4, A-7: the questions the design has been guessing at.
//
//   node probe.mjs --rig a1-core
//
// The first phase asks the game to describe its own commands. Everything the design notes
// say about `getchunkdata` came from reading other people's code and from a wiki that does
// not document it; `/help getchunkdata` is the game's own answer and costs one round trip.
// Doing that before probing syntaxes is the difference between measuring and guessing.
//
// Places blocks in a small column near the player. The world is expendable by agreement, but
// there is no reason to make a mess.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, '..', '..', '..', 'tests', 'golden', 'commands', 'corpus.json');

const status = (r) => ({
  code: r.body?.statusCode ?? null,
  message: r.body?.statusMessage ?? null,
  timedOut: !!r.timedOut,
});

/** True when the game accepted the command rather than refusing to parse it. */
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

export async function run(session, { log, dump }) {
  // ---------------------------------------------------------------------------------------
  log('phase 1: the game\'s own command list');
  // ---------------------------------------------------------------------------------------

  const helpPages = [];
  for (let page = 1; page <= 60; page++) {
    const reply = await session.command(`help ${page}`);
    const text = reply.body?.statusMessage ?? '';
    if (!text || helpPages.includes(text)) break;
    helpPages.push(text);
  }
  const commandList = helpPages.join('\n');
  fs.writeFileSync(path.join(dump, 'help.txt'), commandList, 'utf8');
  session.note('help_pages', helpPages.length);
  session.note('help_bytes', commandList.length);

  // The three the whole read-the-world design rests on. Whether they are even in this build
  // is answerable right here.
  for (const name of ['getchunkdata', 'getchunks', 'gettopsolidblock', 'testforblock', 'structure', 'agent']) {
    const reply = await session.command(`help ${name}`);
    session.note(`help_${name}`, status(reply).message);
  }

  // ---------------------------------------------------------------------------------------
  log('phase 2: where does `~` resolve to for a socket command?');
  // ---------------------------------------------------------------------------------------
  //
  // The tool layer emits absolute coordinates, so this is not on the critical path - but a
  // relative coordinate is worth having, and it is only worth having if `~` means the player
  // rather than the world origin. Nothing in the design says which.

  const target = await session.command('querytarget @s');
  let player = null;
  try {
    const details = JSON.parse(target.body?.details ?? '[]');
    const p = details[0]?.position;
    if (p) player = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  } catch {
    /* recorded below as null */
  }
  session.note('player_position', player);

  const work = player ? { x: player.x + 3, y: player.y, z: player.z + 3 } : { x: 0, y: 64, z: 0 };
  session.note('work_area', work);

  const relPlace = await session.command('setblock ~ ~-3 ~ minecraft:gold_block replace');
  session.note('relative_setblock', status(relPlace));
  if (player) {
    const check = await session.command(`testforblock ${player.x} ${player.y - 3} ${player.z} minecraft:gold_block`);
    // If `~` meant the player, the block is under the player and this finds it.
    session.note('tilde_is_player_position', accepted(check));
    session.note('tilde_check_message', status(check).message);
  }

  // ---------------------------------------------------------------------------------------
  log('phase 3: testforblock - does it name the block it found?');
  // ---------------------------------------------------------------------------------------
  //
  // The design note that said testforblock returns only a yes or no was wrong; a working
  // public implementation parses the block name out of statusMessage. This is where that
  // gets confirmed against this build and this client language, verbatim, because the string
  // is what a parser would have to match.

  await session.command(`setblock ${work.x} ${work.y} ${work.z} minecraft:diamond_block replace`);
  await session.wait(200);

  const hit = await session.command(`testforblock ${work.x} ${work.y} ${work.z} minecraft:diamond_block`);
  const miss = await session.command(`testforblock ${work.x} ${work.y} ${work.z} minecraft:stone`);

  session.note('testforblock_hit', status(hit));
  session.note('testforblock_miss', status(miss));

  // sanand0/minecraft-websocket parses the found block out of the failure message with this.
  // Whether it matches *this* build's string is the point of writing it down.
  const SANAND_REGEX = /is (.*?) \(expected:/;
  const missMessage = status(miss).message ?? '';
  const matched = SANAND_REGEX.exec(missMessage);
  session.note('testforblock_regex_matches', !!matched);
  session.note('testforblock_regex_capture', matched ? matched[1] : null);
  session.note('testforblock_message_is_localised', /[^\x00-\x7F]/.test(missMessage));

  // ---------------------------------------------------------------------------------------
  log('phase 4: gettopsolidblock');
  // ---------------------------------------------------------------------------------------

  const top = await session.command(`gettopsolidblock ${work.x} 320 ${work.z}`);
  session.note('gettopsolidblock', status(top));
  session.note('gettopsolidblock_body_keys', Object.keys(top.body ?? {}));
  session.note('gettopsolidblock_blockdata_present', top.body?.blockData !== undefined);

  // ---------------------------------------------------------------------------------------
  log('phase 5: getchunkdata - syntax probes');
  // ---------------------------------------------------------------------------------------
  //
  // Every one of these is a guess, which is why all of them are sent and all the refusals
  // recorded. If phase 1 turned up a usage string, that is the real answer and these are
  // just corroboration.

  const chunkProbes = [
    'getchunkdata',
    `getchunkdata ${work.x} ${work.z}`,
    `getchunkdata ${work.x >> 4} ${work.z >> 4}`,
    `getchunkdata ${work.x >> 4} ${work.z >> 4} 0`,
    `getchunkdata ${work.x >> 4} ${work.z >> 4} overworld`,
    `getchunkdata ${work.x} ${work.y} ${work.z}`,
    `getchunkdata ${work.x} ${work.y} ${work.z} 1 1 1`,
    'getchunks',
    'getchunks 0',
  ];
  const chunkResults = {};
  for (const probe of chunkProbes) {
    const reply = await session.command(probe, { timeout: 6000 });
    chunkResults[probe] = { ...status(reply), bodyKeys: Object.keys(reply.body ?? {}) };
  }
  session.note('getchunkdata_probes', chunkResults);
  session.note(
    'getchunkdata_any_accepted',
    Object.entries(chunkResults).filter(([, r]) => (r.code ?? -1) >= 0).map(([k]) => k)
  );

  // ---------------------------------------------------------------------------------------
  log('phase 6: the generated command corpus');
  // ---------------------------------------------------------------------------------------
  //
  // Answers the two loose ends in packages/server/src/commands: whether Bedrock's /setblock
  // and /fill take caret notation, and whether 32768 is really the fill limit here. A green
  // table says a string is well formed; only this says the game takes it.

  let corpus = { commands: [] };
  try {
    corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  } catch (error) {
    session.note('corpus_read_error', String(error.message));
  }

  const rejected = [];
  const corpusResults = {};
  for (const command of corpus.commands) {
    // The corpus is written around the origin; move it to the work area so it does not
    // rewrite spawn. Absolute coordinates only - relative and local forms are left as they
    // are, since where they land is exactly what is being tested.
    const reply = await session.command(command, { timeout: 6000 });
    const s = status(reply);
    corpusResults[command] = s;
    if (!accepted(reply)) rejected.push({ command, ...s });
  }
  session.note('corpus_total', corpus.commands.length);
  session.note('corpus_rejected', rejected);
  fs.writeFileSync(path.join(dump, 'corpus-results.json'), JSON.stringify(corpusResults, null, 2) + '\n', 'utf8');

  const caretResults = Object.entries(corpusResults).filter(([c]) => c.includes('^'));
  session.note('caret_accepted', caretResults.map(([c, s]) => ({ command: c, code: s.code, message: s.message })));

  // ---------------------------------------------------------------------------------------
  log('phase 7: the fill volume limit');
  // ---------------------------------------------------------------------------------------
  //
  // FILL_VOLUME_LIMIT is the one constant in the command builder with no citation - the wiki
  // documents 32768 for Java and says nothing for Bedrock. Two commands settle it.

  const { x, y, z } = work;
  const exactly = await session.command(`fill ${x} ${y} ${z} ${x + 31} ${y + 31} ${z + 31} minecraft:air replace`, { timeout: 15000 });
  session.note('fill_32768', status(exactly));

  const overBy = await session.command(`fill ${x} ${y} ${z} ${x + 31} ${y + 31} ${z + 32} minecraft:air replace`, { timeout: 15000 });
  session.note('fill_33792', status(overBy));
  session.note('fill_volume_limit_is_32768', accepted(exactly) && !accepted(overBy));

  // Binary search only if the guess was wrong - no point spending commands to confirm it.
  //
  // Searched with a 1x1xN column so the probe volume is exactly N. A cube would only ever
  // bracket the answer between two cubes, which is how the first version of this spun
  // forever: it searched on volume but could only step in cube-root increments, so `lo`
  // sometimes did not move.
  if (accepted(overBy)) {
    let lo = 1;
    let hi = 32768 * 64;
    for (let step = 0; step < 40 && lo + 1 < hi; step++) {
      const mid = Math.floor((lo + hi) / 2);
      const probe = await session.command(
        `fill ${x} ${y} ${z} ${x} ${y} ${z + mid - 1} minecraft:air replace`,
        { timeout: 20000 }
      );
      if (accepted(probe)) lo = mid;
      else hi = mid;
    }
    session.note('fill_volume_limit_measured', lo);
    session.note('fill_volume_limit_converged', lo + 1 === hi);
  }

  log('');
  log('done. Read verdicts.json for the answers and frames.jsonl for everything else.');
}
