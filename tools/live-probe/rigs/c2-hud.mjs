// C-2: what does /hud actually take, and does hiding survive delivery?
//
// The last run got two things and I reported three. `tell @s` reaches the socket with a
// 484-character ceiling - real, and it solves most of the problem, because a private message
// is never sent to the rest of the class in the first place. `hud @s hide chat` is a syntax
// error: `chat` is not an element name in this build.
//
// The rig then reported "lines still reach the socket while the chat is hidden". The chat was
// never hidden. It checked whether the lines arrived without checking whether the hide had
// happened, so the conclusion was drawn from a condition that never held - the same mistake
// as reading silence for absence, one layer up.
//
// So: ask the game for the grammar rather than guessing another element name, and only then
// test delivery-while-hidden, with the hide verified first.

const lines = (session, from) => session.events.slice(from).map((e) => e.event?.message ?? '');
const find = (session, from, needle) => lines(session, from).find((m) => m.includes(needle)) ?? null;
const say = (r) => (r.body?.statusMessage ?? '').replace(/§./g, '');
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

export async function run(session, { log }) {
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(800);

  // --- the grammar, from the game --------------------------------------------------------
  const help = await session.command('help hud', { timeout: 8000 });
  session.note('help_hud', say(help));
  log('  /help hud:');
  for (const line of say(help).split('\n')) log('    ' + line);

  // Element names are an enum, so a wrong one is a parse error naming the offending word -
  // which is itself a way to enumerate them.
  const candidates = ['chat', 'hotbar', 'crosshair', 'paperdoll', 'armor', 'health', 'progress_bar', 'hunger', 'air_bubbles', 'horse_health', 'status_effects', 'item_text', 'all'];
  const usable = [];
  for (const element of candidates) {
    const reply = await session.command(`hud @s hide ${element}`, { timeout: 5000 });
    if (accepted(reply)) {
      usable.push(element);
      await session.command(`hud @s reset ${element}`, { timeout: 5000 });
    }
  }
  session.note('hud_elements_accepted', usable);
  log(`  elements accepted: ${usable.join(', ') || 'none'}`);

  // --- does hiding actually stop delivery? ------------------------------------------------
  //
  // Only asked for elements the game accepted, and the acceptance is checked before the
  // delivery result is read - which is exactly what the last rig failed to do.
  for (const element of usable.filter((e) => e === 'chat' || e === 'all')) {
    const hide = await session.command(`hud @s hide ${element}`, { timeout: 6000 });
    if (!accepted(hide)) {
      session.note(`hide_${element}`, 'refused: ' + say(hide));
      continue;
    }
    const from = session.events.length;
    await session.command('scriptevent mcp:channel hd {"chars":200}', { timeout: 8000 });
    await session.wait(3000);
    session.note(`delivery_while_${element}_hidden`, {
      hideAccepted: true,
      say: !!find(session, from, 'hd.say|'),
      tell: !!find(session, from, 'hd.tell|'),
    });
    await session.command(`hud @s reset ${element}`, { timeout: 5000 });
    log(`  hidden ${element}: say ${find(session, from, 'hd.say|') ? 'arrives' : 'LOST'}`);
  }

  const hidable = usable.includes('chat') || usable.includes('all');
  session.note('reading',
    hidable
      ? `The chat can be hidden (${usable.filter((e) => e === 'chat' || e === 'all').join(', ')}); see delivery_while_*_hidden for whether lines still arrive.`
      : `No element hides the chat - accepted names were: ${usable.join(', ') || 'none'}. So the operator's own screen cannot be cleared this way, and tell @s is the whole answer: private, 484 characters, and never sent to the rest of the class.`);
  log('');
  log(session.notes.reading);
}
