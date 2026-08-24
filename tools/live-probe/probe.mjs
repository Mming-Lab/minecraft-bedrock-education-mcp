// Records what Minecraft actually sends.
//
//   node probe.mjs [--port 19131] [--rig a0-connect]
//
// then, in the game's chat:  /connect localhost:19131
//
// Every frame in either direction is written to dump/<timestamp>/frames.jsonl before
// anything interprets it. That ordering is the whole point: the primary record is what came
// over the wire, not what this tool made of it, so a wrong reading here can be corrected
// later without replaying the session.
//
// It exists because socket-be, which the legacy server is built on, drops frames whose
// purpose it does not recognise - `action:agent` among them - and prints `[Network] Invalid
// message purpose:` to stderr. Its author concluded from the resulting silence that the
// agent inspection commands "do not return any data". This tool holds on to everything, so
// that conclusion can be checked rather than inherited.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const PORT = Number(args.get('port') ?? 19131);
const RIG = args.get('rig') ?? 'a0-connect';
// The self-test writes somewhere else entirely. It used to share `dump/`, which meant that
// clearing the test output and destroying a live recording were the same command - and that
// is exactly how the first session's frames.jsonl was lost, by a `rm -rf dump` between two
// self-test runs. A recording that took a person launching the game to produce does not
// share a directory with something regenerated on every run.
const DUMP_ROOT = path.join(HERE, args.get('dump-root') ?? 'dump');
// The self-test needs the process to end so it can read the files; a person at a keyboard
// needs the opposite.
const ONCE = args.get('once') === 'true';

/**
 * The command grammar generation to ask for, matching socket-be's default.
 *
 * socket-be sends `MinecraftCommandVersion.LocateStructureOutput`, which is 42, and there is
 * a status code named CommandVersionMismatch, so the field means something. The documented
 * examples all say 1, which is `Initial`; that is what this probe sent for its first three
 * sessions. Running socket-be against the same world showed the frame format was not what
 * was breaking those sessions - the world was paused - but there is no reason to keep asking
 * for the 2016 grammar when the working client asks for the current one.
 */
const COMMAND_VERSION = 42;

const startedAt = Date.now();
const since = () => Date.now() - startedAt;

function log(...parts) {
  console.log(`[${String(since()).padStart(6)}ms]`, ...parts);
}

// --- the session handed to a rig ---------------------------------------------------------

class Session {
  constructor(socket, record) {
    this.socket = socket;
    this.record = record;
    this.pending = new Map();
    this.events = [];
    this.unmatched = [];
    /** Purposes this tool had no handling for. Empty is a claim; non-empty is a finding. */
    this.unknownPurposes = new Map();
    this.notes = {};
  }

  send(frame) {
    this.record('out', frame);
    this.socket.send(JSON.stringify(frame));
  }

  /**
   * Sends a command and resolves with the reply frame.
   *
   * Resolves rather than rejects on a command the game refuses: a refusal is data here, and
   * the rigs are mostly asking which commands get refused.
   */
  command(commandLine, { timeout = 8000, commandVersion = COMMAND_VERSION } = {}) {
    const requestId = randomUUID();
    const frame = {
      header: {
        version: 1,
        requestId,
        messagePurpose: 'commandRequest',
      },
      body: { commandLine, version: commandVersion },
    };

    return new Promise((resolve) => {
      const sentAt = Date.now();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ timedOut: true, commandLine, rtt: Date.now() - sentAt });
      }, timeout);

      this.pending.set(requestId, (reply) => {
        clearTimeout(timer);
        resolve({ ...reply, commandLine, rtt: Date.now() - sentAt });
      });
      this.send(frame);
    });
  }

  /** A frame this tool builds no envelope for - for probing purposes nobody has documented. */
  raw(messagePurpose, body, { timeout = 8000, messageType = 'commandRequest' } = {}) {
    const requestId = randomUUID();
    const frame = { header: { version: 1, requestId, messagePurpose, messageType }, body };
    return new Promise((resolve) => {
      const sentAt = Date.now();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ timedOut: true, messagePurpose, rtt: Date.now() - sentAt });
      }, timeout);
      this.pending.set(requestId, (reply) => {
        clearTimeout(timer);
        resolve({ ...reply, messagePurpose, rtt: Date.now() - sentAt });
      });
      this.send(frame);
    });
  }

  subscribe(eventName) {
    this.send({
      header: {
        version: 1,
        requestId: randomUUID(),
        messagePurpose: 'subscribe',
      },
      body: { eventName },
    });
  }

  unsubscribe(eventName) {
    this.send({
      header: {
        version: 1,
        requestId: randomUUID(),
        messagePurpose: 'unsubscribe',
      },
      body: { eventName },
    });
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Records an answer the rig arrived at. `null` means asked but not settled. */
  note(key, value) {
    this.notes[key] = value;
    log(`  ${key} =`, typeof value === 'string' ? value : JSON.stringify(value));
  }

  handle(frame) {
    const purpose = frame?.header?.messagePurpose;
    const requestId = frame?.header?.requestId;

    if (requestId && this.pending.has(requestId)) {
      const resolve = this.pending.get(requestId);
      this.pending.delete(requestId);
      resolve(frame);
      return;
    }

    switch (purpose) {
      case 'event':
        this.events.push(frame);
        break;
      case 'error':
        this.unmatched.push(frame);
        break;
      default:
        this.unknownPurposes.set(purpose, (this.unknownPurposes.get(purpose) ?? 0) + 1);
        this.unmatched.push(frame);
    }
  }
}

