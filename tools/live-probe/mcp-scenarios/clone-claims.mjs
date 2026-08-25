// Four claims that went into the code without being measured.
//
// build.clone_region's description tells a model that `/clone` keeps block states and
// container contents, and its source carries a 524288-block limit. One came from a wiki, one
// from what "clone" ought to mean, and the limit from a document. The connection was live
// throughout and none of them was checked. A description is not a comment: a model reads it
// and acts on it, so an unverified claim there is advice, not a note.
//
// The fourth claim is newer. The build tools now take block states, and `world.get_block`
// returns them - but a state the game *reports* is not necessarily a state it *accepts*. A
// chest reads back with both `facing_direction` and `minecraft:cardinal_direction`, measured
// on hardware, and the second may well be derived rather than settable. If reading and writing
// disagree about what a state is, the round trip the tools now advertise does not close.
//
//   1. Does `/clone` preserve block states? Place a staircase facing a chosen direction -
//      possible for the first time - clone it, read the copy with world.get_block.
//   2. Can a state that was read be written back? Read a placed block's states, place a second
//      block using exactly those states, and read that.
//   3. Where is the volume limit really? Ask for more than the constant claims.
//   4. Does the cloned chest survive as a container? Its *contents* cannot be tested: nothing
//      on the tool surface can put an item in a chest, so this reports what it can and says
//      what it cannot.

const HEIGHT_ABOVE_PLAYER = 25;
const FACING = 2;

