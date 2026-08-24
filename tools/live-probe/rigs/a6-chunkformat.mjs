// A-6: what are the four bytes in a getchunkdata column?
//
// `getchunkdata overworld 0 0 0` answers with 256 entries, run-length encoded and base64'd -
// exactly one per column of a 16x16 chunk. Two distinct values in the chunk under the player:
//
//     70 70 70 e6  x16
//     60 60 60 e6  x240
//
// Three repeated bytes and then a constant looks like structure, not like a heightmap, but
// guessing what it is has already cost enough today. This changes the world in known ways and
// reads the same chunk back, so the bytes have to move in a way that identifies them.
//
// The experiments, each isolating one variable:
//
//   1. Same chunk, different `height` argument - is the fourth argument read at all?
//   2. A neighbouring chunk - does anything change between chunks?
//   3. Raise a column by 20 blocks, re-read - if a byte tracks terrain height, it moves.
//   4. Change the surface block without changing height - if a byte is a block id, it moves
//      and the height bytes do not.
//
// Read-then-write-then-read, so each answer is a difference rather than an interpretation.

const body = (r) => (r.timedOut ? null : (r.body ?? null));
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

/** `<base64>*<extra repeats>` pairs, comma separated, into one entry per column. */
function decode(data) {
  if (typeof data !== 'string') return null;
  const text = data.replace(/^"|"$/g, '');
  const columns = [];
  for (const part of text.split(',')) {
    const [b64, extra] = part.split('*');
    const bytes = [...Buffer.from(b64, 'base64')];
    // `*15` alongside a run of 16 means the marker counts repeats after the first.
    const count = extra === undefined ? 1 : Number(extra) + 1;
    for (let i = 0; i < count; i++) columns.push(bytes);
  }
  return columns;
}

const summarise = (columns) => {
  if (!columns) return null;
  const counts = new Map();
  for (const c of columns) {
    const k = c.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return { total: columns.length, distinct: [...counts].map(([bytes, n]) => ({ bytes, n })) };
};

async function announce(session, text) {
  await session.command(`say §b[probe]§r ${text}`, { timeout: 3000 });
}

export async function run(session, { log }) {
  await announce(session, 'chunk format experiments - about a minute.');

  const read = async (chunkX, chunkZ, height = 0) => {
    const reply = await session.command(`getchunkdata overworld ${chunkX} ${chunkZ} ${height}`, { timeout: 8000 });
    if (!accepted(reply)) return { error: body(reply) };
    return { raw: body(reply).data, columns: summarise(decode(body(reply).data)) };
  };

  // Where the player is, so the right chunk gets poked.
  const target = await session.command('querytarget @s', { timeout: 8000 });
  let at = null;
  try {
    const details = JSON.parse(body(target).details);
    const p = details[0].position;
    at = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  } catch {
    /* recorded as null */
  }
  session.note('player', at);
  const chunkX = at ? at.x >> 4 : 0;
  const chunkZ = at ? at.z >> 4 : 0;
  session.note('player_chunk', { chunkX, chunkZ });

  // --- 1. is the fourth argument read? ---------------------------------------------------
  const h0 = await read(chunkX, chunkZ, 0);
  const h100 = await read(chunkX, chunkZ, 100);
  const h320 = await read(chunkX, chunkZ, 320);
  session.note('height_arg_ignored', h0.raw === h100.raw && h0.raw === h320.raw);
  session.note('height_variants', { h0: h0.raw, h100: h100.raw, h320: h320.raw });

  // --- 2. does it differ between chunks? -------------------------------------------------
  const neighbour = await read(chunkX + 1, chunkZ, 0);
  const far = await read(chunkX + 8, chunkZ + 8, 0);
  session.note('neighbour_differs', neighbour.raw !== h0.raw);
  session.note('neighbour', neighbour.columns);
  session.note('far', far.columns);

  // --- 3. raise a column, re-read --------------------------------------------------------
  //
  // A pillar 20 blocks tall at a known spot inside the chunk. If a byte is terrain height,
  // exactly one column's entry changes and it changes by something related to 20.
  const baseX = chunkX * 16 + 8;
  const baseZ = chunkZ * 16 + 8;
  const top = await session.command(`gettopsolidblock ${baseX} 320 ${baseZ}`, { timeout: 8000 });
  const surfaceY = body(top)?.position?.y ?? null;
  session.note('surface_y', surfaceY);
  session.note('surface_block', body(top)?.blockName ?? null);

  session.note('before_pillar', h0.columns);

  if (surfaceY !== null) {
    await session.command(`fill ${baseX} ${surfaceY + 1} ${baseZ} ${baseX} ${surfaceY + 20} ${baseZ} minecraft:stone replace`);
    await session.wait(500);
    const afterPillar = await read(chunkX, chunkZ, 0);
    session.note('after_pillar', afterPillar.columns);
    session.note('pillar_changed_bytes', afterPillar.raw !== h0.raw);

    // --- 4. change the block, not the height ---------------------------------------------
    //
    // Same column, same top height, different material. Whatever moves now is a block
    // identity and whatever stayed put through this but moved in step 3 is a height.
    await session.command(`setblock ${baseX} ${surfaceY + 20} ${baseZ} minecraft:gold_block replace`);
    await session.wait(500);
    const afterMaterial = await read(chunkX, chunkZ, 0);
    session.note('after_material', afterMaterial.columns);
    session.note('material_changed_bytes', afterMaterial.raw !== afterPillar.raw);

    // Put it back, so the world is left roughly as found.
    await session.command(`fill ${baseX} ${surfaceY + 1} ${baseZ} ${baseX} ${surfaceY + 20} ${baseZ} minecraft:air replace`);
  }

  const readings = [];
  if (session.notes.height_arg_ignored) readings.push('the fourth argument makes no difference to the reply');
  if (session.notes.neighbour_differs) readings.push('chunks differ from each other, so this is per-chunk data');
  if (session.notes.pillar_changed_bytes) readings.push('raising a column changed the bytes - something in there tracks height');
  else readings.push('raising a column by 20 changed nothing, so these are not heights');
  if (session.notes.material_changed_bytes) readings.push('changing the surface material also changed them');
  else readings.push('changing the surface material changed nothing, so these are not block ids');
  session.note('reading', readings.join('; '));

  await announce(session, '§aDONE§r - you can alt-tab now.');
  log('');
  log(session.notes.reading);
}
