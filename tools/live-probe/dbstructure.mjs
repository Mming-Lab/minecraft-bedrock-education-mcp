// Reads a saved structure back out of the world database.
//
//   node dbstructure.mjs <db copy> [--name <fragment>]
//
// `/structure save` writes a world-level key, `structuretemplate_mystructure:<name>`, and it
// gets there in about two to seven seconds - measured across three saves spaced far enough
// apart that a thirty-second autosave would have shown up as a much longer wait on at least
// one of them. A placed block, by contrast, took 25.4 seconds.
//
// That difference is what makes this worth having: the save forces the write, so the model
// can ask for a region and read it back with exact block names and states, rather than
// waiting for the world to get around to saving. The 64-block axis cap is a per-call limit,
// not a total - a larger region is several calls.

import fs from 'node:fs';
import path from 'node:path';
import { LevelDB } from 'leveldb-zlib';
import nbt from 'prismarine-nbt';

const args = process.argv.slice(2);
const dbPath = path.resolve(args[0] ?? '');
const nameIndex = args.indexOf('--name');
const wanted = nameIndex >= 0 ? args[nameIndex + 1] : null;

const db = new LevelDB(dbPath, { createIfMissing: false });
await db.open();

const found = [];
for await (const [rawKey, value] of db.getIterator({ keys: true, values: true })) {
  const key = Buffer.from(rawKey).toString('latin1');
  if (!key.startsWith('structuretemplate_')) continue;
  if (wanted && !key.includes(wanted)) continue;
  found.push({ key, value: Buffer.from(value) });
}
await db.close();

console.log(`structures: ${found.length}`);

for (const entry of found) {
  const parsed = await nbt.parse(entry.value, 'little');
  const data = nbt.simplify(parsed.parsed);

  console.log('');
  console.log(`### ${entry.key}  (${entry.value.length} bytes)`);
  console.log(`  size: ${JSON.stringify(data.size)}`);
  console.log(`  world origin: ${JSON.stringify(data.structure_world_origin)}`);

  const palette = data.structure?.palette?.default?.block_palette ?? [];
  console.log(`  palette (${palette.length}): ${palette.map((b) => b.name).join(', ')}`);

  // Two parallel index arrays - the second is the waterlogging layer, -1 where unused.
  const [layer] = data.structure?.block_indices ?? [];
  if (Array.isArray(layer)) {
    const [sx, sy, sz] = data.size;
    console.log(`  blocks (${layer.length} = ${sx}x${sy}x${sz}):`);
    // Indices run x-major, then y, then z, which is the structure format's own order and
    // not the same as a subchunk's.
    let i = 0;
    for (let x = 0; x < sx; x++) {
      for (let y = 0; y < sy; y++) {
        for (let z = 0; z < sz; z++) {
          const index = layer[i++];
          const block = index < 0 ? '(none)' : palette[index];
          const states = block && block.states && Object.keys(block.states).length ? ` ${JSON.stringify(block.states)}` : '';
          console.log(`    +${x},${y},${z}  ${block?.name ?? block ?? '?'}${states}`);
        }
      }
    }
  }
}
