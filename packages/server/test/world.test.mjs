// The world-record decoders, against bytes Minecraft actually wrote.
//
//   node test/world.test.mjs
//
// The fixtures in test/fixtures/world-records.json were captured from a running Education
// Edition 1.26.3200 world - four subchunks at four different bit widths, and three saved
// structures. Nothing here is hand-written, which matters more than usual: a hand-made
// fixture would test the decoder against my reading of the format, and my reading of this
// format has been wrong twice already. It said the height argument to getchunkdata was
// ignored (it is not, the test never went below the surface) and that three repeated bytes
// were a block identifier (they are a shaded map colour).
//
// This runs with no game, no database and no network, so it belongs in CI.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nbt from 'prismarine-nbt';

import {
  decodeStructure,
  decodeSubChunk,
  MalformedRecordError,
  structureIndex,
  subChunkIndex,
} from '../dist/world/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'world-records.json'), 'utf8'));

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
    console.log(`       ${error.message.split('\n').slice(0, 4).join('\n       ')}`);
  }
}

/** The palette reader the decoder takes, backed by the NBT library. */
function readPaletteEntry(bytes) {
  const parsed = nbt.parseUncompressed(bytes, 'little');
  const simplified = nbt.simplify(parsed);
  // parseUncompressed does not report a size, so the compound is measured by re-encoding it.
  const size = nbt.writeUncompressed(parsed, 'little').length;
  return {
    block: { name: simplified.name ?? 'minecraft:unknown', states: simplified.states ?? {} },
    bytesRead: size,
  };
}

console.log('world records');

// --- subchunks --------------------------------------------------------------------------

for (const fixture of fixtures.subchunks) {
  const value = Buffer.from(fixture.base64, 'base64');

  test(`subchunk ${fixture.chunkX},${fixture.chunkZ} sub ${fixture.subIndex} (${fixture.bitsPerBlock} bits) decodes`, () => {
    const chunk = decodeSubChunk(value, readPaletteEntry);
    assert.equal(chunk.blocks.length, 4096);
    assert.equal(chunk.yIndex, fixture.subIndex);
    for (const block of chunk.blocks) {
      assert.match(block.name, /^[a-z0-9_]+:[a-z0-9_]+$/, `bad block name ${block.name}`);
    }
  });
}

test('a column reads bottom-up as the world generated it', () => {
  // A claim about the data, not the decoder, and the strongest evidence the index order is
  // right: read x/z/y the wrong way round and a column becomes a horizontal smear rather
  // than a stack, which no amount of valid block names would reveal.
  //
  // The assertion is the generation signature - bedrock at the floor, dirt directly under
  // the grass - and deliberately not "air above the grass". These fixtures come from a world
  // the rigs built in: there is a 20-block stone pillar over one of these columns and a gold
  // marker inside another. An earlier version of this test asserted a pristine column and
  // failed on my own scaffolding.
  const bottoms = fixtures.subchunks.filter((f) => f.subIndex === -4);
  assert.ok(bottoms.length > 0, 'no bottom subchunk in the fixtures');

  for (const fixture of bottoms) {
    const chunk = decodeSubChunk(Buffer.from(fixture.base64, 'base64'), readPaletteEntry);
    const column = [];
    for (let y = 0; y < 16; y++) column.push(chunk.blocks[subChunkIndex(0, y, 0)].name);

    const where = `chunk ${fixture.chunkX},${fixture.chunkZ}: ${column.map((n) => n.replace('minecraft:', '')).join(' ')}`;
    assert.equal(column[0], 'minecraft:bedrock', where);

    const grassAt = column.indexOf('minecraft:grass_block');
    assert.ok(grassAt > 0, `no grass in ${where}`);
    assert.equal(column[grassAt - 1], 'minecraft:dirt', `nothing holding up the grass in ${where}`);
    assert.equal(column[grassAt + 1], 'minecraft:air', `grass is buried in ${where}`);
  }
});

test('every fixture subchunk agrees with the header it was captured with', () => {
  for (const fixture of fixtures.subchunks) {
    const value = Buffer.from(fixture.base64, 'base64');
    assert.equal(value.readUInt8(0), fixture.version);
    assert.equal(value.readUInt8(1), fixture.storages);
  }
});

test('a truncated record is refused rather than half-decoded', () => {
  const value = Buffer.from(fixtures.subchunks[0].base64, 'base64');
  assert.throws(
    () => decodeSubChunk(value.subarray(0, 40), readPaletteEntry),
    MalformedRecordError,
    'a truncated subchunk should not decode'
  );
});

