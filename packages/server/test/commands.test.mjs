// The command strings, pinned one row at a time.
//
//   node test/commands.test.mjs
//
// Two things are being held still here. The first is the formatting: a negative coordinate,
// a zero-offset tilde, a block state, a namespace. The second, and the reason the table is
// worth writing out rather than generating, is the set of inputs that must be *refused* -
// `air 0 destroy`, a `hollow` setblock, a fill of 32769 blocks. Each of those was reachable
// in the legacy server and each produced a command the game answered in a way nobody read.
//
// What this cannot check is whether Minecraft accepts what comes out. Every accepted string
// is written to tests/golden/commands/corpus.json so that a live session can replay the set
// and answer that separately.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FILL_VOLUME_LIMIT,
  absolute,
  buildFillCommand,
  buildSetBlockCommand,
  fillVolume,
  formatBlockStates,
  formatCoordinate,
  local,
  normalizeBlockId,
  parseCoordinate,
  relative,
} from '../dist/commands/index.js';
import { BlockId } from '../dist/tools/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, '..', '..', '..', 'tests', 'golden', 'commands', 'corpus.json');

let passed = 0;
let failed = 0;
const corpus = [];

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

const at = (x, y, z) => ({ x, y, z });
const rel = (x, y, z) => [relative(x), relative(y), relative(z)];

// --- the table --------------------------------------------------------------------------
//
// `expect` is the exact command. `throws` is a fragment the error message must contain -
// matched on the message rather than the type so that the message itself stays useful, since
// it is what reaches the model when a call is rejected.