export async function run({ call, note, log, sleep }) {
  const players = await call('world.players');
  const player = players.value?.players?.[0];
  if (!player) {
    note('reading', `No player found. world.players said: ${players.error ?? JSON.stringify(players.value)}`);
    return;
  }
  const base = {
    x: Math.round(player.x),
    y: Math.round(player.y) + HEIGHT_ABOVE_PLAYER,
    z: Math.round(player.z),
  };
  note('testing_at', base);

  const spots = {
    stairSource: { x: base.x, y: base.y, z: base.z },
    stairCopy: { x: base.x + 6, y: base.y, z: base.z },
    rewritten: { x: base.x + 12, y: base.y, z: base.z },
    chestSource: { x: base.x, y: base.y, z: base.z + 6 },
    chestCopy: { x: base.x + 6, y: base.y, z: base.z + 6 },
  };

  // Clear everything first, so nothing below can pass by finding what was already there.
  for (const at of Object.values(spots)) {
    await call('build.cube', { corner1: at, corner2: at, block: 'air' });
  }
  await sleep(400);

  // --- 1. does a state survive a clone? -------------------------------------------------------
  //
  // A chosen facing, not whatever the default happens to be: if the source landed in the
  // default state, a preserved state and a reset one would look identical.
  const placed = await call('build.cube', {
    corner1: spots.stairSource,
    corner2: spots.stairSource,
    block: 'oak_stairs',
    states: { weirdo_direction: FACING },
  });
  note('placing_with_states', { ok: placed.ok, error: placed.error ?? null });
  await sleep(400);

  const source = await call('world.get_block', { position: spots.stairSource });
  note('source_block', source.value ?? source.error);

  const askedFor = source.value?.states?.weirdo_direction;
  if (askedFor !== FACING) {
    note(
      'reading',
      `Asked for weirdo_direction=${FACING} and the block reads back as ${JSON.stringify(askedFor)}. ` +
        `The write path does not set states, so nothing below this line can be interpreted.`
    );
    return;
  }

  const cloned = await call('build.clone_region', {
    corner1: spots.stairSource,
    corner2: spots.stairSource,
    destination: spots.stairCopy,
  });
  note('clone', { command: cloned.value?.commandLine, status: cloned.value?.statusMessage ?? cloned.error });
  await sleep(500);

  const copy = await call('world.get_block', { position: spots.stairCopy });
  note('cloned_block', copy.value ?? copy.error);

  const statesSurvive =
    copy.value?.block === source.value?.block &&
    JSON.stringify(copy.value?.states) === JSON.stringify(source.value?.states);
  note('claim_1_clone_keeps_states', {
    holds: statesSurvive,
    source: source.value?.states ?? null,
    copy: copy.value?.states ?? null,
  });

  // --- 2. can a state that was read be written back? -------------------------------------------
  //
  // The round trip the tools now advertise. If the game reports a state it will not accept -
  // a derived one, say - this is where it shows.
  const readBack = source.value?.states ?? {};
  const rewrite = await call('build.cube', {
    corner1: spots.rewritten,
    corner2: spots.rewritten,
    block: source.value?.block ?? 'oak_stairs',
    states: readBack,
  });
  await sleep(400);
  const rewritten = await call('world.get_block', { position: spots.rewritten });

  note('claim_2_read_states_can_be_written', {
    sent: readBack,
    accepted: rewrite.ok,
    error: rewrite.error ?? null,
    landed_as: rewritten.value?.states ?? rewritten.error,
    holds: rewrite.ok && JSON.stringify(rewritten.value?.states) === JSON.stringify(readBack),
  });

  // --- 3. the volume limit ----------------------------------------------------------------------
  //
  // How the /fill limit was settled: ask for too much and let the game name the number. The
  // tool refuses over its own constant before sending, so both sides are probed.
  const under = 80; // 80^3 = 512000, just under the claimed 524288
  const underResult = await call('build.clone_region', {
    corner1: { x: base.x + 200, y: base.y, z: base.z + 200 },
    corner2: { x: base.x + 200 + under - 1, y: base.y + under - 1, z: base.z + 200 + under - 1 },
    destination: { x: base.x + 400, y: base.y, z: base.z + 200 },
  });
  note('claim_3a_just_under_the_limit', {
    volume: underResult.value?.volume ?? null,
    statusCode: underResult.value?.statusCode ?? null,
    // If the game states a maximum here the way it did for /fill, that number is the answer.
    statusMessage: underResult.value?.statusMessage ?? underResult.error,
  });

  const over = await call('build.clone_region', {
    corner1: { x: base.x + 200, y: base.y, z: base.z + 200 },
    corner2: { x: base.x + 289, y: base.y + 89, z: base.z + 289 },
    destination: { x: base.x + 600, y: base.y, z: base.z + 200 },
  });
  note('claim_3b_over_the_limit', {
    refused_before_sending: over.ok === false,
    message: over.error ?? over.value?.statusMessage ?? null,
  });

  // --- 4. the chest ------------------------------------------------------------------------------
  await call('build.cube', { corner1: spots.chestSource, corner2: spots.chestSource, block: 'chest' });
  await sleep(400);
  const chestBefore = await call('world.container', { position: spots.chestSource });
  await call('build.clone_region', {
    corner1: spots.chestSource,
    corner2: spots.chestSource,
    destination: spots.chestCopy,
  });
  await sleep(500);
  const chestAfter = await call('world.container', { position: spots.chestCopy });

  note('claim_4_chest', {
    source: chestBefore.value ?? chestBefore.error,
    copy: chestAfter.value ?? chestAfter.error,
    copy_is_a_container: chestAfter.value?.status === 'read',
    // Stated plainly rather than left to be inferred from two empty item lists.
    contents_untested: 'Nothing on the tool surface can put an item in a chest, so an empty chest cloning to an empty chest says nothing about contents.',
  });

  // --- tidy up ------------------------------------------------------------------------------------
  for (const at of Object.values(spots)) {
    await call('build.cube', { corner1: at, corner2: at, block: 'air' });
  }

  const verdicts = [
    `states survive a clone: ${statesSurvive ? 'YES' : 'NO — the description is wrong'}`,
    `a read state can be written back: ${
      rewrite.ok && JSON.stringify(rewritten.value?.states) === JSON.stringify(readBack) ? 'YES' : 'NO'
    }`,
    `cloned chest is a container: ${chestAfter.value?.status === 'read' ? 'YES' : 'NO'} (contents untested)`,
  ];
  note('reading', verdicts.join('; ') + '. Volume figures are in claim_3a/3b above.');
}
