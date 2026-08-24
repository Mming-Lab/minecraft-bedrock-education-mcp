// The transport, against a fake Minecraft over a real socket.
//
//   node test/transport.test.mjs
//
// The game is replaced, the socket is not. That split is deliberate: the bug this file exists
// to catch lives in the WebSocket handshake, not above it. socket-be decides which events to
// subscribe to from the handlers registered when a connection arrives, so a transport that
// registers `PlayerMessage` a moment too late never hears chat - and never says so. The
// symptom is silence, which is indistinguishable from an add-on that failed to load. A
// session was lost to that reading.
//
// So the fake below is a WebSocket client speaking Bedrock's frames, and the assertion is on
// the `subscribe` frame it receives: no game, no add-on, but the same handshake.
//
// The frame shapes are taken from a recorded session (tools/live-probe/dump), including the
// detail that a `tell` arrives with no `[name]` prefix while a `say` arrives with one.

import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { BridgeClient } from '../dist/bridge/client.js';
import { BridgeTransportError, SocketBridgeTransport } from '../dist/bridge/transport.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((error) => {
      failed++;
      console.log(`  FAIL ${name}`);
      console.log(`       ${(error.stack ?? error.message).split('\n').slice(0, 4).join('\n       ')}`);
    });
}

const PLAYER = 'Kai_U';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A WebSocket client that answers like Bedrock does.
 *
 * It records the `subscribe` frames it is sent, answers `commandRequest` with a
 * `commandResponse` carrying the same `requestId`, and can push `PlayerMessage` events - which
 * is how a script inside the game speaks, since chat is the only path back to the socket.
 *
 * `addon` stands in for the pack: given a command line it returns the lines the pack would
 * say. Returning fewer lines than the header promises is how a dropped chat line is
 * simulated, and that is the failure that has to stay visible.
 */
class FakeGame {
  constructor(ws) {
    this.ws = ws;
    this.subscribed = [];
    this.commands = [];
    this.addon = () => [];
  }

  static async connect(port) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const game = new FakeGame(ws);
    // Before the open handshake resolves, not after. The server subscribes the moment the
    // connection lands, and `ws` drops a message that arrives with no listener attached - so
    // waiting for `open` first loses exactly the frames this file exists to check. The same
    // ordering mistake as the one being tested for, one layer down.
    ws.on('message', (data) => game.receive(data));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return game;
  }

  receive(data) {
    const frame = JSON.parse(data.toString());
    const { messagePurpose, requestId } = frame.header;

    if (messagePurpose === 'subscribe') {
      this.subscribed.push(frame.body.eventName);
      return;
    }
    if (messagePurpose !== 'commandRequest') return;

    const commandLine = frame.body.commandLine;
    this.commands.push(commandLine);

    // The two socket-be asks for on its own, before anything of ours is sent. Left
    // unanswered they only log, but answering keeps the noise out of a failing test's output.
    if (commandLine === 'getlocalplayername') {
      this.respond(requestId, { statusCode: 0, localplayername: PLAYER });
      return;
    }
    if (commandLine === 'list') {
      this.respond(requestId, { statusCode: 0, players: PLAYER, current: 1, max: 8 });
      return;
    }

    this.respond(requestId, { statusCode: 0, statusMessage: '' });
    for (const line of this.addon(commandLine)) {
      // On a later turn, as chat is: no reply arrives inside the command's own response.
      setTimeout(() => this.say(line), 5);
    }
  }

  respond(requestId, body) {
    this.send({ header: { version: 1, requestId, messagePurpose: 'commandResponse' }, body });
  }

  /** A `tell` - which arrives bare, unlike `say`, which arrives as `[Name] message`. */
  say(message, { type = 'tell', sender = PLAYER } = {}) {
    this.send({
      header: { version: 1, requestId: '00000000-0000-0000-0000-000000000000', messagePurpose: 'event', eventName: 'PlayerMessage' },
      body: { type, message, sender, receiver: type === 'tell' ? PLAYER : '' },
    });
  }

  send(frame) {
    this.ws.send(JSON.stringify(frame));
  }

  close() {
    return new Promise((resolve) => {
      this.ws.once('close', resolve);
      this.ws.close();
    });
  }
}

/**
 * A transport on a port the OS picks, with encryption off.
 *
 * Port 0 because tests must not fight over 19131 - or with a game that happens to be
 * connected to a real one. Encryption off because the fake game does not do ECDH; the live
 * default is the other way and is checked separately by what {@link whenConnected} says when
 * it gives up.
 */
async function listen(options = {}) {
  const transport = new SocketBridgeTransport({ port: 0, disableEncryption: true, ...options });
  await transport.listening;
  return transport;
}

/** Closes the game first, so the world's polling interval is cleared before the server goes. */
async function shutDown(transport, game) {
  if (game) await game.close();
  await sleep(20);
  await transport.close();
}

await test('PlayerMessage is subscribed to before the game can say anything', async () => {
  const transport = await listen();
  const game = await FakeGame.connect(transport.port);
  await sleep(60);

  // The whole point of the file. If registration moved after the connection - into a start()
  // that awaits, say - this list would not have it, chat would never arrive, and every read
  // would look like a missing add-on.
  assert.ok(
    game.subscribed.includes('PlayerMessage'),
    `subscribed to ${JSON.stringify(game.subscribed)}, which does not include PlayerMessage`
  );

  await shutDown(transport, game);
});

