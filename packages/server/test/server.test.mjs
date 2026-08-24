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
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

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

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [ENTRY],
  // The server writes nothing to stderr in normal operation; capturing it keeps a crash
  // from being mistaken for a protocol error.
  stderr: 'pipe',
});

const client = new Client({ name: 'test-harness', version: '0.0.0' });

let tools = [];

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

  await test('calling a tool returns structured content', async () => {
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
} finally {
  await client.close().catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
