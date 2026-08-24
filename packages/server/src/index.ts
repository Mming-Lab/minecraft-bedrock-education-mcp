#!/usr/bin/env node
/**
 * Entry point. Speaks MCP over stdio, and listens for Minecraft on a WebSocket.
 *
 * stdio keeps the dependency surface small: the SDK's HTTP transports live in separate
 * packages (`@modelcontextprotocol/express`, `hono`, `fastify`), so not using them means
 * express and its dependency chain never enter the install at all.
 *
 * Nothing is written to stdout except protocol traffic — stdout *is* the transport. The
 * banner below therefore goes to stderr, where the editor or terminal running this will show
 * it. It matters that it is shown: the server cannot dial the game, the game has to dial the
 * server, and until someone types `/connect` in the chat every world tool has nothing to talk
 * to. A teacher who starts this and sees nothing has no way to know what is missing.
 *
 * There is one socket for the process even though `serveStdio` builds a server per client,
 * because there is one port and one game.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { BridgeClient, SocketBridgeTransport, DEFAULT_PORT } from './bridge/index.js';
import { createServer } from './server.js';

interface Options {
  port: number;
  host?: string;
  disableEncryption: boolean;
}

/**
 * Reads the handful of settings that have to match the machine.
 *
 * Both flags and environment variables, because an MCP client's config file makes one of the
 * two awkward depending on which client it is - `args` in some, `env` in others.
 */
function readOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      // A bare flag is `true`, so `--no-encryption` needs no argument.
      flags.set(arg.slice(2), next !== undefined && !next.startsWith('--') ? next : 'true');
    }
  }

  const port = Number(flags.get('port') ?? process.env['MINECRAFT_MCP_PORT'] ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port must be a port number, not ${JSON.stringify(String(port))}`);
  }

  const host = flags.get('host') ?? process.env['MINECRAFT_MCP_HOST'];
  const disableEncryption =
    (flags.get('no-encryption') ?? process.env['MINECRAFT_MCP_NO_ENCRYPTION'] ?? 'false') !== 'false';

  return { port, disableEncryption, ...(host === undefined ? {} : { host }) };
}

const options = readOptions(process.argv.slice(2));
const transport = new SocketBridgeTransport(options);
const bridge = new BridgeClient(transport);

void transport.listening.then(() => {
  const failure = transport.listenFailure;
  if (failure !== null) {
    // Not fatal. Everything under `build.*` computes shapes and emits commands without a
    // socket, so taking the process down over a busy port would remove capabilities that
    // never depended on it.
    process.stderr.write(
      `Could not listen on port ${options.port}: ${failure.message}\n` +
        `Another program is probably using it. Building tools still work; reading the world does not.\n` +
        `Start again with --port <another> to fix it.\n`
    );
    return;
  }

  const lines = [
    `Minecraft bridge listening on port ${transport.port}.`,
    `In the game, open the chat and run:  /connect localhost:${transport.port}`,
  ];
  if (!options.disableEncryption) {
    // The failure this avoids is silent on both sides: the game accepts the /connect and then
    // never becomes a command target, which looks exactly like a /connect nobody typed.
    lines.push(
      `Encryption is on. If the game is set to refuse it, /connect will appear to work and`,
      `nothing will answer — restart with --no-encryption.`
    );
  }
  process.stderr.write(`${lines.join('\n')}\n`);
});

// The same socket, in both of its roles: the bridge fires `scriptevent` and listens for the
// add-on's chat, while building runs `/fill` and reads the game's reply.
serveStdio(() => createServer({ bridge, runner: transport }));
