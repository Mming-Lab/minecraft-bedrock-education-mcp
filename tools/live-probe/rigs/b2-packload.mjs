// B-2: are behavior packs loading at all, or is it scripting specifically that is blocked?
//
// Fifteen packs are listed as active on the world - the game kept every one of them and
// rewrote the file in its own formatting, so the entries are being read. Twelve of them
// declare a different @minecraft/server version each, from 1.9.0 to 2.1.0, and not one has
// ever said a word. Twelve versions failing the same way is not a version problem.
//
// So the question moves up a level, and it needs a probe with no script in it. A behavior
// pack can carry a .mcfunction, which is content rather than code:
//
//   /function mcpprobe  runs   -> packs load here; scripting is what is blocked
//   /function mcpprobe  fails  -> the packs are not loading, whatever the file says
//
// The distinction decides whether the add-on route is worth any more time. If content loads
// and scripts do not, that is a policy in Education Edition and no manifest will get around
// it. If nothing loads, the packs are being installed the wrong way and that is fixable.

const say = (r) => (r.body?.statusMessage ?? '').replace(/§./g, '');
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

export async function run(session, { log }) {
  // The control. Without it an empty chat log means nothing, which is a mistake this rig's
  // predecessor made twice before the channel was proved.
  const before = session.events.length;
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(1200);
  session.note('chat_reaches_the_socket', session.events.length > before);

  if (session.events.length === before) {
    session.note('reading', 'The chat channel is not delivering, so nothing below can be read. Fix that first.');
    log('STOPPING: ' + session.notes.reading);
    return;
  }

  // --- does pack CONTENT load? -----------------------------------------------------------
  const fnBefore = session.events.length;
  const fn = await session.command('function mcpprobe', { timeout: 8000 });
  await session.wait(1500);
  const fnMessages = session.events.slice(fnBefore).map((e) => JSON.stringify(e));

  session.note('function_command', { code: fn.body?.statusCode ?? null, message: say(fn) });
  session.note('function_ran', fnMessages.some((m) => m.includes('MCPFN')));
  session.note('function_messages', fnMessages.slice(0, 3));

  // --- does any SCRIPT run? --------------------------------------------------------------
  const scriptBefore = session.events.length;
  await session.command('scriptevent mcp:ping p 1', { timeout: 8000 });
  await session.wait(2000);
  const scriptMessages = session.events.slice(scriptBefore).map((e) => JSON.stringify(e));

  session.note('script_answered', scriptMessages.some((m) => m.includes('MCPB') || m.includes('MCPNET')));
  session.note('script_messages', scriptMessages.slice(0, 5));

  // --- what that means, and only that ----------------------------------------------------
  const content = session.notes.function_ran;
  const script = session.notes.script_answered;

  session.note(
    'reading',
    content && script
      ? 'Both content and scripts run. The add-on route is open; measure the channel next.'
      : content && !script
        ? 'Pack content loads - /function ran - but no script answered, across twelve declared module versions. That is scripting being disabled rather than a manifest being wrong, and no version or dependency change will move it. Look for a setting that governs the Script API specifically, or accept that Education Edition does not run custom scripts and keep the world-file path.'
        : !content && !script
          ? 'Neither the function nor any script ran, so these packs are not being loaded at all - the world lists them as active but nothing in them is live. That is an installation problem, not a scripting one: development_behavior_packs plus a hand-written world_behavior_packs.json may not be how this build takes packs. Importing a .mcaddon through the game would be the next thing to try.'
          : 'A script answered but /function did not, which is backwards and worth reading the raw messages over.'
  );

  log('');
  log(session.notes.reading);
}
