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
import { FakeGame, sleep } from './fake-game.mjs';

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

await test('a port already in use does not take the process down', async () => {
  // socket-be registers no `error` handler on its WebSocketServer, and an emitter with no
  // listener for `error` throws - so without the one added in the transport, a busy port
  // would kill the whole MCP server, including the building tools, which never needed a port.
  const first = await listen();
  const second = new SocketBridgeTransport({ port: first.port, disableEncryption: true });
  await second.listening;

  assert.ok(second.listenFailure, 'the second listen should have failed');
  assert.match(String(second.listenFailure.message), /EADDRINUSE|address already in use/i);

  // And says something a person can act on, rather than repeating /connect at someone whose
  // problem is not that they forgot to type it.
  await assert.rejects(second.send('scriptevent mcp:ping ab12 {}'), (error) => {
    assert.match(error.message, /could not listen on port/);
    assert.match(error.message, /--port/);
    assert.match(error.message, /Building tools are unaffected/);
    return true;
  });

  await second.close();
  await shutDown(first, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