const CASES = [
  // formatting: coordinates
  { name: 'absolute coordinates', run: () => buildSetBlockCommand(at(0, 64, 0), 'stone'),
    expect: 'setblock 0 64 0 minecraft:stone replace' },
  { name: 'negative coordinates keep their sign', run: () => buildSetBlockCommand(at(-5, -64, -12), 'stone'),
    expect: 'setblock -5 -64 -12 minecraft:stone replace' },
  { name: 'negative zero is written as zero', run: () => buildSetBlockCommand(at(-0, 64, -0), 'stone'),
    expect: 'setblock 0 64 0 minecraft:stone replace' },
  { name: 'a zero relative offset is a bare tilde', run: () => buildSetBlockCommand(rel(0, 0, 0), 'stone'),
    expect: 'setblock ~ ~ ~ minecraft:stone replace' },
  { name: 'relative offsets carry their sign', run: () => buildSetBlockCommand(rel(2, -3, 0), 'stone'),
    expect: 'setblock ~2 ~-3 ~ minecraft:stone replace' },
  { name: 'local coordinates', run: () => buildSetBlockCommand([local(0), local(0), local(5)], 'stone'),
    expect: 'setblock ^ ^ ^5 minecraft:stone replace' },
  { name: 'local cannot be mixed with absolute', run: () => buildSetBlockCommand([local(0), absolute(64), local(0)], 'stone'),
    throws: 'cannot be mixed' },
  { name: 'local cannot be mixed with relative', run: () => buildSetBlockCommand([local(1), relative(2), local(3)], 'stone'),
    throws: 'cannot be mixed' },
  { name: 'local from with absolute to is caught across arguments',
    run: () => buildFillCommand([local(0), local(0), local(0)], at(1, 1, 1), 'stone'),
    throws: 'cannot be mixed' },
  { name: 'a fractional coordinate is refused', run: () => buildSetBlockCommand(at(0.5, 64, 0), 'stone'),
    throws: 'whole number' },
  { name: 'a non-finite coordinate is refused', run: () => buildSetBlockCommand(at(Number.NaN, 64, 0), 'stone'),
    throws: 'finite' },

  // formatting: block ids
  { name: 'an unqualified id gets the vanilla namespace', run: () => buildSetBlockCommand(at(0, 0, 0), 'dirt'),
    expect: 'setblock 0 0 0 minecraft:dirt replace' },
  { name: 'a foreign namespace is kept', run: () => buildSetBlockCommand(at(0, 0, 0), 'myaddon:reactor'),
    expect: 'setblock 0 0 0 myaddon:reactor replace' },
  { name: 'case is folded whether or not there is a namespace',
    run: () => [normalizeBlockId('Stone'), normalizeBlockId('Minecraft:Stone')].join(' '),
    expect: 'minecraft:stone minecraft:stone' },
  { name: 'surrounding whitespace is trimmed', run: () => normalizeBlockId('  stone  '),
    expect: 'minecraft:stone' },
  { name: 'the pre-1.19.70 `stone 0 destroy` form is refused', run: () => buildSetBlockCommand(at(0, 0, 0), 'air 0 destroy'),
    throws: '1.19.70' },
  { name: 'states inside the id are refused', run: () => buildSetBlockCommand(at(0, 0, 0), 'stone["facing"="north"]'),
    throws: 'own argument' },
  { name: 'an empty id is refused', run: () => normalizeBlockId(''),
    throws: 'expected a block id' },
  { name: 'a non-string id is refused', run: () => normalizeBlockId(42),
    throws: 'expected a block id' },
  { name: 'punctuation in an id is refused', run: () => normalizeBlockId('stone/dirt'),
    throws: 'lowercase letters' },

  // formatting: block states
  { name: 'states are sorted, strings quoted, booleans bare',
    run: () => formatBlockStates({ open: true, facing: 'north' }),
    expect: '["facing"="north","open"=true]' },
  { name: 'a numeric state is unquoted', run: () => formatBlockStates({ growth: 7 }),
    expect: '["growth"=7]' },
  { name: 'a namespaced state name is allowed', run: () => formatBlockStates({ 'minecraft:cardinal_direction': 'east' }),
    expect: '["minecraft:cardinal_direction"="east"]' },
  { name: 'an empty state object produces no argument', run: () => buildSetBlockCommand(at(0, 0, 0), { id: 'stone', states: {} }),
    expect: 'setblock 0 0 0 minecraft:stone replace' },
  { name: 'states reach the command between the id and the mode',
    run: () => buildSetBlockCommand(at(1, 2, 3), { id: 'oak_log', states: { pillar_axis: 'x' } }, 'keep'),
    expect: 'setblock 1 2 3 minecraft:oak_log ["pillar_axis"="x"] keep' },
  { name: 'a fractional state value is refused', run: () => formatBlockStates({ growth: 1.5 }),
    throws: 'integer' },
  { name: 'a quote in a state value is refused', run: () => formatBlockStates({ name: 'a"b' }),
    throws: 'quote' },
  { name: 'an uppercase state name is refused', run: () => formatBlockStates({ Facing: 'north' }),
    throws: 'lowercase letters' },

  // modes
  { name: 'setblock takes keep', run: () => buildSetBlockCommand(at(0, 0, 0), 'stone', 'keep'),
    expect: 'setblock 0 0 0 minecraft:stone keep' },
  { name: 'setblock takes destroy', run: () => buildSetBlockCommand(at(0, 0, 0), 'stone', 'destroy'),
    expect: 'setblock 0 0 0 minecraft:stone destroy' },
  { name: 'setblock does not take hollow', run: () => buildSetBlockCommand(at(0, 0, 0), 'stone', 'hollow'),
    throws: '/setblock takes replace, keep, destroy' },
  { name: 'setblock does not take outline', run: () => buildSetBlockCommand(at(0, 0, 0), 'stone', 'outline'),
    throws: '/setblock takes' },
  { name: 'fill takes hollow', run: () => buildFillCommand(at(0, 0, 0), at(4, 4, 4), 'stone', { mode: 'hollow' }),
    expect: 'fill 0 0 0 4 4 4 minecraft:stone hollow' },
  { name: 'fill takes outline', run: () => buildFillCommand(at(0, 0, 0), at(4, 4, 4), 'stone', { mode: 'outline' }),
    expect: 'fill 0 0 0 4 4 4 minecraft:stone outline' },
  { name: 'fill does not take strict, which is a Java mode',
    run: () => buildFillCommand(at(0, 0, 0), at(1, 1, 1), 'stone', { mode: 'strict' }),
    throws: '/fill takes replace, keep, destroy, hollow, outline' },

  // fill: the replace filter
  { name: 'a replace filter is appended after the mode',
    run: () => buildFillCommand(at(0, 64, 0), at(4, 64, 4), 'stone', { replaceOnly: 'dirt' }),
    expect: 'fill 0 64 0 4 64 4 minecraft:stone replace minecraft:dirt' },
  { name: 'a filter may carry states of its own',
    run: () => buildFillCommand(at(0, 0, 0), at(1, 1, 1), 'air', { replaceOnly: { id: 'oak_log', states: { pillar_axis: 'y' } } }),
    expect: 'fill 0 0 0 1 1 1 minecraft:air replace minecraft:oak_log ["pillar_axis"="y"]' },
  { name: 'a filter with a non-replace mode is refused',
    run: () => buildFillCommand(at(0, 0, 0), at(1, 1, 1), 'stone', { mode: 'keep', replaceOnly: 'dirt' }),
    throws: 'only exists for `replace`' },

  // fill: volume
  { name: 'a fill of exactly the limit is allowed',
    run: () => buildFillCommand(at(0, 0, 0), at(31, 31, 31), 'stone'),
    expect: 'fill 0 0 0 31 31 31 minecraft:stone replace' },
  { name: 'one block over the limit is refused',
    run: () => buildFillCommand(at(0, 0, 0), at(31, 31, 32), 'stone'),
    throws: `exceeds the ${FILL_VOLUME_LIMIT}-block limit` },
  { name: 'the volume does not depend on which corner comes first',
    run: () => buildFillCommand(at(31, 31, 32), at(0, 0, 0), 'stone'),
    throws: 'exceeds the' },
  { name: 'relative corners share an origin, so the volume is still known',
    run: () => buildFillCommand(rel(0, 0, 0), rel(31, 31, 32), 'stone'),
    throws: 'exceeds the' },
  { name: 'corners in different frames leave the volume unknown, and the fill goes out',
    run: () => buildFillCommand(at(0, 0, 0), rel(60, 60, 60), 'stone'),
    expect: 'fill 0 0 0 ~60 ~60 ~60 minecraft:stone replace' },
];

