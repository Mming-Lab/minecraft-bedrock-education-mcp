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
// Passed in rather than taken from the clock inside a rig, so a rig stays reproducible.
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
// The self-test writes somewhere else entirely. It used to share `dump/`, which meant that
// clearing the test output and destroying a live recording were the same command - and that
// is exactly how the first session's frames.jsonl was lost, by a `rm -rf dump` between two
// self-test runs. A recording that took a person launching the game to produce does not
// share a directory with something regenerated on every run.
const DUMP = path.join(HERE, args.get('dump-root') ?? 'dump', STAMP);

fs.mkdirSync(DUMP, { recursive: true });
const frameLog = fs.createWriteStream(path.join(DUMP, 'frames.jsonl'), { flags: 'a' });

const startedAt = Date.now();
const since = () => Date.now() - startedAt;

function record(direction, frame, extra = {}) {
  frameLog.write(JSON.stringify({ t: since(), direction, frame, ...extra }) + '\n');
}

function log(...parts) {
  console.log(`[${String(since()).padStart(6)}ms]`, ...parts);
}

// --- the session handed to a rig ---------------------------------------------------------

class Session {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    this.events = [];
    this.unmatched = [];
    /** Purposes this tool had no handling for. Empty is a claim; non-empty is a finding. */
    this.unknownPurposes = new Map();
    this.notes = {};
  }

  send(frame) {
    record('out', frame);
    this.socket.send(JSON.stringify(frame));
  }

  /**
   * Sends a command and resolves with the reply frame.
   *
   * Resolves rather than rejects on a command the game refuses: a refusal is data here, and
   * the rigs are mostly asking which commands get refused.
   */
  command(commandLine, { timeout = 8000 } = {}) {
    const requestId = randomUUID();
    const frame = {
      header: {
        version: 1,
        requestId,
        messagePurpose: 'commandRequest',
        messageType: 'commandRequest',
      },
      body: { origin: { type: 'player' }, commandLine, version: 1 },
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
        messageType: 'commandRequest',
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
        messageType: 'commandRequest',
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
console.log(`  dump: ${path.relative(process.cwd(), DUMP)}`);
console.log(`  rig:  ${RIG}`);
console.log('');
console.log('  In Minecraft Education, open the chat and type:');
console.log('');
console.log(`      /connect localhost:${PORT}`);
console.log('');
console.log('  Waiting for the game to connect. Ctrl-C to stop.');
console.log('');

wss.on('connection', async (socket) => {
  log('connected');
  const session = new Session(socket);

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

  socket.on('close', () => log('disconnected'));
  socket.on('error', (error) => log('socket error:', error.message));

  let rig;
  try {
    rig = await import(`./rigs/${RIG}.mjs`);
  } catch (error) {
    console.error(`\ncould not load rig \`${RIG}\`: ${error.message}\n`);
    process.exit(2);
  }

  try {
    await rig.run(session, { log, dump: DUMP });
  } catch (error) {
    log('rig threw:', error.stack ?? error.message);
    session.note('rig_error', String(error.message ?? error));
  }

  if (session.unknownPurposes.size) {
    log('message purposes this probe has no handling for:');
    for (const [purpose, count] of session.unknownPurposes) log(`   ${purpose} x${count}`);
    session.notes.unknown_purposes = Object.fromEntries(session.unknownPurposes);
  }

  fs.writeFileSync(
    path.join(DUMP, 'verdicts.json'),
    JSON.stringify(session.notes, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(DUMP, 'meta.json'),
    JSON.stringify(
      { rig: RIG, port: PORT, startedAt: STAMP, platform: process.platform, node: process.version },
      null,
      2
    ) + '\n',
    'utf8'
  );

  log('');
  log(`rig finished. ${Object.keys(session.notes).length} answers -> ${path.join(DUMP, 'verdicts.json')}`);
  log('frames.jsonl holds everything, including what the rig did not read.');
  frameLog.end(() => process.exit(0));
});

wss.on('error', (error) => {
  console.error(`\nserver error: ${error.message}`);
  if (error.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already taken - pass --port with another one.\n`);
  }
  process.exit(1);
});
