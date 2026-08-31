// End-to-end check: spawn the server over stdio and talk to it with a real MCP client.
//
// The unit tests exercise the tool definitions directly, which says nothing about whether
// registration actually works — a schema the SDK rejects, a name it refuses, a result shape
// that fails output validation would all pass there and fail here.
//
//   node test/server.test.mjs   (after `tsc`)

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import net from 'node:net';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { FakeGame, sleep } from './fake-game.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'dist', 'index.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

console.log('server over stdio');

/**
 * A port the OS has just confirmed is free.
 *
 * Asked for and released rather than assumed: the child process opens a real WebSocket, and a
 * hard-coded port would make this test fail whenever anything else on the machine happened to
 * be using it - including a previous run of the live probe.
 */
async function freePort() {
  const probe = net.createServer();
  return new Promise((resolve, reject) => {
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();

const transport = new StdioClientTransport({
  command: process.execPath,
  // A port the OS just told us was free, rather than 19131 - the test must not fight with
  // another test, with a developer's own server, or with a game connected to a real one. Not
  // port 0, because the fake game has to dial back in and would have no way to learn which
  // port the child ended up on. Encryption off because the fake does not do ECDH.
  args: [ENTRY, '--port', String(PORT), '--no-encryption', 'true'],
  // The server announces the port it is listening on over stderr; capturing it keeps that,
  // and a crash, from being mistaken for a protocol error.
  stderr: 'pipe',
});

const client = new Client({ name: 'test-harness', version: '0.0.0' });

let tools = [];
/** The fake game, once it has dialled in partway through. Closed in the teardown below. */
let game = null;

try {
  await client.connect(transport);

  await test('connects and reports the server it is talking to', async () => {
    const info = client.getServerVersion();
    assert.ok(info, 'no server identity returned');
    assert.match(info.name, /minecraft-bedrock-education-mcp/);
  });

  await test('lists every registered tool', async () => {
    const result = await client.listTools();
    tools = result.tools;
    assert.ok(tools.length >= 9, `expected at least 9 tools, got ${tools.length}`);
    for (const tool of tools) {
      assert.match(tool.name, /^[a-z]+\.[a-z_]+$/, `unexpected tool name: ${tool.name}`);
    }
  });

  await test('every listed tool carries a description and an input schema', async () => {
    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} has no description`);
      assert.ok(tool.inputSchema, `${tool.name} has no inputSchema`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} inputSchema is not an object`);
    }
  });

  await test('the output schema survives registration', async () => {
    // The legacy server had no output schema at all, so this is the check that the concept
    // actually reaches the wire rather than being dropped somewhere in registration.
    for (const tool of tools) {
      assert.ok(tool.outputSchema, `${tool.name} lost its outputSchema during registration`);
    }
  });

  await test('parameter descriptions reach the client', async () => {
    const cube = tools.find((t) => t.name === 'build.cube');
    assert.ok(cube, 'build.cube was not registered');
    for (const [key, property] of Object.entries(cube.inputSchema.properties ?? {})) {
      assert.ok(property.description, `build.cube.${key} arrived with no description`);
    }
  });

  await test('no array parameter arrives without an item schema', async () => {
    // An array declared with no `items` becomes an unconstrained list, and every rule
    // inside it stops applying. The previous server had five of these - the `steps` array
    // on four tools plus `player.can_destroy` and `can_place_on` - which is how a step
    // could carry `distance: 1000000` past a schema that capped it at 10.
    for (const tool of tools) {
      for (const [key, property] of Object.entries(tool.inputSchema.properties ?? {})) {
        if (property.type !== 'array') continue;
        assert.ok(
          property.items && Object.keys(property.items).length > 0,
          `${tool.name}.${key} is an array with no item schema`
        );
      }
    }
  });

  await test('no parameter arrives unconstrained', async () => {
    for (const tool of tools) {
      for (const [key, property] of Object.entries(tool.inputSchema.properties ?? {})) {
        const constrained =
          property.type !== undefined ||
          property.enum !== undefined ||
          property.anyOf !== undefined ||
          property.oneOf !== undefined ||
          property.$ref !== undefined;
        assert.ok(constrained, `${tool.name}.${key} arrived with no type at all`);
      }
    }
  });

  await test('a description that names another tool names one that is registered', async () => {
    // The previous server's `sequence` advertised eight actions belonging to other tools and
    // not one of them existed, so every step the model built from that description failed.
    const names = new Set(tools.map((t) => t.name));
    for (const tool of tools) {
      for (const match of tool.description.matchAll(/\b([a-z][a-z0-9]*\.[a-z][a-z0-9_]*)\b/g)) {
        assert.ok(
          names.has(match[1]),
          `${tool.name} points at "${match[1]}", which is not registered`
        );
      }
    }
  });

  await test('the tool list is in a stable order', async () => {
    const again = await client.listTools();
    assert.deepEqual(
      again.tools.map((t) => t.name),
      tools.map((t) => t.name),
      'tools/list returned a different order on the second call'
    );
  });

  await test('reading the world with nothing connected says what to do about it', async () => {
    // The whole point of registering the world tools whether or not a game is there. This is
    // the real process on a real socket with nobody on the other end, which is exactly the
    // state a teacher's machine is in for the first minute after starting the server.
    const result = await client.callTool({
      name: 'world.read_region',
      arguments: { corner1: { x: 0, y: 64, z: 0 }, corner2: { x: 3, y: 67, z: 3 } },
    });

    assert.ok(result.isError, 'should be a tool error the model can act on, not a success');
    const text = result.content.map((block) => block.text ?? '').join(' ');
    // Actionable, and addressed to the person who can act: the model cannot type /connect.
    assert.match(text, /\/connect localhost:\d+/);
  });

  // --- from here on, a game is on the other end -------------------------------------------
  //
  // Everything above ran with nothing connected, which is the state the server starts in.
  // What follows is the whole path end to end: an MCP call over stdio, into the server, out
  // over the WebSocket as a Bedrock command, and back. The fake speaks the frames a recorded
  // session showed the real game speaking.
  game = await FakeGame.connect(PORT);
  await sleep(120);

  await test('calling a tool returns structured content — and the fill reaches the game', async () => {
    const before = game.commands.length;
    const result = await client.callTool({
      name: 'build.cube',
      arguments: {
        corner1: { x: 0, y: 64, z: 0 },
        corner2: { x: 3, y: 67, z: 3 },
        block: 'stone',
      },
    });

    assert.ok(!result.isError, `call reported an error: ${JSON.stringify(result.content)}`);
    assert.ok(result.structuredContent, 'no structuredContent returned');
    assert.equal(result.structuredContent.blockCount, 64);
    assert.equal(result.structuredContent.block, 'stone');

    // The half that was missing until the executor existed: before it, this tool returned
    // exactly the same summary and placed nothing at all.
    const fills = game.commands.slice(before).filter((line) => line.startsWith('fill '));
    assert.equal(fills.length, 1, `expected one fill, got ${JSON.stringify(game.commands.slice(before))}`);
    assert.equal(fills[0], 'fill 0 64 0 3 67 3 minecraft:stone replace');
    assert.equal(result.structuredContent.commandCount, 1);
  });

  await test('reading a region comes back as a layer grid', async () => {
    // The add-on's side of the conversation, in the shape the real one answers in: a header
    // saying how many parts follow, then the parts.
    game.addon = (commandLine) => {
      if (!commandLine.startsWith('scriptevent mcp:readregion')) return [];
      const id = commandLine.split(' ')[2];
      const blocks = ['stone', 'stone', 'air', 'air', 'stone', 'stone', 'air', 'air'];
      return [
        `MCPB|${id}|{"ok":true,"total":8,"parts":1}`,
        `MCPB|${id}.0|{"part":0,"blocks":${JSON.stringify(blocks)}}`,
      ];
    };

    const result = await client.callTool({
      name: 'world.read_region',
      arguments: { corner1: { x: 0, y: 64, z: 0 }, corner2: { x: 1, y: 65, z: 1 } },
    });

    assert.ok(!result.isError, `read failed: ${JSON.stringify(result.content)}`);
    const region = result.structuredContent;
    assert.deepEqual(region.size, { x: 2, y: 2, z: 2 });
    // Bottom layer is solid, top is empty: the grid keeps the arrangement, which is the whole
    // reason it is a grid and not a list of names.
    assert.deepEqual(region.layers[0].rows, ['aa', 'aa']);
    assert.deepEqual(region.layers[1].rows, ['..', '..']);
    assert.equal(region.palette.a, 'stone');
    assert.equal(region.unknown, 0);
  });

  await test('the text block mirrors the structured result', async () => {
    // The spec asks for this so clients that predate structured output still see the answer.
    const result = await client.callTool({
      name: 'build.sphere',
      arguments: { center: { x: 0, y: 64, z: 0 }, radius: 3, block: 'glass' },
    });
    const text = result.content.find((c) => c.type === 'text');
    assert.ok(text, 'no text block returned');
    assert.deepEqual(JSON.parse(text.text), result.structuredContent);
  });

  await test('a schema violation is caught before the handler runs', async () => {
    // "air 0 destroy" is the shape that turned a replace fill into a destroy on the legacy
    // server, because the value went straight into the command line.
    //
    // It comes back as a tool execution error rather than a protocol error, which is what
    // the spec asks for: input validation errors are the kind a model can act on, so the
    // client is meant to hand them back rather than fail the request outright.
    const result = await client.callTool({
      name: 'build.cube',
      arguments: {
        corner1: { x: 0, y: 64, z: 0 },
        corner2: { x: 1, y: 65, z: 1 },
        block: 'air 0 destroy',
      },
    });

    assert.ok(result.isError, 'the smuggled command argument was accepted');
    assert.equal(result.structuredContent, undefined, 'a rejected call still produced a result');
    const text = result.content.find((c) => c.type === 'text');
    assert.match(text.text, /block/, 'the error does not say which parameter was wrong');
  });

  await test('a coordinate outside the world is caught the same way', async () => {
    const result = await client.callTool({
      name: 'build.cube',
      arguments: {
        corner1: { x: 0, y: -999, z: 0 },
        corner2: { x: 1, y: 65, z: 1 },
        block: 'stone',
      },
    });

    assert.ok(result.isError, 'an out-of-world coordinate was accepted');
    const text = result.content.find((c) => c.type === 'text');
    assert.match(text.text, /corner1\.y/, 'the error does not name the offending field');
  });

  await test('a bad argument comes back as a tool error the model can act on', async () => {
    // Not a protocol error: the spec reserves those for malformed requests, and says clients
    // should hand execution errors to the model so it can correct itself.
    const result = await client.callTool({
      name: 'build.revolution',
      arguments: {
        center: { x: 0, y: 64, z: 0 },
        shape: 'hyperboloid',
        height: 8,
        block: 'stone',
      },
    });
    assert.ok(result.isError, 'expected isError on a missing required argument');
    const text = result.content.find((c) => c.type === 'text');
    assert.match(text.text, /baseRadius/, 'the error does not name the missing parameter');
  });

  await test('an unknown tool is a protocol error', async () => {
    await assert.rejects(client.callTool({ name: 'build.nonexistent', arguments: {} }));
  });

  await test('a batch of shapes reaches the game as one set of fills', async () => {
    // The whole point of the tool, checked where it actually happens. A discriminated union
    // has to survive the SDK's own schema conversion, and the fills have to arrive - two
    // things the unit tests cannot see, because they neither serialise nor connect.
    const before = game.commands.length;
    const result = await client.callTool({
      name: 'build.batch',
      arguments: {
        shapes: [
          { type: 'cube', corner1: { x: 60, y: 64, z: 60 }, corner2: { x: 62, y: 64, z: 62 }, block: 'stone' },
          { type: 'sphere', center: { x: 70, y: 64, z: 60 }, radius: 2, block: 'oak_log' },
          { type: 'curve', start: { x: 80, y: 64, z: 60 }, end: { x: 86, y: 70, z: 60 },
            controlPoints: [{ x: 83, y: 64, z: 60 }], block: 'oak_log' },
        ],
      },
    });

    assert.ok(!result.isError, `batch failed: ${JSON.stringify(result.content)}`);
    assert.equal(result.structuredContent.shapeCount, 3);
    assert.equal(result.structuredContent.placed, true);

    const sent = game.commands.slice(before);
    assert.equal(sent.length, result.structuredContent.commandCount);
    assert.ok(sent.every((c) => c.startsWith('fill ')));
    // Both materials went, in one call.
    assert.ok(sent.some((c) => c.includes('stone')));
    assert.ok(sent.some((c) => c.includes('oak_log')));
  });

  await test('a bad entry in a batch names its index over the wire', async () => {
    const result = await client.callTool({
      name: 'build.batch',
      arguments: {
        shapes: [
          { type: 'cube', corner1: { x: 0, y: 64, z: 0 }, corner2: { x: 1, y: 64, z: 1 }, block: 'stone' },
          { type: 'revolution', center: { x: 0, y: 64, z: 0 }, shape: 'hyperboloid', height: 6, block: 'stone' },
        ],
      },
    });
    assert.ok(result.isError, 'a missing required argument should be a tool error');
    const text = result.content.map((c) => c.text ?? '').join(' ');
    assert.match(text, /shapes\[1\]/, 'the error does not say which entry was wrong');
  });

  await test('a plan comes back as a picture, over a real client', async () => {
    // plan.preview shipped passing its own unit tests and failing here, because those tests
    // call the handler directly and this goes through the SDK. The image rides on a symbol key
    // so that JSON.stringify skips it - which it does - but `structuredContent` was handed the
    // same object, and the SDK validates that against the output schema key by key. A symbol
    // key is not a string, and the call came back as a protocol error rather than a picture.
    //
    // The repo already had a name for this shape of mistake: unit tests pass, the real path is
    // broken. This is the test that would have caught it.
    const planned = await client.callTool({
      name: 'build.sphere',
      arguments: { center: { x: 40, y: 64, z: 40 }, radius: 3, block: 'stone', dryRun: true },
    });
    assert.ok(!planned.isError, `dryRun failed: ${JSON.stringify(planned.content)}`);
    assert.equal(planned.structuredContent.placed, false);
    const planId = planned.structuredContent.planId;
    assert.ok(planId, 'no planId came back from a dry run');

    const drawn = await client.callTool({ name: 'plan.preview', arguments: { planId } });
    assert.ok(!drawn.isError, `preview failed: ${JSON.stringify(drawn.content)}`);

    const image = drawn.content.find((block) => block.type === 'image');
    assert.ok(image, 'no image block in the result');
    assert.equal(image.mimeType, 'image/png');
    // A real PNG, not an empty string that happens to type-check.
    assert.ok(Buffer.from(image.data, 'base64').subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
    // ...and the base64 stayed out of the JSON the model reads.
    assert.ok(!JSON.stringify(drawn.structuredContent).includes(image.data.slice(0, 40)));
  });
} finally {
  // The game first: closing the socket lets the server clear the per-world polling
  // interval before the process is asked to go.
  if (game) await game.close().catch(() => {});
  await client.close().catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