await test('a world connecting resolves whenConnected', async () => {
  const transport = await listen();
  assert.equal(transport.connected, false);

  const waiting = transport.whenConnected(2000);
  const game = await FakeGame.connect(transport.port);
  await waiting;

  assert.equal(transport.connected, true);
  await shutDown(transport, game);
});

await test('whenConnected gives up with the encryption setting named', async () => {
  const transport = await listen();
  // The failure that reads as "nothing is there" when it means "the two sides disagree about
  // encryption". Naming it in the message is the whole mitigation.
  await assert.rejects(transport.whenConnected(60), (error) => {
    assert.ok(error instanceof BridgeTransportError);
    assert.match(error.message, /encryption/);
    assert.match(error.message, /\/connect localhost:\d+/);
    return true;
  });
  await shutDown(transport, null);
});

await test('send reaches the game as the exact command line', async () => {
  const transport = await listen();
  const game = await FakeGame.connect(transport.port);
  await transport.whenConnected(2000);

  await transport.send('scriptevent mcp:ping ab12 {}');
  assert.ok(game.commands.includes('scriptevent mcp:ping ab12 {}'));

  await shutDown(transport, game);
});

await test('send before anything connects says how to connect', async () => {
  const transport = await listen();
  await assert.rejects(transport.send('scriptevent mcp:ping ab12 {}'), (error) => {
    assert.ok(error instanceof BridgeTransportError);
    assert.match(error.message, /\/connect localhost:\d+/);
    return true;
  });
  await shutDown(transport, null);
});

await test('a listener added long after the connection still hears chat', async () => {
  // socket-be's subscription is fixed at connect time; ours is not, and it must not be -
  // BridgeClient adds a listener per request, every one of them after the game connected.
  const transport = await listen();
  const game = await FakeGame.connect(transport.port);
  await transport.whenConnected(2000);
  await sleep(30);

  const heard = [];
  const stop = transport.onChat((message) => heard.push(message));
  game.say('MCPB|zz01|{"ok":true}');
  await sleep(40);

  assert.deepEqual(heard, ['MCPB|zz01|{"ok":true}']);

  stop();
  game.say('MCPB|zz02|{"ok":true}');
  await sleep(40);
  assert.equal(heard.length, 1, 'a removed listener kept receiving');

  await shutDown(transport, game);
});

await test('a request and its reply survive the round trip', async () => {
  const transport = await listen();
  const game = await FakeGame.connect(transport.port);
  await transport.whenConnected(2000);

  game.addon = (commandLine) => {
    const id = commandLine.split(' ')[2];
    return [`MCPB|${id}|{"ok":true,"name":"minecraft:chest","states":{"facing_direction":2}}`];
  };

  const client = new BridgeClient(transport, { firstLineMs: 2000, quietMs: 120 });
  const { header } = await client.request('getblock', { x: 3, y: -55, z: -1 });

  assert.equal(header.name, 'minecraft:chest');
  await shutDown(transport, game);
});

await test('a split answer is reassembled, and a dropped line is not passed off as complete', async () => {
  const transport = await listen();
  const game = await FakeGame.connect(transport.port);
  await transport.whenConnected(2000);
  const client = new BridgeClient(transport, { firstLineMs: 2000, quietMs: 120 });

  game.addon = (commandLine) => {
    const id = commandLine.split(' ')[2];
    const lines = [`MCPB|${id}|{"ok":true,"total":12,"parts":4}`];
    for (let part = 0; part < 4; part++) lines.push(`MCPB|${id}.${part}|{"part":${part},"blocks":["stone","air","dirt"]}`);
    return lines;
  };
  const whole = await client.request('readregion');
  assert.equal(whole.parts.length, 4);

  // The dangerous case: every line that does arrive is well-formed JSON, so a short answer
  // looks like a small region unless the header's count is checked.
  game.addon = (commandLine) => {
    const id = commandLine.split(' ')[2];
    const lines = [`MCPB|${id}|{"ok":true,"total":12,"parts":4}`];
    for (const part of [0, 1, 3]) lines.push(`MCPB|${id}.${part}|{"part":${part},"blocks":["stone"]}`);
    return lines;
  };
  await assert.rejects(client.request('readregion'), /1 of 4 parts missing \(2\)/);

  await shutDown(transport, game);
});

await test('ordinary chat is ignored, and a say keeps its name prefix', async () => {
  const transport = await listen();
  const game = await FakeGame.connect(transport.port);
  await transport.whenConnected(2000);

  const heard = [];
  transport.onChat((message) => heard.push(message));
  game.say('[先生] probe: chat control', { type: 'say', sender: '先生' });
  await sleep(40);

  // Passed through untouched: deciding what is ours is the protocol layer's job, and it wants
  // the prefix, since `say` carries one and `tell` does not.
  assert.deepEqual(heard, ['[先生] probe: chat control']);

  await shutDown(transport, game);
});

await test('a world that goes away leaves the transport unconnected', async () => {
  const transport = await listen();
  const game = await FakeGame.connect(transport.port);
  await transport.whenConnected(2000);
  assert.equal(transport.connected, true);

  await game.close();
  await sleep(40);
  assert.equal(transport.connected, false, 'still reporting a world after the socket closed');

  // And says so usefully rather than hanging on a send that can never land.
  await assert.rejects(transport.send('scriptevent mcp:ping ab12 {}'), /\/connect/);

  await transport.close();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
