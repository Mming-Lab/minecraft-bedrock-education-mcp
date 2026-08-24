// A-7: the getchunkdata encoding, decided from raw strings rather than from my decoder.
//
// What the wiki gives: `getchunkdata <dimension> <chunkX> <chunkZ> <height>` returns "the
// block id and height of the first available block in a position below the given y-value",
// dictionary-encoded, comma separated, `*` marking repeats, 256 entries per layer, and "the
// last two values of the 6 digit block identifier are the height of the block".
//
// What A-6 measured, which agrees and pins it down further: raising a column by 20 moved the
// fourth byte by exactly 20 (c4 -> d6), and changing only the material moved the first three
// bytes and left the fourth alone. So three bytes of block identity - a map colour, since a
// neighbouring column changed shade when the pillar shadowed it - and one byte of height,
// with y = byte - 255 at the depths in play here.
//
// Two things A-6 could not settle, both its own fault:
//
//   1. Its decoder dropped 113 of 256 columns. The format has bare numeric entries
//      (`171*4`, `0*13`) as well as 6-character base64 ones, and it fed the numbers to a
//      base64 decoder. This rig stores the RAW strings so the decoding can be worked out
//      afterwards without spending another session.
//   2. It tested the height argument at 0, 100 and 320 - every one of them above a surface
//      at y=-61. "First block below the given y" would answer identically for all three, so
//      "the argument is ignored" was a conclusion about the test, not about the game.
//
// Also probes whether the height byte can express y above 0, which `byte - 255` cannot.

const body = (r) => (r.timedOut ? null : (r.body ?? null));
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

async function announce(session, text) {
  await session.command(`say §b[probe]§r ${text}`, { timeout: 3000 });
}

export async function run(session, { log }) {
  await announce(session, 'chunk encoding - raw capture, about a minute.');

  const target = await session.command('querytarget @s', { timeout: 8000 });
  let at = null;
  try {
    at = JSON.parse(body(target).details)[0].position;
    at = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
  } catch {
    /* recorded as null */
  }
  session.note('player', at);

  const chunkX = at ? at.x >> 4 : 0;
  const chunkZ = at ? at.z >> 4 : 0;
  session.note('chunk', { chunkX, chunkZ });

  const readRaw = async (h) => {
    const reply = await session.command(`getchunkdata overworld ${chunkX} ${chunkZ} ${h}`, { timeout: 8000 });
    return accepted(reply) ? body(reply).data : { error: body(reply) };
  };

  const top = await session.command(`gettopsolidblock ${chunkX * 16 + 8} 320 ${chunkZ * 16 + 8}`, { timeout: 8000 });
  const surfaceY = body(top)?.position?.y ?? null;
  session.note('surface_y', surfaceY);

  // --- the height argument, tested where it can actually differ ---------------------------
  //
  // Above the surface every value must agree; below it, each should cut through the terrain
  // at a different depth and give different answers. That is the discriminating case A-6
  // never ran.
  const heights = surfaceY === null
    ? [320, 100, 0, -40, -60, -64]
    : [320, 0, surfaceY + 5, surfaceY, surfaceY - 5, surfaceY - 20, -64];

  const byHeight = {};
  for (const h of heights) {
    byHeight[h] = await readRaw(h);
    log(`  height ${String(h).padStart(5)}: ${typeof byHeight[h] === 'string' ? byHeight[h].slice(0, 70) : JSON.stringify(byHeight[h])}`);
  }
  session.note('raw_by_height', byHeight);

  const above = heights.filter((h) => surfaceY !== null && h > surfaceY).map((h) => byHeight[h]);
  const below = heights.filter((h) => surfaceY !== null && h < surfaceY).map((h) => byHeight[h]);
  session.note('all_above_surface_agree', above.length > 1 && above.every((d) => d === above[0]));
  session.note('below_surface_differs_from_above', below.length > 0 && above.length > 0 && below.some((d) => d !== above[0]));

  // --- can the height byte express y above 0? --------------------------------------------
  //
  // y = byte - 255 has no room above zero, so either the field is wider than the byte my
  // base64 decode produced or something else happens up there. A tall pillar answers it.
  if (surfaceY !== null) {
    const px = chunkX * 16 + 4;
    const pz = chunkZ * 16 + 4;
    session.note('tall_pillar_at', { x: px, z: pz });

    const beforeTall = await readRaw(320);
    await session.command(`fill ${px} ${surfaceY + 1} ${pz} ${px} 40 ${pz} minecraft:stone replace`, { timeout: 15000 });
    await session.wait(700);
    const afterTall = await readRaw(320);

    session.note('tall_before_raw', beforeTall);
    session.note('tall_after_raw', afterTall);
    session.note('tall_changed', beforeTall !== afterTall);

    await session.command(`fill ${px} ${surfaceY + 1} ${pz} ${px} 40 ${pz} minecraft:air replace`, { timeout: 15000 });
  }

  // --- a flat reference, for reading the dictionary ---------------------------------------
  //
  // A chunk far from anything built has fewer distinct values, so the numeric entries stand
  // out against the base64 ones and the repeat semantics are easier to check against 256.
  session.note('far_chunk_raw', await readRaw(320));

  await announce(session, '§aDONE§r - you can alt-tab now.');
  log('');
  log('raw strings captured; decoding happens off the wire.');
}
