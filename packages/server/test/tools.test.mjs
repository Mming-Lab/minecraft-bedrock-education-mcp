// Structural checks on the tool surface.
//
// These enforce the rules the tool design is built on, mechanically rather than by review.
// The legacy server had exactly these problems and nothing caught them: `world` advertised
// three actions that did not exist, `sequence` advertised eight cross-tool actions of which
// none existed, and no tool had an output schema at all.
//
//   node test/tools.test.mjs

import assert from 'node:assert/strict';
import { z } from 'zod';
import { allTools } from '../dist/tools/index.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

console.log('tool surface');

test('every tool has a dot-separated name within the spec\'s character set', () => {
  for (const tool of allTools) {
    assert.match(tool.name, /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/, `bad name: ${tool.name}`);
    assert.ok(tool.name.length <= 128, `${tool.name} exceeds 128 characters`);
  }
});

test('names are unique', () => {
  const seen = new Set();
  for (const tool of allTools) {
    assert.ok(!seen.has(tool.name), `duplicate tool name: ${tool.name}`);
    seen.add(tool.name);
  }
});

test('the list is in a stable, sorted-by-prefix order', () => {
  // A deterministic tools/list lets clients cache it and improves prompt-cache hit rates.
  const prefixes = allTools.map((t) => t.name.split('.')[0]);
  const grouped = [...new Set(prefixes)];
  let cursor = 0;
  for (const prefix of grouped) {
    while (cursor < prefixes.length && prefixes[cursor] === prefix) cursor++;
    assert.ok(
      !prefixes.slice(cursor).includes(prefix),
      `tools with prefix "${prefix}" are not contiguous`
    );
  }
});

test('every tool declares an output schema', () => {
  for (const tool of allTools) {
    assert.ok(tool.outputSchema, `${tool.name} has no outputSchema`);
    assert.ok(Object.keys(tool.outputSchema).length > 0, `${tool.name} has an empty outputSchema`);
  }
});

test('every description says when NOT to use the tool', () => {
  // What a tool does is usually guessable from its name; which of two similar tools to
  // reach for is not. Without this the model defaults to whichever it saw first.
  for (const tool of allTools) {
    assert.match(
      tool.description,
      /\bdo not\b/i,
      `${tool.name} never says when not to use it`
    );
  }
});

test('descriptions that name another tool name one that exists', () => {
  const names = new Set(allTools.map((t) => t.name));
  for (const tool of allTools) {
    for (const match of tool.description.matchAll(/\b([a-z][a-z0-9]*\.[a-z][a-z0-9_]*)\b/g)) {
      assert.ok(
        names.has(match[1]),
        `${tool.name} points at "${match[1]}", which is not a registered tool`
      );
    }
  }
});

test('every declared parameter carries a description', () => {
  // Checked against the emitted JSON Schema rather than the Zod object, because that is
  // what reaches the model. `.describe(...).optional()` leaves the description on the inner
  // type, so reading it off the wrapper would report a false gap.
  for (const tool of allTools) {
    const json = z.toJSONSchema(z.object(tool.inputSchema));
    for (const key of Object.keys(tool.inputSchema)) {
      const property = json.properties?.[key];
      assert.ok(property, `${tool.name}.${key} is missing from the emitted schema`);
      assert.ok(property.description, `${tool.name}.${key} reaches the model with no description`);
    }
  }
});

// --- handlers -------------------------------------------------------------------------------

const byName = new Map(allTools.map((t) => [t.name, t]));

/** Runs a tool through its own schemas, the way the SDK will. */
function call(name, args) {
  const tool = byName.get(name);
  assert.ok(tool, `no such tool: ${name}`);
  const parsed = z.object(tool.inputSchema).parse(args);
  const result = tool.handler(parsed);
  return z.object(tool.outputSchema).parse(result);
}

test('build.cube fills the box between two corners', () => {
  const r = call('build.cube', {
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 3, y: 3, z: 3 },
    block: 'stone',
  });
  assert.equal(r.blockCount, 64);
  assert.deepEqual(r.bounds.min, { x: 0, y: 0, z: 0 });
  assert.deepEqual(r.bounds.max, { x: 3, y: 3, z: 3 });
});

test('build.cube accepts its corners in any order', () => {
  const forward = call('build.cube', {
    corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 3, y: 3, z: 3 }, block: 'stone',
  });
  const reversed = call('build.cube', {
    corner1: { x: 3, y: 3, z: 3 }, corner2: { x: 0, y: 0, z: 0 }, block: 'stone',
  });
  assert.deepEqual(reversed, forward);
});

