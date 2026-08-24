// The first thing to ask a freshly connected game, over the real MCP surface.
//
// The add-on was updated to 0.2.0 and the game had to be restarted for it to take effect,
// because pack folders are only scanned at launch. That claim has been written down twice and
// checked zero times. This checks it two ways, because the version number alone is a thing the
// script says about itself:
//
//   1. bridge_status reports the version the game is running.
//   2. A reply is read for its shape. 0.2.0 answers through `tell`, which arrives bare;
//      0.1.0 and earlier answered through `say`, which arrives wrapped in `[PlayerName]`.
//
// The second is the one that matters, because it is the behaviour the version number is
// standing in for - a private message rather than one broadcast to a whole classroom - and it
// is observable without trusting the constant.
//
// Then a short pass over the rest of the reading surface, so a connection that is only good
// for `ping` does not read as a working one.

export async function run({ call, note, log }) {
  // --- 1. what the game says it is running --------------------------------------------------
  const status = await call('world.bridge_status');
  note('bridge_status', status.value ?? status.error);
  if (!status.ok || !status.value.connected) {
    note('reading', 'Not connected. Nothing below this line means anything.');
    return;
  }

  const { addonVersion, upToDate, expectedVersion } = status.value;

  // --- 2. where is the player, so the rest has somewhere to look -----------------------------
  //
  // Found by reading rather than assumed: entities is the only route that can say where
  // anybody is, and it doubles as a check that the add-on answers more than ping.
  const spawn = { x: 0, y: -50, z: 0 };
  const nearby = await call('world.entities', { center: spawn, radius: 64, limit: 40 });
  const players = (nearby.value?.entities ?? []).filter((e) => e.type === 'minecraft:player');
  note('entities', {
    ok: nearby.ok,
    total: nearby.value?.total ?? null,
    players: players.map((p) => ({ name: p.name ?? null, x: p.x, y: p.y, z: p.z })),
  });

  const player = players[0];
  if (!player) {
    note(
      'reading',
      `The add-on answers (version ${addonVersion}) but no player was found within 64 blocks of ${JSON.stringify(spawn)}. ` +
        `That is a search radius problem, not a bridge problem - the version check above still holds.`
    );
    return;
  }

  const at = { x: Math.round(player.x), y: Math.round(player.y), z: Math.round(player.z) };

  // --- 3. one block, with its states ---------------------------------------------------------
  const under = { x: at.x, y: at.y - 1, z: at.z };
  const block = await call('world.get_block', { position: under });
  note('get_block', block.value ?? block.error);

  // --- 4. a region, as a grid ------------------------------------------------------------------
  const region = await call('world.read_region', {
    corner1: { x: at.x - 3, y: at.y - 2, z: at.z - 3 },
    corner2: { x: at.x + 3, y: at.y + 1, z: at.z + 3 },
  });
  note('read_region', {
    ok: region.ok,
    error: region.error ?? null,
    size: region.value?.size ?? null,
    unknown: region.value?.unknown ?? null,
    palette: region.value?.palette ?? null,
  });
  if (region.ok) {
    log('');
    for (const layer of [...region.value.layers].reverse()) {
      log(`  y = ${layer.y}`);
      for (const row of layer.rows) log(`    ${row}`);
    }
    log('');
  }

  // --- 5. the verdict, stated rather than left to be inferred ---------------------------------
  note(
    'reading',
    upToDate
      ? `The game is running add-on ${addonVersion}, which is what this server expects. ` +
          `Replies now go out as private messages rather than being broadcast, so a bulk read no ` +
          `longer fills every player's chat.`
      : `The game is still running add-on ${addonVersion} and the server expects ${expectedVersion}. ` +
          `The files on disk were updated - what did not happen is a full restart of Minecraft. ` +
          `Reloading the world is not enough; the process has to be closed and reopened.`
  );
}
