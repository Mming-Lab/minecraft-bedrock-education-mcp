// Build it, read it, edit it, put it back — all through the MCP protocol.
//
// The same round trip the rigs did, one layer up. The rigs called tool handlers in their own
// process; this goes over stdio to a server running as a child process, which is what an
// editor does. Everything between - schema validation on the way in, output validation on the
// way out, the structured content a model actually receives - is only exercised here.
//
// It does not need the current add-on. The version question is `status`'s; this one is about
// whether the whole path works, and it works the same on either version - the difference is
// only whether the replies are private.

const RADIUS = 4;
const BLOCK = 'gold_block';
const HEIGHT_ABOVE_PLAYER = 22;

/** Every layer as text, highest first, so it reads like looking at the thing. */
function render(region) {
  const lines = [];
  for (const [symbol, name] of Object.entries(region.palette)) lines.push(`  ${symbol}  ${name}`);
  lines.push('');
  for (const layer of [...region.layers].reverse()) {
    lines.push(`y = ${layer.y}`);
    for (const row of layer.rows) lines.push(`  ${row}`);
  }
  return lines;
}

/** Block names by position, so two reads compare by what is there rather than by symbol. */
function namesOf(region) {
  const names = new Map();
  for (const layer of region.layers) {
    layer.rows.forEach((row, z) => {
      [...row].forEach((symbol, x) => {
        names.set(`${x},${layer.y},${z}`, region.palette[symbol] ?? symbol);
      });
    });
  }
  return names;
}

export async function run({ call, note, log, sleep }) {
  // --- where is the player -------------------------------------------------------------------
  const nearby = await call('world.entities', { center: { x: 0, y: -50, z: 0 }, radius: 64, limit: 40 });
  const player = (nearby.value?.entities ?? []).find((e) => e.type === 'minecraft:player');
  if (!player) {
    note('reading', 'No player found within 64 blocks of the origin, so there is nowhere to build.');
    return;
  }
  const at = { x: Math.round(player.x), y: Math.round(player.y), z: Math.round(player.z) };
  note('player_at', at);

  const centre = { x: at.x, y: at.y + HEIGHT_ABOVE_PLAYER, z: at.z };
  const corner1 = { x: centre.x - RADIUS - 1, y: centre.y - RADIUS - 1, z: centre.z - RADIUS - 1 };
  const corner2 = { x: centre.x + RADIUS + 1, y: centre.y + RADIUS + 1, z: centre.z + RADIUS + 1 };

  // --- the control: empty first ----------------------------------------------------------------
  //
  // Without it, a sphere-shaped answer could be terrain that was already there.
  const before = await call('world.read_region', { corner1, corner2 });
  if (!before.ok) {
    note('reading', `Could not read the target area: ${before.error}`);
    return;
  }
  const kindsBefore = Object.values(before.value.palette);
  note('before', { unknown: before.value.unknown, kinds: kindsBefore });
  if (before.value.unknown > 0 || kindsBefore.some((name) => name !== 'air')) {
    note('reading', 'The target box is not empty air. Move somewhere clear and rerun.');
    return;
  }

  // --- build ------------------------------------------------------------------------------------
  const startedBuild = Date.now();
  const built = await call('build.sphere', { center: centre, radius: RADIUS, block: BLOCK });
  if (!built.ok) {
    note('reading', `build.sphere failed: ${built.error}`);
    return;
  }
  note('build', {
    ms: Date.now() - startedBuild,
    blockCount: built.value.blockCount,
    commandCount: built.value.commandCount,
    unsent: built.value.unsent.length,
    negative: built.value.negative.length,
  });
  await sleep(600);

  // --- read it back -------------------------------------------------------------------------------
  const read = await call('world.read_region', { corner1, corner2 });
  if (!read.ok) {
    note('reading', `The sphere was built and could not be read back: ${read.error}`);
    return;
  }
  const goldSymbol = Object.entries(read.value.palette).find(([, name]) => name === BLOCK)?.[0] ?? null;
  const perLayer = read.value.layers.map((layer) =>
    layer.rows.reduce((total, row) => total + [...row].filter((c) => c === goldSymbol).length, 0)
  );
  const total = perLayer.reduce((sum, n) => sum + n, 0);

  log('');
  for (const line of render(read.value)) log(`  ${line}`);
  log('');

  const middle = Math.floor(perLayer.length / 2);
  note('read_back', {
    total,
    expected: built.value.blockCount,
    matches: total === built.value.blockCount,
    per_layer: perLayer,
    symmetric: perLayer.every((n, i) => n === perLayer[perLayer.length - 1 - i]),
    widest_in_the_middle: perLayer[middle] === Math.max(...perLayer),
  });

  // --- edit two characters and send the grid back ---------------------------------------------------
  //
  // The claim behind build.layers: what came out of the read goes back in unchanged, and a
  // small change is a small edit rather than a recomputation.
  const beforeEdit = namesOf(read.value);
  const target = middle;
  const edited = read.value.layers.map((layer, index) => {
    if (index !== target) {
      // Everything except the layer being edited is marked leave-alone, so this is a genuine
      // partial write rather than a rebuild that happens to differ in two places.
      return { y: layer.y, rows: layer.rows.map((row) => '?'.repeat(row.length)) };
    }
    const rows = [...layer.rows];
    const z = Math.floor(rows.length / 2);
    const x = rows[z].indexOf(goldSymbol);
    if (x >= 0) rows[z] = `${rows[z].slice(0, x)}.${rows[z].slice(x + 1)}`;
    return { y: layer.y, rows };
  });

  const rewritten = await call('build.layers', {
    origin: read.value.origin,
    palette: read.value.palette,
    layers: edited,
  });
  note('rewrite', {
    ok: rewritten.ok,
    error: rewritten.error ?? null,
    blockCount: rewritten.value?.blockCount ?? null,
    untouched: rewritten.value?.untouched ?? null,
  });
  await sleep(600);

  const after = await call('world.read_region', { corner1, corner2 });
  const changed = [];
  if (after.ok) {
    const now = namesOf(after.value);
    for (const [key, name] of beforeEdit) if (now.get(key) !== name) changed.push({ at: key, from: name, to: now.get(key) });
  }
  note('changed', changed);

  // --- put it back -------------------------------------------------------------------------------
  const cleared = await call('build.cube', { corner1, corner2, block: 'air' });
  await sleep(600);
  const empty = await call('world.read_region', { corner1, corner2 });
  note('cleanup', {
    ok: cleared.ok,
    left: empty.ok ? Object.values(empty.value.palette).filter((name) => name !== 'air') : 'could not check',
  });

  const problems = [
    total === built.value.blockCount ? null : `the world has ${total - built.value.blockCount} more gold blocks than the build reported`,
    changed.length === 1 ? null : `${changed.length} blocks changed, expected exactly 1`,
    rewritten.ok ? null : 'the grid could not be written back',
  ].filter(Boolean);

  note(
    'reading',
    problems.length === 0
      ? `Through MCP end to end: a ${built.value.blockCount}-block sphere placed by ${built.value.commandCount} fills, read back exactly, one character edited in the returned grid and written back changing exactly that one block, then cleared. Every layer except the edited one went back as "?" and was left alone.`
      : `Something is off: ${problems.join('; ')}.`
  );
}
