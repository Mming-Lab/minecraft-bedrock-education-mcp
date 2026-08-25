// The experiment both sides of the argument said would settle it.
//
// One specialist argued the world database is the only way to read chunks no player is near.
// The other argued `/tickingarea` does the same with no new dependency. Each named the test
// that would break their own case, and both tests are here, because neither side's claim has
// ever been run against a game.
//
//   A. Does a ticking area actually make a distant region readable?
//      If not, the argument against the database collapses - it was the whole alternative.
//
//   B. Does a ticking area run the world it loads?
//      The command reference lists water flowing, sand falling, fire spreading and crops
//      growing inside one. If that is true here, then reading through a ticking area is not a
//      read-only act, and `world.read_region` cannot quietly add one on the caller's behalf.
//      Sand is the test: it falls when it has nothing beneath it, and only when its chunk
//      is ticking.
//
//   C. How many areas does this world already have?
//      The limit of ten is per world. A world with a spawn area already spends one.
//
// The distance is chosen from measurement, not guessed: the last live run found chunks stop
// being loaded somewhere past 96 blocks from the player, and `/clone` failed outright at 200.

const FAR = 260;

export async function run({ call, note, log, sleep }) {
  const players = await call('world.players');
  const player = players.value?.players?.[0];
  if (!player) {
    note('reading', 'No player found.');
    return;
  }
  const at = { x: Math.round(player.x), y: Math.round(player.y), z: Math.round(player.z) };
  const far = { x: at.x + FAR, y: at.y, z: at.z };
  note('player_at', at);
  note('far_target', far);

  // --- C. what is already there ---------------------------------------------------------------
  const before = await call('world.loaded_areas');
  note('areas_before', before.value?.statusMessage ?? before.error);

  // --- A1. the control: confirm the far region is unreadable first ------------------------------
  //
  // Without this, a successful read after adding the area proves nothing - the chunks might
  // have been loaded all along.
  const box = {
    corner1: { x: far.x - 2, y: far.y - 2, z: far.z - 2 },
    corner2: { x: far.x + 2, y: far.y + 2, z: far.z + 2 },
  };
  const control = await call('world.read_region', box);
  const controlUnknown = control.value?.unknown ?? null;
  note('before_loading', {
    ok: control.ok,
    error: control.error ?? null,
    unknown: controlUnknown,
    palette: control.value?.palette ?? null,
  });

  if (control.ok && controlUnknown === 0) {
    note(
      'reading',
      `${FAR} blocks away is already loaded (unknown: 0), so this run cannot tell a ticking area from ` +
        `the status quo. Increase FAR and run again.`
    );
    return;
  }

  // --- A2. add the area and read again -----------------------------------------------------------
  const added = await call('world.load_area', { ...box, name: 'mcp_probe' });
  note('load_area', {
    ok: added.ok,
    command: added.value?.commandLine,
    chunks: added.value?.approximateChunks,
    status: added.value?.statusMessage ?? added.error,
  });
  // Chunk loading is not instant; the command returns before the world has caught up.
  await sleep(3000);

  const after = await call('world.read_region', box);
  note('after_loading', {
    ok: after.ok,
    error: after.error ?? null,
    unknown: after.value?.unknown ?? null,
    palette: after.value?.palette ?? null,
  });

  const readable = after.ok && after.value.unknown === 0;
  note('claim_A_ticking_area_makes_it_readable', {
    holds: readable,
    unknown_before: controlUnknown,
    unknown_after: after.value?.unknown ?? null,
  });

  // --- B. does it run? ---------------------------------------------------------------------------
  //
  // Only meaningful if A held: sand cannot fall in a chunk that is not loaded, so a "did not
  // fall" result would be ambiguous otherwise.
  let ticks = null;
  if (readable) {
    const sandAt = { x: far.x, y: far.y + 3, z: far.z };
    const below = { x: far.x, y: far.y + 2, z: far.z };
    // Clear a hole underneath, so the only thing holding the sand up is the absence of ticking.
    await call('build.cube', { corner1: below, corner2: { ...below, y: below.y - 2 }, block: 'air' });
    await sleep(500);
    await call('build.cube', { corner1: sandAt, corner2: sandAt, block: 'sand' });
    await sleep(3000);

    const wasSand = await call('world.get_block', { position: sandAt });
    const landed = await call('world.get_block', { position: { ...below, y: below.y - 2 } });
    ticks = wasSand.value?.block !== 'minecraft:sand';
    note('claim_B_ticking_area_runs_the_world', {
      holds: ticks,
      where_the_sand_was: wasSand.value?.block ?? wasSand.error,
      three_below: landed.value?.block ?? landed.error,
      // If the sand is gone from where it was placed, the chunk is simulating. That is the
      // cost the reading tools would be hiding if they added areas silently.
      reading: ticks
        ? 'The area simulates. Reading through one changes the world, so read_region must not add one by itself.'
        : 'The sand did not move. Either the area does not simulate, or three seconds was not enough.',
    });

    for (const p of [sandAt, below, { ...below, y: below.y - 2 }]) {
      await call('build.cube', { corner1: p, corner2: p, block: 'air' });
    }
  }

  // --- tidy up: the area outlives the process if it is left ---------------------------------------
  const removed = await call('world.unload_area', { name: 'mcp_probe' });
  note('unload_area', removed.value?.statusMessage ?? removed.error);
  const afterRemoval = await call('world.loaded_areas');
  note('areas_after', afterRemoval.value?.statusMessage ?? afterRemoval.error);

  note(
    'reading',
    !readable
      ? `A ticking area did NOT make ${FAR} blocks away readable (unknown went ${controlUnknown} -> ${after.value?.unknown}). ` +
          `The case against the world database loses its alternative.`
      : ticks
        ? `A ticking area makes a distant region readable AND runs it (the sand fell). Both sides were right about their own half: ` +
            `it is a working alternative to the database for reading, and it is not free - reading through one simulates the world.`
        : `A ticking area makes a distant region readable, and the sand did not move in three seconds. ` +
            `That is weaker evidence than it looks - try a longer wait before concluding it does not simulate.`
  );
}
