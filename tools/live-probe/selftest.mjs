// The probe's own test, against a stand-in for Minecraft.
//
//   node selftest.mjs
//
// A live session is a scarce thing: someone has to launch the game and type /connect, and a
// rig that crashes in its third phase has wasted all of it. This drives the probe with a
// fake client that speaks the frame shapes the real game is documented to speak, so the
// machinery - request matching, timeouts, the dump files - is known to work before anyone
// starts the game.
//
// It cannot tell us anything about Minecraft. That is the point of the distinction: this
// checks the recorder, and only a real session checks the recording.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 19141;
const DUMP_ROOT = 'dump-selftest';
const FAKE_FILL_LIMIT = 65536;

// What the fake pretends not to have. `gettopsolidblock` is deliberately NOT here: it stands
// for a command that is missing from /help but present in the build, which is the case the
// last run could not rule out and the classifier now has to get right.
const UNKNOWN_TO_FAKE = ['getchunkdata', 'getchunks', 'querytarget', 'agent', 'zzznotacommandatall', 'thiscommanddoesnotexist'];

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

/** Replies the way the game is documented to, including refusing an unknown command. */
/**
 * `silent` names the rung of the gate's ladder at which the fake stops answering.
 *
 * This is the only way to test the diagnosis, and the diagnosis is the part that matters:
 * getting it wrong sends someone to check the wrong thing and costs another whole session.
 */
function fakeMinecraft(url, { silent = 'none' } = {}) {
  const socket = new WebSocket(url);
  const seen = [];

  // Set once the fake sees the gamerule turned on, for the `feedback` mode below.
  let feedbackOn = false;

  const isSilent = (line) => {
    if (silent === 'all') return true;
    // The observed live behaviour: /help is answered from the client's command table, and
    // every other reply is command feedback - which `sendcommandfeedback false` suppresses.
    // The command that turns it back on is itself silent, which is what makes this state so
    // hard to read from the outside and why it needs its own test.
    if (silent === 'feedback') return !feedbackOn && !line.startsWith('help');
    if (silent === 'world') return !line.startsWith('help');
    // Cheats off: chat works, commands that change blocks do not.
    if (silent === 'privileged') return /^(setblock|fill|clone|structure|testforblock)/.test(line);
    return false;
  };

  socket.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    seen.push(frame);
    const { requestId, messagePurpose } = frame.header;

    if (messagePurpose === 'subscribe' || messagePurpose === 'unsubscribe') return;

    const line = frame.body?.commandLine ?? '';
    if (/^gamerule sendcommandfeedback true/.test(line)) feedbackOn = true;
    if (isSilent(line)) return;
    let body;

    // These two come first on purpose. They match bare command words, and every handler
    // below matches on a prefix - so ordered the other way round, `querytarget` with no
    // arguments would be answered by the querytarget handler and never reach the "unknown
    // command" branch it is here to exercise.
    if (UNKNOWN_TO_FAKE.includes(line)) {
      body = { statusCode: -2147483648, statusMessage: `不明なコマンド: ${line}。このコマンドが存在し、これを使用する権限があることを確認してください` };
    } else if (line === 'testforblock') {
      body = { statusCode: -2147483648, statusMessage: '構文エラー: 予期しない "": "testforblock >>"' };
    } else if (line.startsWith('help ')) {
      const page = Number(line.split(' ')[1]);
      // Three pages then repeats, so the rig's paging loop has something to terminate on.
      body = { statusCode: 0, statusMessage: page <= 3 ? `page ${page}: /fill /setblock /testforblock` : 'page 3: /fill /setblock /testforblock' };
    } else if (line.startsWith('querytarget')) {
      body = { statusCode: 0, details: JSON.stringify([{ position: { x: 10.5, y: 64.0, z: -20.5 } }]) };
    } else if (line.startsWith('testforblock')) {
      const wanted = line.trim().split(/\s+/)[4];
      body = wanted === 'minecraft:diamond_block'
        ? { statusCode: 0, statusMessage: 'Block found' }
        : { statusCode: -2147352576, statusMessage: 'The block at 13,64,-17 is diamond_block (expected: stone).' };
    } else if (line.startsWith('gettopsolidblock')) {
      body = { statusCode: 0, blockName: 'minecraft:grass_block', position: { x: 13, y: 63, z: -17 } };
    } else if (UNKNOWN_TO_FAKE.some((c) => line.startsWith(c + ' '))) {
      body = { statusCode: -2147483648, statusMessage: `不明なコマンド: ${line.split(' ')[0]}。このコマンドが存在し、これを使用する権限があることを確認してください` };
    } else if (line.startsWith('fill ')) {
      // A limit of 65536 rather than 32768, deliberately: it makes the rig's guess wrong, so
      // the binary search actually runs here instead of being skipped. The first version of
      // that search never terminated, and a fake that agreed with the guess would not have
      // shown it.
      const n = line.split(/\s+/).slice(1, 7).map(Number);
      const volume = (Math.abs(n[3] - n[0]) + 1) * (Math.abs(n[4] - n[1]) + 1) * (Math.abs(n[5] - n[2]) + 1);
      body = volume > FAKE_FILL_LIMIT
        ? { statusCode: -2147483648, statusMessage: `Too many blocks in the specified area (maximum ${FAKE_FILL_LIMIT})` }
        : { statusCode: 0, statusMessage: `ok: ${line}` };
    } else {
      body = { statusCode: 0, statusMessage: `ok: ${line}` };
    }

    socket.send(JSON.stringify({
      header: { version: 1, requestId, messagePurpose: 'commandResponse', messageType: 'commandResponse' },
      body,
    }));
  });

  return { socket, seen };
}

