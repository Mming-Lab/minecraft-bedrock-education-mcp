// Does a known-working client work here?
//
//   node socketbe-check.mjs [--port 19131]
//
// Three sessions of raw frames produced the same result: /help answers, nothing else does,
// no pushed events. I had two explanations for that and neither was evidence - the second
// one, that Bedrock pauses a world whose window loses focus, is true of Bedrock but was
// never shown to be what happened here.
//
// The better instrument was already on the machine. socket-be is what the legacy server is
// built on, it is known to drive this game, and reading it turns up four things it does that
// my frames do not:
//
//   1. body.version is 42 (MinecraftCommandVersion.LocateStructureOutput), not 1.
//      There is a status code named CommandVersionMismatch, so the field is load-bearing.
//   2. body has no `origin` field at all. Mine sends {type: "player"}.
//   3. header has no `messageType`. Mine sends one.
//   4. it negotiates encryption on connect unless told not to.
//
// Rather than guess which of the four matters, this runs the real library. If it can place a
// block, the fault is in my frames and the diff above says where. If it cannot, the fault is
// outside the protocol - the world, its settings, or the window - and no amount of frame
// tuning would have helped.

import { Server, ServerEvent } from 'socket-be';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const PORT = Number(args.get('port') ?? 19131);
// Run it twice, once each way, because encryption is the one difference that could plausibly
// be required rather than merely different.
const NO_ENCRYPTION = args.get('no-encryption') === 'true';

const server = new Server({ port: PORT, disableEncryption: NO_ENCRYPTION });

const started = Date.now();
const log = (...parts) => console.log(`[${String(Date.now() - started).padStart(6)}ms]`, ...parts);

console.log('');
console.log(`  socket-be ${NO_ENCRYPTION ? 'without' : 'with'} encryption, port ${PORT}`);
console.log('');
console.log(`      /connect localhost:${PORT}`);
console.log('');

server.on(ServerEvent.Open, () => log('listening'));

server.on(ServerEvent.WorldAdd, async ({ world }) => {
  log('world connected');

  const results = {};
  const attempts = [
    ['say', 'say socket-be probe'],
    ['time_query', 'time query daytime'],
    ['list', 'list'],
    ['help', 'help 1'],
    ['setblock', 'setblock ~ ~-3 ~ minecraft:gold_block replace'],
  ];

  for (const [name, command] of attempts) {
    const startedAt = Date.now();
    try {
      // A timeout of its own, because the failure being investigated is silence: without one
      // this hangs on the first command exactly like every rig so far.
      const reply = await Promise.race([
        world.runCommand(command),
        new Promise((_, reject) => setTimeout(() => reject(new Error('no reply within 8s')), 8000)),
      ]);
      results[name] = { ok: true, ms: Date.now() - startedAt, statusCode: reply?.statusCode, statusMessage: reply?.statusMessage };
      log(`  ANSWERED  ${command}  -> ${JSON.stringify(reply?.statusMessage ?? reply?.statusCode)}`);
    } catch (error) {
      results[name] = { ok: false, ms: Date.now() - startedAt, error: String(error.message ?? error) };
      log(`  silent    ${command}  -> ${error.message}`);
    }
  }

  const answered = Object.values(results).filter((r) => r.ok).length;
  console.log('');
  if (answered === attempts.length) {
    log('socket-be got answers to everything. The fault is in my frames, and the diff at the');
    log('top of this file says where to look: version 42, no origin, no messageType.');
  } else if (answered === 0) {
    log('socket-be got nothing either - not even /help. That is different from the raw rigs,');
    log('which did get /help, so compare this run against those before concluding anything.');
  } else if (results.help?.ok && !results.setblock?.ok) {
    log('Same shape as the raw rigs: /help answers, the world does not. A known-working');
    log('client fails identically, so this is not the frame format. It is the world - its');
    log('settings, or the window having lost focus, which pauses a Bedrock single-player world.');
  } else {
    log(`${answered} of ${attempts.length} answered. See the table above.`);
  }
  console.log('');
  console.log(JSON.stringify(results, null, 2));
});

server.on(ServerEvent.Error, (error) => log('server error:', error?.message ?? error));
