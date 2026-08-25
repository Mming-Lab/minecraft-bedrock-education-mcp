// Every tool, once, against a real game.
//
// Ten of the twenty had never been run outside a unit test. That includes both assess tools -
// the ones the reading half was built for, and the ones a teacher would actually reach for -
// and seven of the nine shapes.
//
// A unit test proves a tool computes what it says. It cannot prove the command it emits is
// accepted, that the blocks land where the arithmetic said, or that reading them back agrees.
// Every one of those has failed at least once in this project on something that passed its
// tests: the executor placed nothing at all, the region read dropped block states, the pack
// the game was running was three versions behind the files.
//
// So each shape is built, read back, and counted. Each assess tool is run against something
// whose answer is known in advance - a deliberately symmetric build, then the same build with
// one block removed - because a measurement tool that returns plausible numbers for anything
// is indistinguishable from one that works.

const HEIGHT = 30;

/** A flat 7x1x7 plus-sign: symmetric on both axes and under a half turn, not under a quarter. */
const PLUS = ['..aaa..', '..aaa..', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', '..aaa..', '..aaa..'];

export async function run({ call, note, log, sleep }) {
  const players = await call('world.players');
  const player = players.value?.players?.[0];
  if (!player) {
    note('reading', `No player: ${players.error ?? JSON.stringify(players.value)}`);
    return;
  }
  // Somewhere actually empty, found by looking. The first run of this scenario built into
  // stone at y+30 and read the terrain back as its own output - the same mistake the earlier
  // rigs avoided with a control read, which this one had dropped.
  let base = null;
  for (const up of [30, 45, 60, 80, 100]) {
    const at = { x: Math.round(player.x), y: Math.round(player.y) + up, z: Math.round(player.z) };
    const probe = await call('world.read_region', {
      corner1: { x: at.x - 8, y: at.y - 2, z: at.z - 8 },
      corner2: { x: at.x + 8, y: at.y + 8, z: at.z + 8 },
    });
    const kinds = probe.ok ? Object.values(probe.value.palette) : ['unreadable'];
    log(`  y+${up}: ${kinds.join(', ')}${probe.ok ? `, unread ${probe.value.unknown}` : ''}`);
    if (probe.ok && probe.value.unknown === 0 && kinds.every((k) => k === 'air')) {
      base = at;
      break;
    }
  }
  if (!base) {
    note('reading', 'No empty airspace found above the player at any height tried. Move somewhere open and rerun.');
    return;
  }
  note('testing_at', base);

  const failures = [];
  const record = (name, ok, detail) => {
    if (!ok) failures.push(`${name}: ${detail}`);
    return { name, ok, detail };
  };

  // --- the seven shapes never run against a game ------------------------------------------------
  //
  // Each in its own airspace, built, then read back and counted. The count is what matters: a
  // shape whose commands are accepted but whose blocks do not land reads back as air.
  const shapes = [
    { tool: 'build.cylinder', args: { center: null, radius: 3, height: 4 }, box: 5 },
    { tool: 'build.cone', args: { center: null, radius: 3, height: 5 }, box: 5 },
    { tool: 'build.torus', args: { center: null, majorRadius: 4, minorRadius: 2 }, box: 6 },
    { tool: 'build.revolution', args: { center: null, shape: 'paraboloid', radius: 3, height: 5 }, box: 5 },
    { tool: 'build.line', args: { start: null, end: null }, box: 6 },
    { tool: 'build.helix', args: { center: null, radius: 3, height: 8, turns: 2 }, box: 6 },
    { tool: 'build.curve', args: { start: null, end: null, controlPoints: null }, box: 6 },
  ];

  const results = [];
  let slot = 0;
  for (const shape of shapes) {
    // All in the same airspace, cleared between each. Spreading them sideways moved the later
    // ones out of the loaded chunks, and "not loaded" looked exactly like "built nothing"
    // because the scenario was not recording `unknown`. It is now.
    const at = base;
    slot++;

    const args = { ...shape.args, block: 'stone' };
    // The three that take endpoints rather than a centre.
    if ('center' in args && args.center === null) args.center = at;
    if ('start' in args && args.start === null) args.start = { x: at.x - 4, y: at.y, z: at.z - 4 };
    if ('end' in args && args.end === null) args.end = { x: at.x + 4, y: at.y + 3, z: at.z + 4 };
    if (args.controlPoints === null) args.controlPoints = [{ x: at.x, y: at.y + 6, z: at.z }];

    const clearBox = {
      corner1: { x: at.x - shape.box - 1, y: at.y - 2, z: at.z - shape.box - 1 },
      corner2: { x: at.x + shape.box + 1, y: at.y + shape.box + 5, z: at.z + shape.box + 1 },
    };
    await call('build.cube', { ...clearBox, block: 'air' });
    await sleep(300);

    const built = await call(shape.tool, args);
    await sleep(400);

    if (!built.ok) {
      results.push(record(shape.tool, false, `refused: ${built.error}`));
      continue;
    }

    const r = shape.box;
    // Taller than it is wide: several shapes grow upward from their centre, and a count that
    // is short because the box ended is indistinguishable from one that is short because the
    // blocks are missing.
    const read = await call('world.read_region', {
      corner1: { x: at.x - r - 1, y: at.y - 2, z: at.z - r - 1 },
      corner2: { x: at.x + r + 1, y: at.y + r + 5, z: at.z + r + 1 },
    });

    let found = 0;
    let unread = null;
    let sawKinds = null;
    if (read.ok) {
      unread = read.value.unknown;
      sawKinds = Object.values(read.value.palette);
      const symbol = Object.entries(read.value.palette).find(([, name]) => name === 'stone')?.[0];
      if (symbol) {
        for (const layer of read.value.layers)
          for (const row of layer.rows) found += [...row].filter((c) => c === symbol).length;
      }
    }

    // Not an exact match: the read box is smaller than some shapes, so the count is a floor.
    // What it catches is zero, which is what "the commands were accepted and nothing happened"
    // looks like - the exact failure the executor had for nine tools and sixty-eight goldens.
    const planned = built.value.blockCount;
    results.push(
      record(
        shape.tool,
        found > 0,
        `planned ${planned}, ${built.value.commandCount} fills, found ${found}` +
          (read.ok ? `, unread ${unread}, saw [${sawKinds.join(', ')}]` : ` (read failed: ${read.error})`)
      )
    );
    log(`  ${shape.tool}: planned ${planned}, found ${found}`);

    await call('build.cube', {
      corner1: { x: at.x - r - 1, y: at.y - 2, z: at.z - r - 1 },
      corner2: { x: at.x + r + 1, y: at.y + r + 5, z: at.z + r + 1 },
      block: 'air',
    });
  }
  note('shapes', results);

  // --- world.agent -------------------------------------------------------------------------------
  //
  // Whatever it answers is informative. "No agent" is the ordinary state and is a valid result;
  // what would be wrong is an exception, or an agent appearing because we asked.
  const agent = await call('world.agent');
  note('agent', agent.value ?? agent.error);
  record('world.agent', agent.ok, agent.error ?? 'answered');

  // --- assess.*, against a build whose answer is known ---------------------------------------------
  const plusAt = { x: base.x, y: base.y + 20, z: base.z };
  const corner2 = { x: plusAt.x + 6, y: plusAt.y, z: plusAt.z + 6 };
  await call('build.cube', { corner1: plusAt, corner2, block: 'air' });
  await sleep(300);
  await call('build.layers', { origin: plusAt, palette: { a: 'stone' }, layers: [{ rows: PLUS }] });
  await sleep(500);

  const symmetric = await call('assess.symmetry', { corner1: plusAt, corner2 });
  note('symmetry_of_a_symmetric_build', {
    ok: symmetric.ok,
    error: symmetric.error ?? null,
    mirror_x: symmetric.value?.mirror_x,
    mirror_z: symmetric.value?.mirror_z,
    rotate_180: symmetric.value?.rotate_180,
    rotate_90: symmetric.value?.rotate_90,
    unknown: symmetric.value?.unknown,
  });

  const clean =
    symmetric.ok &&
    symmetric.value.mirror_x.mismatchCount === 0 &&
    symmetric.value.mirror_z.mismatchCount === 0 &&
    symmetric.value.rotate_180.mismatchCount === 0 &&
    symmetric.value.unknown === 0;
  record('assess.symmetry (symmetric case)', clean, clean ? 'no mismatches, as expected' : 'reported mismatches on a symmetric build');

  // Break exactly one block and confirm the tool points at it.
  const broken = { x: plusAt.x, y: plusAt.y, z: plusAt.z + 3 };
  await call('build.cube', { corner1: broken, corner2: broken, block: 'air' });
  await sleep(400);

  const asymmetric = await call('assess.symmetry', { corner1: plusAt, corner2 });
  const mismatches = asymmetric.value?.mirror_x?.mismatches ?? [];
  const pointsAtIt = mismatches.some(
    (m) =>
      (m.a.x === broken.x && m.a.z === broken.z) || (m.b.x === broken.x && m.b.z === broken.z)
  );
  note('symmetry_after_breaking_one_block', {
    mirror_x_mismatchCount: asymmetric.value?.mirror_x?.mismatchCount,
    mismatches,
    names_the_broken_block: pointsAtIt,
  });
  record(
    'assess.symmetry (asymmetric case)',
    asymmetric.value?.mirror_x?.mismatchCount === 1 && pointsAtIt,
    `expected exactly 1 mismatch naming ${broken.x},${broken.z}; got ${asymmetric.value?.mirror_x?.mismatchCount}`
  );

  const composition = await call('assess.composition', { corner1: plusAt, corner2 });
  note('composition', composition.value ?? composition.error);
  // Counted from the grid rather than written down. The first run asserted 21 because I had
  // guessed at the shape instead of counting it, and called a correct answer a failure.
  const plusBlocks = PLUS.join('').split('').filter((c) => c === 'a').length - 1; // one broken
  record(
    'assess.composition',
    composition.value?.filledCount === plusBlocks && composition.value?.complete === true,
    `expected ${plusBlocks} stone and complete:true, got ${composition.value?.filledCount} / ${composition.value?.complete}`
  );

  await call('build.cube', { corner1: plusAt, corner2, block: 'air' });

  note(
    'reading',
    failures.length === 0
      ? `All twenty tools have now run against a real game. The seven untested shapes placed blocks that read back; assess.symmetry found nothing wrong with a symmetric build and pointed at the single block that broke it; assess.composition counted what was there.`
      : `${failures.length} tool(s) did not behave: ${failures.join(' | ')}`
  );
}
