// Drives the real MCP server against the real game.
//
//   node mcp-session.mjs [--port 19131] [--encryption]
//   → in the game:  /connect localhost:19131
//
// Every live check so far has gone through the runner, which builds the tools in its own
// process and calls their handlers directly. That exercises everything except the layer the
// user actually has: an MCP client, over stdio, talking to the server as a child process.
//
// This is that layer. The server is spawned exactly as an editor would spawn it, an MCP
// client connects to it, and the tools are called by name over the protocol. If a schema the
// SDK rejects, a result that fails output validation, or a handler that returns the wrong
// shape has slipped through, it fails here and nowhere else.
//
// Same working arrangement as runner.mjs: it holds the connection open and runs whichever
// scenario `active-scenario.txt` names, again whenever `rerun.txt` is touched. A live session
// is scarce - someone has to launch the game and type /connect - so nothing that can be
// changed without a reconnect should cost one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '../../packages/server/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import { StdioClientTransport } from '../../packages/server/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', '..', 'packages', 'server', 'dist', 'index.js');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const PORT = String(args.get('port') ?? 19131);
// The game and the server have to agree, and a mismatch is silent on both sides: /connect
// appears to work and nothing ever answers. Off by default because that is how this machine's
// game is set; pass --encryption true to match a stock one.
const ENCRYPTED = args.get('encryption') === 'true';
const DUMP_ROOT = path.join(HERE, 'dump');
const TRIGGER = path.join(HERE, 'rerun.txt');

const startedAt = Date.now();
const since = () => Date.now() - startedAt;
const log = (...parts) => console.log(`[${String(since()).padStart(6)}ms]`, ...parts);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const triggerStamp = () => {
  try {
    return fs.statSync(TRIGGER).mtimeMs;
  } catch {
    return 0;
  }
};

if (!fs.existsSync(SERVER)) {
  console.error(`The server is not built: ${SERVER}`);
  console.error('Run `npm run build` in packages/server first.');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER, '--port', PORT, ...(ENCRYPTED ? [] : ['--no-encryption', 'true'])],
  stderr: 'pipe',
});

const client = new Client({ name: 'live-probe', version: '0.0.0' });

console.log('');
console.log(`  the real MCP server, ${ENCRYPTED ? 'with' : 'without'} encryption, port ${PORT}`);
console.log('');
console.log(`      /connect localhost:${PORT}`);
console.log('');

await client.connect(transport);

// The server's own startup notice, which names the port and warns about encryption.
transport.stderr?.on('data', (chunk) => {
  for (const line of chunk.toString().split('\n')) if (line.trim()) log(`server: ${line.trim()}`);
});

const tools = (await client.listTools()).tools;
log(`${tools.length} tools registered: ${tools.map((t) => t.name).join(', ')}`);

/**
 * Calls a tool the way a model would, and unwraps the result.
 *
 * A tool error comes back as data rather than as an exception, so a scenario can report one
 * without dying on it - which matters here, because half of what is worth checking live is
 * what the failures say.
 */
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = result.content.map((block) => block.text ?? '').join(' ');
    return { ok: false, error: text };
  }
  return { ok: true, value: result.structuredContent };
}

// --- wait for the game --------------------------------------------------------------------
//
// By asking the server, not by watching the socket. bridge_status is the tool a person would
// use for this, so if it does not answer the question here it will not answer it for them.
log('waiting for the game...');
let status = null;
for (let attempt = 0; attempt < 600; attempt++) {
  const answer = await call('world.bridge_status');
  if (answer.ok && answer.value.connected) {
    status = answer.value;
    break;
  }
  if (attempt === 0 && answer.ok) log(`not yet: ${answer.value.advice}`);
  await sleep(2000);
}

if (!status) {
  log('nothing connected within twenty minutes. Giving up.');
  await client.close();
  process.exit(1);
}

console.log('');
log(`connected. add-on ${status.addonVersion}, ${status.players} player(s), tick ${status.tick}`);
if (!status.upToDate) {
  log(`OUT OF DATE - expected ${status.expectedVersion}`);
  log(status.advice);
} else {
  log(`up to date (${status.expectedVersion})`);
}
console.log('');

// --- run scenarios until the game goes away -------------------------------------------------
let runNumber = 0;
let lastTrigger = triggerStamp();

for (;;) {
  runNumber++;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dump = path.join(DUMP_ROOT, `${stamp}-mcp-r${runNumber}`);
  fs.mkdirSync(dump, { recursive: true });

  const name = fs.existsSync(path.join(HERE, 'active-scenario.txt'))
    ? fs.readFileSync(path.join(HERE, 'active-scenario.txt'), 'utf8').trim()
    : 'status';

  const notes = { addon: status };
  const note = (key, value) => {
    notes[key] = value;
    log(`  ${key} =`, typeof value === 'string' ? value : JSON.stringify(value));
  };

  log(`run ${runNumber}: ${name} -> ${path.basename(dump)}`);
  try {
    // Cache-busted, so a scenario can be edited while the game stays connected. Unlike the
    // rigs, a scenario imports nothing from the server - it goes through the MCP client - so
    // there is no module tree to go stale underneath it.
    const scenario = await import(
      `${pathToFileURL(path.join(HERE, 'mcp-scenarios', `${name}.mjs`)).href}?t=${Date.now()}`
    );
    await scenario.run({ call, note, log, dump, sleep });
  } catch (error) {
    log('scenario threw:', error.stack ?? error.message);
    notes.scenario_error = String(error.message ?? error);
  }

  fs.writeFileSync(path.join(dump, 'notes.json'), JSON.stringify(notes, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    path.join(dump, 'meta.json'),
    JSON.stringify({ scenario: name, port: PORT, run: runNumber, startedAt: stamp, via: 'mcp' }, null, 2) + '\n',
    'utf8'
  );

  console.log('');
  log(`run ${runNumber}: ${Object.keys(notes).length} answers -> ${path.join(dump, 'notes.json')}`);
  log('still connected. Touch rerun.txt to run again.');

  while (triggerStamp() === lastTrigger) await sleep(500);
  lastTrigger = triggerStamp();
}