test('build.sphere takes one radius or three', () => {
  const ball = call('build.sphere', { center: { x: 0, y: 64, z: 0 }, radius: 5, block: 'stone' });
  const same = call('build.sphere', {
    center: { x: 0, y: 64, z: 0 }, radiusX: 5, radiusY: 5, radiusZ: 5, block: 'stone',
  });
  assert.equal(ball.blockCount, same.blockCount);

  const stretched = call('build.sphere', {
    center: { x: 0, y: 64, z: 0 }, radiusX: 3, radiusY: 8, radiusZ: 3, block: 'stone',
  });
  assert.equal(stretched.bounds.max.y - stretched.bounds.min.y, 16);
});

test('build.sphere rejects a call with no radius at all', () => {
  assert.throws(
    () => call('build.sphere', { center: { x: 0, y: 64, z: 0 }, block: 'stone' }),
    /radius/
  );
});

test('a hollow shape is a subset of the solid one', () => {
  const solid = call('build.cylinder', {
    center: { x: 0, y: 64, z: 0 }, radius: 5, height: 6, block: 'stone',
  });
  const hollow = call('build.cylinder', {
    center: { x: 0, y: 64, z: 0 }, radius: 5, height: 6, block: 'stone', hollow: true,
  });
  assert.ok(hollow.blockCount < solid.blockCount, 'hollow should place fewer blocks');
  assert.deepEqual(hollow.bounds, solid.bounds, 'hollow should occupy the same box');
});

test('build.revolution requires the arguments its chosen shape needs', () => {
  assert.throws(
    () => call('build.revolution', {
      center: { x: 0, y: 64, z: 0 }, shape: 'paraboloid', height: 8, block: 'stone',
    }),
    /radius/
  );
  assert.throws(
    () => call('build.revolution', {
      center: { x: 0, y: 64, z: 0 }, shape: 'hyperboloid', height: 8, block: 'stone',
    }),
    /baseRadius/
  );
});

test('build.revolution builds a hyperboloid narrowest at the waist', () => {
  const r = call('build.revolution', {
    center: { x: 0, y: 64, z: 0 }, shape: 'hyperboloid', height: 11,
    baseRadius: 6, waistRadius: 3, block: 'stone',
  });
  // The ends reach baseRadius, so the box spans 2*6 + 1.
  assert.equal(r.bounds.max.x - r.bounds.min.x, 12);
});

test('build.helix refuses a zero-turn spiral instead of drawing a line', () => {
  assert.throws(
    () => call('build.helix', {
      center: { x: 0, y: 64, z: 0 }, radius: 3, height: 10, turns: 0, block: 'stone',
    }),
    /turns/
  );
});

test('a block id with a smuggled command argument is rejected at the schema', () => {
  // The legacy server passed this straight into the command line, so "air 0 destroy"
  // silently turned a replace fill into a destroy.
  for (const bad of ['air 0 destroy', 'air 0 replace minecraft:diamond_block', 'stone"', '@e']) {
    assert.throws(
      () => call('build.cube', {
        corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 1, y: 1, z: 1 }, block: bad,
      }),
      undefined,
      `"${bad}" was accepted`
    );
  }
});

test('coordinates outside the world are rejected at the schema', () => {
  assert.throws(
    () => call('build.cube', {
      corner1: { x: 0, y: -100, z: 0 }, corner2: { x: 1, y: 1, z: 1 }, block: 'stone',
    })
  );
});

test('every build tool produces output matching its own schema', () => {
  const samples = {
    'build.cube': { corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 2, y: 2, z: 2 }, block: 'stone' },
    'build.sphere': { center: { x: 0, y: 64, z: 0 }, radius: 4, block: 'stone' },
    'build.cylinder': { center: { x: 0, y: 64, z: 0 }, radius: 3, height: 5, block: 'stone' },
    'build.cone': { center: { x: 0, y: 64, z: 0 }, radius: 4, height: 6, block: 'stone' },
    'build.torus': { center: { x: 0, y: 64, z: 0 }, majorRadius: 6, minorRadius: 2, block: 'stone' },
    'build.revolution': { center: { x: 0, y: 64, z: 0 }, shape: 'paraboloid', height: 6, radius: 4, block: 'stone' },
    'build.line': { start: { x: 0, y: 64, z: 0 }, end: { x: 10, y: 70, z: 3 }, block: 'stone' },
    'build.helix': { center: { x: 0, y: 64, z: 0 }, radius: 3, height: 12, turns: 2, block: 'stone' },
    'build.curve': { start: { x: 0, y: 64, z: 0 }, end: { x: 20, y: 64, z: 0 }, controlPoints: [{ x: 10, y: 74, z: 0 }], block: 'stone' },
  };

  for (const tool of allTools) {
    const args = samples[tool.name];
    assert.ok(args, `no sample call for ${tool.name} — add one`);
    const r = call(tool.name, args);
    assert.ok(r.blockCount > 0, `${tool.name} produced no blocks`);
    assert.ok(r.bounds.min.x <= r.bounds.max.x, `${tool.name} returned an inverted bounding box`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