// --- server -----------------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });

console.log('');
console.log(`  listening on port ${PORT}`);
console.log(`  dumps: ${path.relative(process.cwd(), DUMP_ROOT)}`);
console.log(`  rig:   ${RIG}`);
console.log('');
console.log('  In Minecraft Education, open the chat and type:');
console.log('');
console.log(`      /connect localhost:${PORT}`);
console.log('');
console.log(ONCE ? '  Waiting for one connection.' : '  Waiting. Reconnect as often as you like; Ctrl-C to stop.');
console.log('');

// Each connection is its own recording, and the server outlives all of them.
//
// It used to run the rig on the first connection and exit. That made one bad attempt - a
// port scan, a stray client, a /connect from a world that turned out to be paused - cost the
// whole session, with the person at the keyboard having to ask for the server to be started
// again. Reconnecting is now free, and an attempt that fails leaves a dump saying how.
let sessionCount = 0;

wss.on('connection', async (socket) => {
  const n = ++sessionCount;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dump = path.join(DUMP_ROOT, `${stamp}-${String(n).padStart(2, '0')}`);
  fs.mkdirSync(dump, { recursive: true });
  const frameLog = fs.createWriteStream(path.join(dump, 'frames.jsonl'), { flags: 'a' });
  const record = (direction, frame, extra = {}) => {
    frameLog.write(JSON.stringify({ t: since(), direction, frame, ...extra }) + '\n');
  };

  log(`connection ${n} from ${socket._socket?.remoteAddress ?? 'unknown'} -> ${path.basename(dump)}`);
  const session = new Session(socket, record);

  socket.on('message', (data) => {
    const text = data.toString();
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      // Not JSON at all is itself worth keeping, verbatim.
      record('in', null, { raw: text, parseError: true });
      return;
    }
    record('in', frame);
    session.handle(frame);
  });

  socket.on('close', () => log(`connection ${n} closed`));
  socket.on('error', (error) => log(`connection ${n} socket error:`, error.message));

  // Which rig, and its current contents, are both decided at connection time.
  //
  // Restarting the probe to change rigs is what stranded the game once already: Minecraft
  // stays attached to a socket that has gone away, and a later /connect is ignored with no
  // message, so the fix is a `/connect out` that nobody knows to type. Now the file is
  // re-read on every connection and the name comes from active-rig.txt if it exists, so a
  // rig can be edited or swapped while the game stays connected to the same server.
  // An explicit --rig wins. active-rig.txt is the convenience for a server left running
  // while rigs are edited; letting it override the flag meant the self-test asked for three
  // different rigs and silently ran the same one three times, which showed up as six
  // unrelated-looking failures.
  const rigFile = path.join(HERE, 'active-rig.txt');
  const rigName = args.has('rig')
    ? RIG
    : fs.existsSync(rigFile)
      ? fs.readFileSync(rigFile, 'utf8').trim()
      : RIG;

  let rig;
  try {
    // The query string defeats the module cache; without it the first version loaded would
    // be the only version ever run.
    rig = await import(`./rigs/${rigName}.mjs?t=${Date.now()}`);
  } catch (error) {
    log(`could not load rig \`${rigName}\`: ${error.message}`);
    session.note('rig_load_error', String(error.message));
    fs.writeFileSync(path.join(dump, 'verdicts.json'), JSON.stringify(session.notes, null, 2) + '\n', 'utf8');
    return;
  }
  if (rigName !== RIG) log(`rig: ${rigName} (from active-rig.txt)`);

  try {
    await rig.run(session, { log, dump });
  } catch (error) {
    log('rig threw:', error.stack ?? error.message);
    session.note('rig_error', String(error.message ?? error));
  }

  if (session.unknownPurposes.size) {
    log('message purposes this probe has no handling for:');
    for (const [purpose, count] of session.unknownPurposes) log(`   ${purpose} x${count}`);
    session.notes.unknown_purposes = Object.fromEntries(session.unknownPurposes);
  }

  fs.writeFileSync(path.join(dump, 'verdicts.json'), JSON.stringify(session.notes, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    path.join(dump, 'meta.json'),
    JSON.stringify(
      { rig: RIG, port: PORT, connection: n, startedAt: stamp, platform: process.platform, node: process.version },
      null,
      2
    ) + '\n',
    'utf8'
  );

  log('');
  log(`connection ${n}: ${Object.keys(session.notes).length} answers -> ${path.join(dump, 'verdicts.json')}`);
  if (ONCE) {
    frameLog.end(() => process.exit(0));
  } else {
    frameLog.end();
    log('still listening. /connect again to run the rig again.');
  }
});

wss.on('error', (error) => {
  console.error(`\nserver error: ${error.message}`);
  if (error.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already taken - pass --port with another one.\n`);
  }
  process.exit(1);
});