async function runRig(rig, fakeOptions = {}) {
  const probe = spawn(process.execPath, [path.join(HERE, 'probe.mjs'), '--port', String(PORT), '--rig', rig, '--dump-root', DUMP_ROOT, '--once', 'true'], {
    cwd: HERE,
    stdio: ['ignore', 'pipe', 'pipe'],
    // The ladder rig waits for a person to move around in a world; nobody is here.
    env: { ...process.env, PROBE_EVENT_WAIT: '300' },
  });

  let output = '';
  probe.stdout.on('data', (d) => (output += d.toString()));
  probe.stderr.on('data', (d) => (output += d.toString()));

  // Wait for the listening line rather than a fixed sleep, so a slow start does not flake.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`probe did not start:\n${output}`)), 10000);
    const poll = setInterval(() => {
      if (output.includes('listening on port')) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
  });

  const client = fakeMinecraft(`ws://127.0.0.1:${PORT}`, fakeOptions);
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      probe.kill();
      reject(new Error(`rig ${rig} did not finish in time:\n${output}`));
    }, 60000);
    probe.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  client.socket.close();

  const dumps = fs.readdirSync(path.join(HERE, DUMP_ROOT)).sort();
  const latest = path.join(HERE, DUMP_ROOT, dumps[dumps.length - 1]);
  return {
    exitCode,
    output,
    dir: latest,
    verdicts: JSON.parse(fs.readFileSync(path.join(latest, 'verdicts.json'), 'utf8')),
    frames: fs.readFileSync(path.join(latest, 'frames.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)),
    sent: client.seen,
  };
}

console.log('live-probe self-test\n');

const a0 = await runRig('a0-connect');

check('the rig runs to completion', () => {
  assert.equal(a0.exitCode, 0, a0.output);
});

check('every frame is recorded in both directions', () => {
  const out = a0.frames.filter((f) => f.direction === 'out').length;
  const inbound = a0.frames.filter((f) => f.direction === 'in').length;
  assert.ok(out > 0, 'nothing was recorded going out');
  assert.ok(inbound > 0, 'nothing was recorded coming in');
});

check('a reply is matched to its request rather than to the next one in line', () => {
  // The failure this guards against is silent: with mismatched replies every answer is
  // still plausible, just attached to the wrong question.
  assert.equal(a0.verdicts.round_trip_ok, true);
  assert.equal(a0.verdicts.reply_status_message, 'ok: say probe connected');
  assert.equal(a0.verdicts.refusal_status_code, -2147483648);
  // The fake answers in Japanese, as the live client does. Asserting on an English string
  // would pass here and tell us nothing about the session that matters.
  assert.match(a0.verdicts.refusal_status_message, /不明なコマンド/);
});

check('the command that fails is recorded as a refusal, not as a timeout', () => {
  assert.notEqual(a0.verdicts.refusal_status_code, null);
});

check('querytarget details are read back', () => {
  assert.equal(a0.verdicts.querytarget_status, 0);
  assert.match(a0.verdicts.querytarget_details, /position/);
});

check('the raw frames outlive the interpretation', () => {
  const raw = a0.frames.find((f) => f.frame?.body?.commandLine === 'thiscommanddoesnotexist');
  assert.ok(raw, 'the refused command is missing from frames.jsonl');
});

const a1 = await runRig('a1-core');

check('the long rig also runs to completion', () => {
  assert.equal(a1.exitCode, 0, a1.output);
});

check('paging stops when the game starts repeating itself', () => {
  // Left unbounded this walks to 60 pages of identical text and calls it data.
  assert.equal(a1.verdicts.help_pages, 3);
});

check('the block name is parsed out of the testforblock message', () => {
  assert.equal(a1.verdicts.testforblock_regex_matches, true);
  assert.equal(a1.verdicts.testforblock_regex_capture, 'diamond_block');
});

check('a syntax probe that is refused is recorded as refused', () => {
  assert.deepEqual(a1.verdicts.getchunkdata_any_accepted, []);
  assert.ok(Object.keys(a1.verdicts.getchunkdata_probes).length >= 8);
});

check('the whole generated corpus is replayed', () => {
  const corpus = JSON.parse(
    fs.readFileSync(path.join(HERE, '..', '..', 'tests', 'golden', 'commands', 'corpus.json'), 'utf8')
  );
  assert.equal(a1.verdicts.corpus_total, corpus.commands.length);
  const results = JSON.parse(fs.readFileSync(path.join(a1.dir, 'corpus-results.json'), 'utf8'));
  assert.equal(Object.keys(results).length, corpus.commands.length);
});

check('caret commands are pulled out for their own answer', () => {
  assert.ok(Array.isArray(a1.verdicts.caret_accepted));
  assert.ok(a1.verdicts.caret_accepted.length >= 1, 'the corpus should contain a caret command');
});

check('the volume search terminates and finds the limit the fake enforces', () => {
  // This is the check that exists because the search did not terminate. The fake refuses
  // above 65536; the rig must land on exactly that, from a starting guess of 32768.
  assert.equal(a1.verdicts.fill_volume_limit_is_32768, false, 'the fake accepts 33792, so the guess must read as wrong');
  assert.equal(a1.verdicts.fill_volume_limit_converged, true, 'the search ran out of steps instead of converging');
  assert.equal(a1.verdicts.fill_volume_limit_measured, FAKE_FILL_LIMIT);
});

check('a rig that throws still writes what it had', () => {
  // Nothing here throws, so this asserts the weaker thing the code guarantees: the files are
  // written after the rig returns, whatever it returned.
  assert.ok(fs.existsSync(path.join(a1.dir, 'verdicts.json')));
  assert.ok(fs.existsSync(path.join(a1.dir, 'help.txt')));
});

// --- the gate ---------------------------------------------------------------------------
//
// a1-core's first live run spent four minutes collecting 34 timeouts, which between them
// carried one bit of information. a2-world stops after three commands and says which of
// three different things a person should go and check. Each branch is tested, because a
// diagnosis that names the wrong cause is worse than none.

const suppressed = await runRig('a2-world', { silent: 'feedback' });

check('command feedback being off is detected and turned back on', () => {
  // The live case, twice over: /help answers, nothing else does. The gate has to recognise
  // that shape, send the gamerule without waiting for a reply it will not get, and carry on.
  assert.equal(suppressed.verdicts.sendcommandfeedback_was_off, true);
  assert.equal(suppressed.verdicts.world_responds, true, JSON.stringify(suppressed.verdicts.diagnosis));
});

check('once feedback is on the rest of the rig runs', () => {
  assert.ok(suppressed.verdicts.corpus_total > 0, 'the rig stopped instead of continuing');
});

const stuck = await runRig('a2-world', { silent: 'world' });

check('feedback that stays off after the gamerule is not called a paused world', () => {
  // The earlier gate guessed "paused" here on a theory about `list` that turned out to be
  // wrong. Now it says what it knows - the gamerule did not help - and names what a person
  // can actually check in the game.
  assert.equal(stuck.verdicts.world_responds, false);
  assert.match(stuck.verdicts.diagnosis, /sendcommandfeedback/);
  assert.match(stuck.verdicts.diagnosis, /operator|cheats/);
});

check('the gate stops instead of running the rest of the rig', () => {
  // The whole point: no corpus replay, no fill search, no four minutes of timeouts.
  assert.equal(stuck.verdicts.corpus_total, undefined);
  assert.ok(stuck.verdicts.fill_32768 === undefined);
});

const noPermission = await runRig('a2-world', { silent: 'privileged' });

check('a live world that refuses block commands is diagnosed as permission', () => {
  assert.equal(noPermission.verdicts.world_responds, false);
  assert.match(noPermission.verdicts.diagnosis, /permission/);
  assert.match(noPermission.verdicts.diagnosis, /cheats|operator/);
});

const deaf = await runRig('a2-world', { silent: 'all' });

check('a socket that answers nothing is not blamed on the world', () => {
  // /help is the control. If even that is silent, the fault is upstream of anything the
  // world could be doing, and the diagnosis must not send someone to check gamerules.
  assert.equal(deaf.verdicts.world_responds, false);
  assert.match(deaf.verdicts.diagnosis, /`help` does not answer either/);
  assert.doesNotMatch(deaf.verdicts.diagnosis, /sendcommandfeedback/);
});

const healthy = await runRig('a2-world');

check('a healthy world runs the whole rig', () => {
  assert.equal(healthy.verdicts.world_responds, true);
  assert.equal(healthy.verdicts.corpus_total, JSON.parse(
    fs.readFileSync(path.join(HERE, '..', '..', 'tests', 'golden', 'commands', 'corpus.json'), 'utf8')
  ).commands.length);
});

check('a command missing from /help but present in the build is not called absent', () => {
  // The whole reason this probe was rewritten. The fake answers `gettopsolidblock` normally
  // while refusing `getchunkdata` as unknown; the classifier has to split them, because
  // "not in /help" covers absent, hidden, and unpermitted alike.
  const existence = healthy.verdicts.command_existence;
  assert.equal(healthy.verdicts.controls_differ, true, 'the controls fail identically, so nothing can be classified');
  assert.match(existence.gettopsolidblock.verdict, /accepted|present/);
  assert.match(existence.getchunkdata.verdict, /absent/);
  assert.match(existence.querytarget.verdict, /absent/);
});

check('when the controls fail identically nothing is classified', () => {
  // A guard on the guard. If the two controls ever produce the same message, a verdict of
  // "absent" would be manufactured rather than measured.
  const existence = healthy.verdicts.command_existence;
  for (const [name, r] of Object.entries(existence)) {
    if (r.verdict.startsWith('undecidable')) {
      assert.equal(healthy.verdicts.controls_differ, false, `${name} was called undecidable while the controls did differ`);
    }
  }
});

check('absolute corpus coordinates are moved next to the player before being sent', () => {
  // Sent at the origin they would land in an unloaded chunk, and a chunk error would read
  // as a syntax rejection.
  const results = JSON.parse(fs.readFileSync(path.join(healthy.dir, 'corpus-results.json'), 'utf8'));
  const absolute = results['setblock 0 64 0 minecraft:stone replace'];
  assert.ok(absolute, 'the corpus entry is missing');
  assert.match(absolute.sent, /^setblock ~ ~64 ~ /);
});

check('relative and local corpus commands are sent unchanged', () => {
  const results = JSON.parse(fs.readFileSync(path.join(healthy.dir, 'corpus-results.json'), 'utf8'));
  assert.equal(results['setblock ^ ^ ^5 minecraft:stone replace'].sent, 'setblock ^ ^ ^5 minecraft:stone replace');
  assert.equal(results['setblock ~ ~ ~ minecraft:stone replace'].sent, 'setblock ~ ~ ~ minecraft:stone replace');
});

// --- the ladder -------------------------------------------------------------------------

const ladder = await runRig('a3-ladder');

check('the ladder records every rung, answered or not', () => {
  assert.equal(ladder.exitCode, 0, ladder.output);
  assert.equal(Object.keys(ladder.verdicts.ladder).length, 16);
  assert.equal(ladder.verdicts.ladder_silent.length, 0, 'the fake answers everything');
});

check('the ladder tries more than one origin type', () => {
  // Every public implementation sends origin.type "player". If this build wants something
  // else, no amount of checking world settings would ever have found it.
  assert.deepEqual(Object.keys(ladder.verdicts.origin_types), ['player', 'server', 'automationPlayer', 'commandBlock']);
});

check('the reading states what was measured and not a cause', () => {
  assert.match(ladder.verdicts.reading, /Everything answered/);
  assert.doesNotMatch(ladder.verdicts.reading, /sendcommandfeedback|paused/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
