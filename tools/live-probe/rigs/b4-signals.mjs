// B-4: does a script run, checked four ways instead of one?
//
// Every verdict about the Script API so far has rested on chat arriving, and chat is exactly
// the channel that might be broken. `/function`'s `say` reached the socket - but that is the
// *command* path, while the probes were calling `world.sendMessage`, which is the *API* path.
// They are not the same, and I have twice today read a detection failure as a missing
// feature.
//
// So each probe now sends four signals, and this checks all of them:
//
//   MCPAPI   world.sendMessage             the API path
//   MCPCMD   runCommand('say ...')         the command path, known to reach the socket
//   block    runCommand('setblock ...')    readable by command, no chat involved
//   property setDynamicProperty            stored in the world file, no chat involved
//
// Twelve packs, one @minecraft/server version each, one block coordinate each. Whichever
// coordinate has a block names the version that runs.
//
// The interesting outcome is not just yes or no. If MCPCMD arrives and MCPAPI does not, then
// scripts run, world.sendMessage does not reach the socket, and the bridge should answer
// through runCommand instead - which would make the whole add-on route viable after all.

const VERSIONS = ['1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0', '1.17.0', '1.18.0', '2.0.0', '2.1.0'];
const blockX = (i) => 200 + i * 2;

const say = (r) => (r.body?.statusMessage ?? '').replace(/§./g, '');
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

export async function run(session, { log }) {
  const before = session.events.length;
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(1000);
  session.note('chat_reaches_the_socket', session.events.length > before);

  // Anything the probes said on load, before this rig connected, is already gone - so ask
  // again now that someone is listening.
  const askedAt = session.events.length;
  const ping = await session.command('scriptevent mcp:ping p 1', { timeout: 8000 });
  session.note('scriptevent', { code: ping.body?.statusCode ?? null, message: say(ping) });
  await session.wait(3000);

  const messages = session.events.slice(askedAt).map((e) => JSON.stringify(e));
  const apiLines = messages.filter((m) => m.includes('MCPAPI'));
  const cmdLines = messages.filter((m) => m.includes('MCPCMD'));

  session.note('api_path_arrived', apiLines.length);
  session.note('command_path_arrived', cmdLines.length);
  session.note('api_sample', apiLines.slice(0, 3));
  session.note('command_sample', cmdLines.slice(0, 3));

  // --- the block, which needs no chat at all ---------------------------------------------
  //
  // Checked with testforblock rather than read from the world file, because the file lags by
  // about 25 seconds and this has to be answerable now.
  const placed = [];
  for (let i = 0; i < VERSIONS.length; i++) {
    const reply = await session.command(`testforblock ${blockX(i)} -50 200 minecraft:lapis_block`, { timeout: 6000 });
    if (accepted(reply)) placed.push(VERSIONS[i]);
  }
  session.note('versions_that_placed_a_block', placed);

  // --- the dynamic property, also chat-free ----------------------------------------------
  //
  // Nothing reads dynamic properties over the socket, so this is only recoverable from the
  // world file later. Recorded as a note that it was attempted.
  session.note('dynamic_property_checked_where', 'world file, after the next save');

  const ranAtAll = placed.length > 0 || cmdLines.length > 0 || apiLines.length > 0;
  session.note(
    'reading',
    !ranAtAll
      ? 'Nothing at all: no chat on either path, and no block placed by any of twelve versions. Scripts are not executing, and this is no longer a detection problem - three independent channels were watched.'
      : placed.length && !apiLines.length && cmdLines.length
        ? `Scripts run (${placed.join(', ')} placed blocks) and answer through runCommand, but world.sendMessage does not reach the socket. The bridge should answer with runCommand('say ...') - the add-on route is open.`
        : placed.length && apiLines.length
          ? `Scripts run and both output paths work. Versions: ${placed.join(', ')}.`
          : `Partial: blocks from ${placed.join(', ') || 'none'}, ${apiLines.length} API lines, ${cmdLines.length} command lines. Read the samples.`
  );

  log('');
  log(session.notes.reading);
}
