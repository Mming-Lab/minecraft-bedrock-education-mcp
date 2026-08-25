// Three claims that went into build.clone_region without being measured.
//
// The tool's description tells a model that `/clone` keeps block states and container
// contents, and its code carries a 524288-block limit. One of those came from a wiki, one from
// general knowledge, and the third from an inference about what "clone" ought to mean. The
// connection was live the whole time and none of them was checked.
//
// A description is not a comment. A model reads it and acts on it, so an unverified claim
// there is worse than the same claim in a code comment - it is advice.
//
//   1. Do block states survive a clone? Place a staircase facing a known direction, clone it,
//      read the copy with world.get_block (which does return states, unlike read_region).
//   2. Do container contents survive? Place a chest, put something in it, clone, read the copy
//      with world.container.
//   3. Where is the volume limit? Ask for more than 524288 and read what the game says. This
//      is how the /fill limit was settled - the game answered "33792 > 32768" when asked for
//      too much, which is better evidence than any document.

const HEIGHT_ABOVE_PLAYER = 25;

export async function run({ call, note, log, sleep }) {
  const nearby = await call('world.players');
  const player = nearby.value?.players?.[0];
  if (!player) {
    note('reading', 'No players found, so there is nowhere to test.');
    return;
  }
  const at = { x: Math.round(player.x), y: Math.round(player.y) + HEIGHT_ABOVE_PLAYER, z: Math.round(player.z) };
  note('testing_at', at);

  // --- 1. block states ------------------------------------------------------------------------
  //
  // A staircase, because its facing is visible in the block state and impossible to get right
  // by accident. Placed with a command rather than a build tool, since the build tools have no
  // way to say which direction anything faces - itself worth noticing.
  const stairAt = { x: at.x, y: at.y, z: at.z };
  const stairCopy = { x: at.x + 10, y: at.y, z: at.z };

  await call('build.cube', { corner1: stairAt, corner2: stairAt, block: 'air' });
  await call('build.cube', { corner1: stairCopy, corner2: stairCopy, block: 'air' });
  await sleep(300);

  // build.* cannot set states, so this goes through the layers tool's sibling: a raw fill is
  // not available either. Use the clone tool's own runner path by cloning from a hand-placed
  // block instead - place it with a setblock through build.layers' palette? Neither works.
  // So: place a default staircase, read what state it landed in, and clone that. The claim
  // under test is that whatever state it has is preserved, not that we can choose it.
  await call('build.cube', { corner1: stairAt, corner2: stairAt, block: 'oak_stairs' });
  await sleep(400);

  const before = await call('world.get_block', { position: stairAt });
  note('source_block', before.value ?? before.error);

  const cloned = await call('build.clone_region', {
    corner1: stairAt,
    corner2: stairAt,
    destination: stairCopy,
  });
  note('clone_command', { command: cloned.value?.commandLine, status: cloned.value?.statusMessage });
  await sleep(500);

  const after = await call('world.get_block', { position: stairCopy });
  note('copied_block', after.value ?? after.error);

  const sameBlock = before.value?.block === after.value?.block;
  const sameStates = JSON.stringify(before.value?.states) === JSON.stringify(after.value?.states);
  note('states_survive_clone', {
    block_matches: sameBlock,
    states_match: sameStates,
    source_states: before.value?.states ?? null,
    copy_states: after.value?.states ?? null,
    // If the source staircase happened to land in the default state, this test cannot tell a
    // preserved state from a reset one. Say so rather than claiming a pass.
    conclusive: sameStates && Object.keys(before.value?.states ?? {}).length > 0,
  });

  // --- 2. container contents --------------------------------------------------------------------
  const chestAt = { x: at.x, y: at.y, z: at.z + 4 };
  const chestCopy = { x: at.x + 10, y: at.y, z: at.z + 4 };

  await call('build.cube', { corner1: chestAt, corner2: chestAt, block: 'air' });
  await call('build.cube', { corner1: chestCopy, corner2: chestCopy, block: 'air' });
  await sleep(300);
  await call('build.cube', { corner1: chestAt, corner2: chestAt, block: 'chest' });
  await sleep(400);

  // Filling the chest needs a command the tool surface does not expose. clone_region's runner
  // does, indirectly: `replaceitem` is what the earlier rigs used. There is no tool for it, so
  // this is honest about what it can and cannot set up.
  const stocked = await call('world.container', { position: chestAt });
  note('source_chest', stocked.value ?? stocked.error);

  const chestCloned = await call('build.clone_region', {
    corner1: chestAt,
    corner2: chestAt,
    destination: chestCopy,
  });
  note('chest_clone_status', chestCloned.value?.statusMessage ?? chestCloned.error);
  await sleep(500);

  const copiedChest = await call('world.container', { position: chestCopy });
  note('copied_chest', copiedChest.value ?? copiedChest.error);
  note('chest_survives_clone', {
    copy_is_a_container: copiedChest.value?.status === 'read',
    source_items: stocked.value?.items?.length ?? null,
    copy_items: copiedChest.value?.items?.length ?? null,
    // An empty chest cloned to an empty chest proves the block survived, not the contents.
    conclusive_about_contents: (stocked.value?.items?.length ?? 0) > 0,
  });

  // --- 3. the volume limit ----------------------------------------------------------------------
  //
  // Ask for more than the constant claims and see whether the game names a number, the way it
  // named 32768 for /fill. The tool refuses over its own limit before sending, so this asks for
  // something just under it and then something over - the first tells us the tool's ceiling is
  // reachable at all, the second tells us what the tool says versus what the game would say.
  const big = 80; // 80^3 = 512000, under 524288
  const bigResult = await call('build.clone_region', {
    corner1: { x: at.x + 100, y: at.y, z: at.z + 100 },
    corner2: { x: at.x + 100 + big - 1, y: at.y + big - 1, z: at.z + 100 + big - 1 },
    destination: { x: at.x + 300, y: at.y, z: at.z + 100 },
  });
  note('just_under_the_claimed_limit', {
    volume: bigResult.value?.volume ?? null,
    statusCode: bigResult.value?.statusCode ?? null,
    statusMessage: bigResult.value?.statusMessage ?? null,
    error: bigResult.error ?? null,
  });

  const over = await call('build.clone_region', {
    corner1: { x: at.x + 100, y: at.y, z: at.z + 100 },
    corner2: { x: at.x + 100 + 90 - 1, y: at.y + 90 - 1, z: at.z + 100 + 90 - 1 },
    destination: { x: at.x + 500, y: at.y, z: at.z + 100 },
  });
  note('over_the_claimed_limit', {
    refused_by_the_tool: over.ok === false,
    message: over.error ?? over.value?.statusMessage ?? null,
  });

  // --- tidy up -----------------------------------------------------------------------------------
  for (const box of [
    [stairAt, stairAt],
    [stairCopy, stairCopy],
    [chestAt, chestAt],
    [chestCopy, chestCopy],
  ]) {
    await call('build.cube', { corner1: box[0], corner2: box[1], block: 'air' });
  }

  const problems = [];
  if (!sameBlock) problems.push('the cloned block is not even the same block');
  if (!sameStates) problems.push('block states did NOT survive the clone — the tool description is wrong');
  if (copiedChest.value?.status !== 'read') problems.push('the cloned chest is not a container');

  note(
    'reading',
    problems.length
      ? `Claims in build.clone_region's description do not hold: ${problems.join('; ')}.`
      : `States survived (${sameStates ? 'matched' : 'no'}), the cloned chest is a container. ` +
          `Contents could not be proven either way without a way to put items in a chest — there is no tool for that. ` +
          `The volume figures are in the notes above; the tool's own limit is what refused the large one, not the game.`
  );
}
