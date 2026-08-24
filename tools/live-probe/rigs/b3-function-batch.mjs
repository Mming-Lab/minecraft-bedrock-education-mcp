// B-3: how much work fits in one /function call?
//
// The Script API is gated shut on this build - pack content loads, script modules never run,
// across twelve declared versions - and the setting that would open it is not in the game's
// UI. Rather than keep pushing on that, this measures the channel that does work.
//
// `/function` runs a .mcfunction from a behavior pack, and it ran here. The server and the
// game share a machine (D-13), so the file can be written from outside and then called over
// the socket that already exists. If a function can hold a thousand commands, a build that
// costs a thousand round trips today costs one.
//
// The same trick reads: a generated function full of `execute if block ... run say` emits its
// answers as chat lines, which arrive as PlayerMessage frames. One request, many answers.
//
// What has to be true, and none of it is known yet:
//
//   1. /reload picks up a file written after the world loaded
//   2. a function can be long - hundreds or thousands of lines
//   3. it executes fast enough to be worth the round trip it saves
//   4. its chat output all arrives, rather than being dropped or rate limited
//
// Writes blocks in a column beside the player and clears up after itself.

import fs from 'node:fs';
import path from 'node:path';

const PACK_FUNCTIONS = String.raw`C:\Users\TK20004_user\AppData\Local\Packages\Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe\LocalState\games\com.mojang\development_behavior_packs\mcp-fn\functions`;

const say = (r) => (r.body?.statusMessage ?? '').replace(/§./g, '');
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

function writeFunction(name, lines) {
  fs.mkdirSync(PACK_FUNCTIONS, { recursive: true });
  fs.writeFileSync(path.join(PACK_FUNCTIONS, `${name}.mcfunction`), lines.join('\n') + '\n', 'utf8');
}

export async function run(session, { log }) {
  const before = session.events.length;
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(1000);
  if (session.events.length === before) {
    session.note('reading', 'chat is not being delivered; nothing below can be read');
    return;
  }
  session.note('chat_reaches_the_socket', true);

  // --- 1. does /reload see a file written just now? --------------------------------------
  //
  // Everything else depends on this. If a function has to exist before the world loads, the
  // channel is only useful for work known in advance, which is not the interesting case.
  const marker = `mcpgen${Date.now().toString().slice(-6)}`;
  writeFunction(marker, ['say MCPGEN|' + marker + '|written after the world loaded']);

  const beforeReload = session.events.length;
  const reload = await session.command('reload', { timeout: 20000 });
  session.note('reload', { code: reload.body?.statusCode ?? null, message: say(reload) });
  await session.wait(2500);

  const call = await session.command(`function ${marker}`, { timeout: 10000 });
  await session.wait(1500);
  const generatedRan = session.events.slice(beforeReload).some((e) => JSON.stringify(e).includes(marker));

  session.note('generated_function_call', { code: call.body?.statusCode ?? null, message: say(call) });
  session.note('reload_picks_up_new_files', generatedRan);

  if (!generatedRan) {
    session.note(
      'reading',
      'A function written after the world loaded did not run, even after /reload. The channel still works for functions shipped with the pack, but not for work generated on demand - which is the case that matters. Check whether /reload reported an error above.'
    );
    log('STOPPING: ' + session.notes.reading);
    return;
  }

  // --- 2. how long can a function be? ----------------------------------------------------
  const base = { x: 40, y: -60, z: 40 };
  for (const size of [100, 1000, 5000]) {
    const lines = [];
    for (let i = 0; i < size; i++) {
      const x = base.x + (i % 50);
      const z = base.z + Math.floor(i / 50) % 50;
      const y = base.y + Math.floor(i / 2500);
      lines.push(`setblock ${x} ${y} ${z} minecraft:stone replace`);
    }
    const name = `mcpbulk${size}`;
    writeFunction(name, lines);
    await session.command('reload', { timeout: 20000 });
    await session.wait(2000);

    const startedAt = Date.now();
    const reply = await session.command(`function ${name}`, { timeout: 60000 });
    const ms = Date.now() - startedAt;
    session.note(`batch_${size}`, {
      commands: size,
      ms,
      perCommandMs: Math.round((ms / size) * 1000) / 1000,
      accepted: accepted(reply),
      message: say(reply),
    });
    log(`  ${size} commands: ${ms}ms  (${say(reply)})`);
    if (!accepted(reply)) break;
  }

  // --- 3. how many answers can one function send back? ------------------------------------
  //
  // The read direction. A function cannot return a value, but it can talk, and chat arrives
  // over the socket - so the question is how much of it survives.
  for (const size of [50, 200, 500]) {
    const lines = [];
    for (let i = 0; i < size; i++) lines.push(`say MCPOUT|${size}|${i}`);
    const name = `mcpout${size}`;
    writeFunction(name, lines);
    await session.command('reload', { timeout: 20000 });
    await session.wait(2000);

    const from = session.events.length;
    const startedAt = Date.now();
    await session.command(`function ${name}`, { timeout: 60000 });
    await session.wait(5000);
    const arrived = session.events.slice(from).filter((e) => JSON.stringify(e).includes(`MCPOUT|${size}|`)).length;

    session.note(`chat_out_${size}`, { sent: size, arrived, lost: size - arrived, ms: Date.now() - startedAt });
    log(`  ${size} chat lines: ${arrived} arrived, ${size - arrived} lost`);
  }

  // Tidy up the test column.
  writeFunction('mcpclean', [`fill ${base.x} ${base.y} ${base.z} ${base.x + 49} ${base.y + 1} ${base.z + 49} minecraft:air replace`]);
  await session.command('reload', { timeout: 20000 });
  await session.wait(1500);
  await session.command('function mcpclean', { timeout: 30000 });

  const write = session.notes.batch_1000 ?? session.notes.batch_100;
  const read = session.notes.chat_out_200 ?? session.notes.chat_out_50;
  session.note(
    'reading',
    `Writing: ${write ? `${write.commands} commands in ${write.ms}ms` : 'not measured'}. ` +
      `Reading: ${read ? `${read.arrived} of ${read.sent} chat lines arrived` : 'not measured'}. ` +
      'Compare against one socket round trip per command, which is what the tools do today.'
  );

  log('');
  log(session.notes.reading);
}
