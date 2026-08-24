// Runs a rig over socket-be instead of over hand-built frames.
//
//   node runner.mjs [--port 19131] [--rig a4-focus]
//
// then, in the game's chat:  /connect localhost:19131
//
// probe.mjs sends a command the moment the socket opens. socket-be does three things first:
// it asks for encryption (ECDH, then AES-256-CFB8 over every later frame), waits for the
// game's reply, subscribes to its events, and only then treats the world as connected. The
// game appears to want that exchange before it will act as a command target - which fits
// every session so far, because /help is answered by the client and needs no such thing
// while everything that reaches the game server was silent.
//
// Reimplementing the handshake would be a day of work to arrive at a library that is already
// installed and already known to drive this exact world - it placed a gold block here an hour
// ago. So the rigs move on top of it. The adapter below presents the same `session` a rig
// already expects, so `_battery.mjs` runs unchanged.
//
// What is given up is probe.mjs's raw frame log, since the frames are encrypted past the
// handshake. Every request and its reply are still recorded, which is what the rigs read.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, ServerEvent } from 'socket-be';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const PORT = Number(args.get('port') ?? 19131);
const RIG = args.get('rig') ?? 'a4-focus';
const DUMP_ROOT = path.join(HERE, args.get('dump-root') ?? 'dump');
const ONCE = args.get('once') === 'true';
const TRIGGER = path.join(HERE, 'rerun.txt');

const startedAt = Date.now();
const since = () => Date.now() - startedAt;
const log = (...parts) => console.log(`[${String(since()).padStart(6)}ms]`, ...parts);

const triggerStamp = () => {
  try {
    return fs.statSync(TRIGGER).mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * The interface a rig expects, backed by socket-be.
 *
 * `command` resolves rather than rejects on a refusal, and reports a timeout as data, both
 * because the rigs are largely asking which commands get refused and because a hang is the
 * failure mode being investigated.
 */
function makeSession(world, transcript) {
  return {
    notes: {},

    async command(commandLine, { timeout = 8000 } = {}) {
      const sentAt = Date.now();
      try {
        const body = await Promise.race([
          world.runCommand(commandLine),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
        ]);
        const reply = { body, commandLine, rtt: Date.now() - sentAt };
        transcript.push({ t: since(), commandLine, rtt: reply.rtt, body });
        return reply;
      } catch (error) {
        const timedOut = String(error.message) === 'timeout';
        transcript.push({ t: since(), commandLine, rtt: Date.now() - sentAt, timedOut, error: String(error.message) });
        // socket-be throws on a refused command in some paths; that is a reply, not a hang.
        if (!timedOut) {
          return { body: { statusCode: -1, statusMessage: String(error.message) }, commandLine, rtt: Date.now() - sentAt };
        }
        return { timedOut: true, commandLine, rtt: Date.now() - sentAt };
      }
    },

    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    note(key, value) {
      this.notes[key] = value;
      log(`  ${key} =`, typeof value === 'string' ? value : JSON.stringify(value));
    },

    events: [],
    subscribe() {
      // socket-be subscribes to what it needs on connect; a rig asking again is a no-op.
    },
  };
}

// socket-be asks for encryption on connect unless told not to. Which side to match is not a
// preference: if the game is set to refuse encrypted sessions the handshake hangs, and if it
// requires them an unencrypted connection never becomes a command target. The flag exists so
// the runner can be pointed at whichever the game is currently set to, rather than one of
// them being baked in and rediscovered as a mystery silence.
const NO_ENCRYPTION = args.get('no-encryption') === 'true';
const server = new Server({ port: PORT, disableEncryption: NO_ENCRYPTION });

console.log('');
console.log(`  socket-be runner on port ${PORT}`);
console.log(`  dumps: ${path.relative(process.cwd(), DUMP_ROOT)}`);
console.log(`  rig:   ${RIG}`);
console.log('');
console.log(`      /connect localhost:${PORT}`);
console.log('');

// Everything the game sends, including what socket-be throws away.
//
// socket-be checks `messagePurpose` against a list and drops anything not on it, printing
// `[Network] Invalid message purpose:`. `action:agent` is not on that list, which is why its
// author concluded the agent inspection commands return no data - the data may well have
// arrived and been discarded before any handler saw it. That is the one thing this runner
// would otherwise inherit from the library it is built on.
//
// A second listener on the same socket sees the frames first-hand. It only works because
// encryption is off; with it on these would be ciphertext and this would have to go through
// socket-be's own decryption.
const rawFrames = [];
server.network.wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const text = data.toString();
    try {
      rawFrames.push({ t: since(), frame: JSON.parse(text) });
    } catch {
      rawFrames.push({ t: since(), raw: text, parseError: true });
    }
  });
});