test('an unknown version is refused rather than guessed at', () => {
  const value = Buffer.from(fixtures.subchunks[0].base64, 'base64');
  const tampered = Buffer.from(value);
  tampered.writeUInt8(3, 0);
  assert.throws(() => decodeSubChunk(tampered, readPaletteEntry), /unsupported version 3/);
});

test('indices are x-major, then z, then y', () => {
  // Pinned as arithmetic, because the order cannot be seen in a decoded chunk without
  // knowing what the world looks like, and it is the detail most likely to be "fixed" wrongly.
  assert.equal(subChunkIndex(0, 0, 0), 0);
  assert.equal(subChunkIndex(0, 1, 0), 1);
  assert.equal(subChunkIndex(0, 0, 1), 16);
  assert.equal(subChunkIndex(1, 0, 0), 256);
  assert.equal(subChunkIndex(15, 15, 15), 4095);
});

// --- structures -------------------------------------------------------------------------

for (const fixture of fixtures.structures) {
  test(`structure ${fixture.key.split(':').pop()} decodes`, () => {
    const parsed = nbt.parseUncompressed(Buffer.from(fixture.base64, 'base64'), 'little');
    const region = decodeStructure(nbt.simplify(parsed));

    assert.equal(region.blocks.length, region.size[0] * region.size[1] * region.size[2]);
    assert.equal(region.origin.length, 3);
    for (const block of region.blocks) {
      if (block === null) continue;
      assert.match(block.name, /^[a-z0-9_]+:[a-z0-9_]+$/, `bad block name ${block.name}`);
    }
  });
}

test('a saved structure holds the exact blocks that were placed, at the right offsets', () => {
  // The end-to-end claim the database path rests on: place known blocks, save, read back the
  // same blocks in the same arrangement. A decoder that transposed axes would still return
  // the right *counts*, so the positions are what is asserted.
  //
  // The rigs put gold at +1,0,1, emerald at +1,0,2 and redstone at +2,0,1 in a 3x1x3 region.
  // Only the `zzf_` saves cover that region; `probe_readback` was an earlier save somewhere
  // else, and an earlier version of this test wrongly demanded the markers from it too.
  const marked = fixtures.structures.filter((f) => f.key.includes('zzf_'));
  assert.ok(marked.length > 0, 'no marker structure in the fixtures');

  for (const fixture of marked) {
    const region = decodeStructure(nbt.simplify(nbt.parseUncompressed(Buffer.from(fixture.base64, 'base64'), 'little')));
    assert.deepEqual([...region.size], [3, 1, 3]);

    const at = (x, y, z) => region.blocks[structureIndex(region.size, x, y, z)]?.name ?? null;
    assert.equal(at(1, 0, 1), 'minecraft:gold_block', fixture.key);
    assert.equal(at(1, 0, 2), 'minecraft:emerald_block', fixture.key);
    assert.equal(at(2, 0, 1), 'minecraft:redstone_block', fixture.key);
  }
});

test('structure indices are x-major, then y, then z - not the subchunk order', () => {
  // Different from subChunkIndex on purpose. Assuming one order for both is a silent
  // transposition, so both are written down.
  const size = [3, 1, 3];
  assert.equal(structureIndex(size, 0, 0, 0), 0);
  assert.equal(structureIndex(size, 0, 0, 1), 1);
  assert.equal(structureIndex(size, 1, 0, 0), 3);
  assert.equal(structureIndex(size, 2, 0, 2), 8);
});

test('a structure whose indices do not match its size is refused', () => {
  assert.throws(
    () => decodeStructure({ size: [3, 1, 3], structure: { block_indices: [[0, 0]], palette: { default: { block_palette: [{ name: 'minecraft:air' }] } } } }),
    /2 indices for a 3x1x3 region/
  );
});

test('a position the structure records nothing for stays null, and is not called air', () => {
  // -1 means the save skipped it. Air means the save looked and found air. Flattening the
  // two would tell the model it had seen an empty space it never looked at.
  const region = decodeStructure({
    size: [2, 1, 1],
    structure_world_origin: [0, 0, 0],
    structure: { block_indices: [[0, -1]], palette: { default: { block_palette: [{ name: 'minecraft:air', states: {} }] } } },
  });
  assert.equal(region.blocks[0].name, 'minecraft:air');
  assert.equal(region.blocks[1], null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
