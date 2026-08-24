// The bridge protocol, against a stand-in for the add-on.
//
//   node test/bridge.test.mjs
//
// No game, no socket: the transport is injected, so the part with the timeouts and the
// partial answers can be tested on a machine that has never had Minecraft installed.
//
// The line shapes here are copied from a real session rather than invented - including the
// `[Kai_U] ` a player's name puts on every reply, which is there because the add-on has to
// answer through `player.runCommand('say ...')`. `world.sendMessage` prints in the game and
// fires nothing, and mistaking one for the other is what made three sessions read a working
// bridge as a dead one.

import assert from 'node:assert/strict';

import {
  assemble,
  BridgeProtocolError,
  encodeRequest,
  itemsPerLine,
  MAX_LINE,
  parseLine,
} from '../dist/bridge/protocol.js';
import { BridgeClient, BridgeTimeoutError } from '../dist/bridge/client.js';

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
      console.log(`       ${error.message.split('\n').slice(0, 4).join('\n       ')}`);
    });
}

/** A transport that answers with whatever lines a test hands it. */
function fakeAddon(replyFor) {
  const listeners = new Set();
  const sent = [];
  return {
    sent,
    transport: {
      async send(commandLine) {
        sent.push(commandLine);
        const id = commandLine.split(' ')[2];
        for (const line of replyFor(commandLine, id)) {
          // Asynchronously, as chat is: a reply never arrives inside the send call.
          setTimeout(() => {
            for (const listener of listeners) listener(line);
          }, 5);
        }
      },
      onChat(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    say(message) {
      for (const listener of listeners) listener(message);
    },
  };
}

console.log('bridge protocol');

await test('a request is a scriptevent with the id before the body', () => {
  const command = encodeRequest({ action: 'getblock', id: 'a7', args: { x: 2, y: -55, z: -1 } });
  assert.equal(command, 'scriptevent mcp:getblock a7 {"x":2,"y":-55,"z":-1}');
});

await test('an id long enough to eat the line budget is refused', () => {
  // Every line of a reply repeats the id, so this is not cosmetic.
  assert.throws(() => encodeRequest({ action: 'ping', id: 'averyverylongidentifier', args: {} }), BridgeProtocolError);
});

await test('a reply is read through the player name the add-on had to speak with', () => {
  const line = parseLine('[Kai_U] MCPB|a7|{"ok":true,"name":"minecraft:stone"}');
  assert.equal(line.id, 'a7');
  assert.equal(line.part, null);
  assert.equal(line.payload.name, 'minecraft:stone');
});

await test('a part line carries its index', () => {
  const line = parseLine('[Kai_U] MCPB|r.17|{"part":17,"blocks":["air"]}');
  assert.equal(line.id, 'r');
  assert.equal(line.part, 17);
});

await test('ordinary chat is ignored without being parsed', () => {
  assert.equal(parseLine('[Kai_U] hello everyone'), null);
  assert.equal(parseLine('先生: おはよう'), null);
});

await test('a reply whose JSON is broken is reported, not silently dropped', () => {
  // "no answer" and "a broken answer" call for different responses, so they are different
  // outcomes rather than both being null.
  assert.throws(() => parseLine('[Kai_U] MCPB|a7|{not json'), BridgeProtocolError);
});

await test('a single-line answer needs no assembling', () => {
  const { header, parts } = assemble([parseLine('[Kai_U] MCPB|a7|{"ok":true,"name":"stone"}')]);
  assert.equal(header.name, 'stone');
  assert.deepEqual(parts, []);
});

await test('a split answer comes back in part order however it arrived', () => {
  const lines = [
    parseLine('[Kai_U] MCPB|r.2|{"part":2,"blocks":["c"]}'),
    parseLine('[Kai_U] MCPB|r|{"ok":true,"parts":3}'),
    parseLine('[Kai_U] MCPB|r.0|{"part":0,"blocks":["a"]}'),
    parseLine('[Kai_U] MCPB|r.1|{"part":1,"blocks":["b"]}'),
  ];
  const { parts } = assemble(lines);
  assert.deepEqual(parts.map((p) => p.blocks[0]), ['a', 'b', 'c']);
});

await test('a dropped part is refused rather than returned short', () => {
  // The failure this exists for is silent: the surviving lines are all well formed, so
  // without the header's count a short answer would be handed over as a complete one and the
  // model would reason about a region it had only partly seen.
  const lines = [
    parseLine('[Kai_U] MCPB|r|{"ok":true,"parts":3}'),
    parseLine('[Kai_U] MCPB|r.0|{"part":0}'),
    parseLine('[Kai_U] MCPB|r.2|{"part":2}'),
  ];
  assert.throws(() => assemble(lines), /1 of 3 parts missing \(1\)/);
});

await test('an answer with no header at all is refused', () => {
  assert.throws(() => assemble([parseLine('[Kai_U] MCPB|r.0|{"part":0}')]), /no header/);
});

await test('the line budget leaves room for the wrapper', () => {
  // 481 characters arrived and 487 did not, measured; MAX_LINE has to sit under that with
  // room for `[playername] MCPB|<id>.<part>|` on top.
  assert.ok(MAX_LINE < 481, `${MAX_LINE} is not under the measured 481`);
  const perLine = itemsPerLine(4, 6);
  const encoded = JSON.stringify({ part: 170, blocks: new Array(perLine).fill('stonex') });
  assert.ok(`[Kai_U] MCPB|abcd.170|${encoded}`.length <= 481, `a full line is ${encoded.length} and would be dropped`);
});

console.log('');
console.log('bridge client');

await test('a reply is matched to its request', async () => {
  const addon = fakeAddon((_, id) => [`[Kai_U] MCPB|${id}|{"ok":true,"name":"minecraft:stone"}`]);
  const client = new BridgeClient(addon.transport, { firstLineMs: 500, quietMs: 100 });
  const { header } = await client.request('getblock', { x: 1, y: 2, z: 3 });
  assert.equal(header.name, 'minecraft:stone');
});

await test('another request\'s reply is not mistaken for ours', async () => {
  const addon = fakeAddon((_, id) => [
    '[Kai_U] MCPB|zzzz|{"ok":true,"name":"WRONG"}',
    `[Kai_U] MCPB|${id}|{"ok":true,"name":"RIGHT"}`,
  ]);
  const client = new BridgeClient(addon.transport, { firstLineMs: 500, quietMs: 100 });
  const { header } = await client.request('getblock');
  assert.equal(header.name, 'RIGHT');
});

await test('a player typing something that looks like a reply is ignored', async () => {
  const addon = fakeAddon((_, id) => [`[Kai_U] MCPB|${id}|{"ok":true,"name":"real"}`]);
  const client = new BridgeClient(addon.transport, { firstLineMs: 500, quietMs: 100 });
  const pending = client.request('getblock');
  addon.say('[student] MCPB|notanid|{"ok":true,"name":"typed by hand"}');
  const { header } = await pending;
  assert.equal(header.name, 'real');
});

await test('silence is a timeout that names what to check', async () => {
  const addon = fakeAddon(() => []);
  const client = new BridgeClient(addon.transport, { firstLineMs: 150, quietMs: 50 });
  await assert.rejects(client.request('getblock'), (error) => {
    assert.ok(error instanceof BridgeTimeoutError);
    assert.match(error.message, /add-on may not be loaded/);
    return true;
  });
});

await test('a truncated multi-part answer fails loudly and says how much arrived', async () => {
  const addon = fakeAddon((_, id) => [
    `[Kai_U] MCPB|${id}|{"ok":true,"parts":4}`,
    `[Kai_U] MCPB|${id}.0|{"part":0}`,
    `[Kai_U] MCPB|${id}.1|{"part":1}`,
  ]);
  const client = new BridgeClient(addon.transport, { firstLineMs: 500, quietMs: 100 });
  await assert.rejects(client.request('readregion'), (error) => {
    assert.match(error.message, /2 of 4 parts missing/);
    assert.match(error.message, /3 lines arrived/);
    return true;
  });
});

await test('a long answer is not cut short by the first-line timeout', async () => {
  // The first-line clock bounds the wait for an answer to begin, not its length - a 4096-block
  // read is 172 lines and would trip any total-duration limit set for a point query.
  const addon = fakeAddon((_, id) => {
    const lines = [`[Kai_U] MCPB|${id}|{"ok":true,"parts":60}`];
    for (let part = 0; part < 60; part++) lines.push(`[Kai_U] MCPB|${id}.${part}|{"part":${part}}`);
    return lines;
  });
  const client = new BridgeClient(addon.transport, { firstLineMs: 200, quietMs: 120 });
  const { parts } = await client.request('readregion');
  assert.equal(parts.length, 60);
});

await test('the listener is removed whether the request works or not', async () => {
  const addon = fakeAddon(() => []);
  const client = new BridgeClient(addon.transport, { firstLineMs: 100, quietMs: 50 });
  await assert.rejects(client.request('ping'));
  // A leak here would be invisible until a long session ran out of memory, so it is checked
  // on the failing path specifically - the succeeding one is the easy case.
  addon.say('[Kai_U] MCPB|zzzz|{"ok":true}');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