server.on(ServerEvent.Open, () => log('listening'));
server.on(ServerEvent.Error, (error) => log('server error:', error?.message ?? error));

let worldCount = 0;

server.on(ServerEvent.WorldAdd, async ({ world }) => {
  const n = ++worldCount;
  log(`world ${n} connected and past the handshake`);

  let open = true;
  server.on(ServerEvent.WorldRemove, () => {
    open = false;
    log(`world ${n} disconnected`);
  });

  let runNumber = 0;
  let lastTrigger = triggerStamp();

  while (open) {
    runNumber++;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dump = path.join(DUMP_ROOT, `${stamp}-w${n}-r${runNumber}`);
    fs.mkdirSync(dump, { recursive: true });

    const transcript = [];
    const session = makeSession(world, transcript);
    const rawFrom = rawFrames.length;
    log(`run ${runNumber} -> ${path.basename(dump)}`);

    const rigName = args.has('rig')
      ? RIG
      : fs.existsSync(path.join(HERE, 'active-rig.txt'))
        ? fs.readFileSync(path.join(HERE, 'active-rig.txt'), 'utf8').trim()
        : RIG;

    try {
      // Cache-busted so a rig can be edited while the game stays connected - which matters
      // more here than usual, because this connection cannot be replaced on demand:
      // `/connect out` does not close it.
      const rig = await import(`./rigs/${rigName}.mjs?t=${Date.now()}`);
      await rig.run(session, { log, dump });
    } catch (error) {
      log('rig threw:', error.stack ?? error.message);
      session.notes.rig_error = String(error.message ?? error);
    }

    fs.writeFileSync(path.join(dump, 'verdicts.json'), JSON.stringify(session.notes, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(dump, 'transcript.json'), JSON.stringify(transcript, null, 2) + '\n', 'utf8');

    // The frames from this run, and separately the ones socket-be would have dropped - which
    // is the whole reason the second listener exists, so it is worth not having to grep for.
    const mine = rawFrames.slice(rawFrom);
    const KNOWN = new Set(['commandResponse', 'event', 'error', 'ws:encrypt', 'commandRequest', 'subscribe', 'unsubscribe']);
    const unknown = mine.filter((f) => f.frame && !KNOWN.has(f.frame.header?.messagePurpose));
    fs.writeFileSync(path.join(dump, 'raw-frames.jsonl'), mine.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8');
    if (unknown.length) {
      fs.writeFileSync(path.join(dump, 'unrecognised-frames.json'), JSON.stringify(unknown, null, 2) + '\n', 'utf8');
      log(`${unknown.length} frames with a purpose socket-be does not handle -> unrecognised-frames.json`);
      for (const p of new Set(unknown.map((f) => f.frame.header?.messagePurpose))) log(`   ${p}`);
    }
    fs.writeFileSync(
      path.join(dump, 'meta.json'),
      JSON.stringify({ rig: rigName, port: PORT, world: n, run: runNumber, startedAt: stamp, transport: 'socket-be' }, null, 2) + '\n',
      'utf8'
    );

    log('');
    log(`world ${n} run ${runNumber}: ${Object.keys(session.notes).length} answers -> ${path.join(dump, 'verdicts.json')}`);

    if (ONCE) process.exit(0);

    log(`still connected. Touch rerun.txt to run again.`);
    while (open && triggerStamp() === lastTrigger) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    lastTrigger = triggerStamp();
  }
});