console.log('command strings');
for (const c of CASES) {
  test(c.name, () => {
    if (c.throws !== undefined) {
      assert.throws(c.run, (error) => {
        assert.ok(
          String(error.message).includes(c.throws),
          `expected the message to mention ${JSON.stringify(c.throws)}, got ${JSON.stringify(error.message)}`
        );
        return true;
      });
      return;
    }
    const actual = c.run();
    assert.equal(actual, c.expect);
    if (actual.startsWith('setblock ') || actual.startsWith('fill ')) {
      corpus.push({ case: c.name, command: actual });
    }
  });
}

// --- properties the table cannot state one row at a time --------------------------------

test('parsing a coordinate and formatting it again is the identity', () => {
  for (const text of ['0', '5', '-5', '~', '~5', '~-5', '^', '^5', '^-5', '30000000']) {
    assert.equal(formatCoordinate(parseCoordinate(text)), text);
  }
});

test('a coordinate that is not one of those forms is refused', () => {
  for (const text of ['', ' ', '5.5', '~~1', '~1.5', 'x', '~x', '5 5', '--5']) {
    assert.throws(() => parseCoordinate(text), undefined, `accepted ${JSON.stringify(text)}`);
  }
});

test('fillVolume agrees with the box it describes', () => {
  assert.equal(fillVolume({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 1);
  assert.equal(fillVolume({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }), 2 * 3 * 4);
  assert.equal(fillVolume({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }), 2 * 3 * 4);
  assert.equal(fillVolume(rel(0, 0, 0), rel(1, 1, 1)), 8);
  assert.equal(fillVolume({ x: 0, y: 0, z: 0 }, rel(1, 1, 1)), null);
});

test('no accepted command contains a double space or a stray bracket', () => {
  for (const { case: name, command } of corpus) {
    assert.ok(!command.includes('  '), `${name}: double space in ${JSON.stringify(command)}`);
    assert.ok(!/\[\s|\s\]/.test(command), `${name}: loose bracket in ${JSON.stringify(command)}`);
    assert.equal(command.trim(), command, `${name}: padded`);
  }
});

test('every command names a block in an explicit namespace', () => {
  for (const { case: name, command } of corpus) {
    assert.match(command, /\s[a-z0-9_]+:[a-z0-9_]+/, `${name}: ${command}`);
  }
});

test('the tool schema and the command builder accept the same block ids', () => {
  // Two validators on the same value is how a tool starts rejecting ids the game would have
  // taken, or waving through ones the builder then throws on - the caller sees a different
  // error depending on which layer it reached. They have to agree.
  const ids = [
    'stone', 'minecraft:stone', 'Stone', 'Minecraft:Stone', 'myaddon:reactor',
    'oak_planks', 'air 0 destroy', 'stone["facing"="north"]', '', 'stone/dirt',
    'a:b:c', ':stone', 'stone:', ' stone', '§stone',
  ];
  for (const id of ids) {
    const bySchema = BlockId.safeParse(id).success;
    let byBuilder = true;
    try {
      normalizeBlockId(id);
    } catch {
      byBuilder = false;
    }
    assert.equal(
      bySchema,
      byBuilder,
      `${JSON.stringify(id)}: schema says ${bySchema}, builder says ${byBuilder}`
    );
  }
});

// --- the corpus -------------------------------------------------------------------------
//
// Written on every run and checked into the tree, so that a change in what this module emits
// shows up as a diff rather than only as a passing test somewhere else.

fs.mkdirSync(path.dirname(CORPUS), { recursive: true });
fs.writeFileSync(
  CORPUS,
  JSON.stringify(
    {
      purpose:
        'Every command string the table produces. Unverified against a live server: replay these at a session to find out which the game actually accepts (design/live-verification-plan.md).',
      commands: [...new Set(corpus.map((c) => c.command))].sort(),
    },
    null,
    2
  ) + '\n'
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`corpus: ${corpus.length} commands -> ${path.relative(process.cwd(), CORPUS)}`);
process.exit(failed === 0 ? 0 : 1);
