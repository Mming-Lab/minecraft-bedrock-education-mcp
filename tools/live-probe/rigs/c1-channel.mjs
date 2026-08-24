// C-1: can the chat spam be got rid of without changing the transport?
//
// The bridge answers through chat, because that is the only path a script has that reaches
// the socket. The cost is that a 4096-block read puts 172 lines in front of everyone in the
// world, which in a classroom is the whole chat gone. That is the design's one real problem.
//
// Two candidates, both of which the add-on can drive itself:
//
//   tell @s   private to one player rather than broadcast - if it still fires PlayerMessage
//   hud       hides the chat element, leaving the transport exactly as it is
//
// Neither is guessable from outside. `say` reaches the socket and `world.sendMessage` does
// not, and nothing about either would have told you which; `tell` could go the same way as
// sendMessage. So both get sent, tagged, and the far end reports what arrived.

const lines = (session, from) => session.events.slice(from).map((e) => e.event?.message ?? '');
const find = (session, from, needle) => lines(session, from).find((m) => m.includes(needle)) ?? null;

export async function run(session, { log }) {
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(800);

  const ping = session.events.length;
  await session.command('scriptevent mcp:ping p {}', { timeout: 8000 });
  await session.wait(2000);
  if (!find(session, ping, 'MCPB|p|')) {
    session.note('reading', 'The bridge did not answer. Reload the world so the updated script loads.');
    log('STOPPING: ' + session.notes.reading);
    return;
  }

  // --- does tell reach the socket at all? -------------------------------------------------
  const plain = session.events.length;
  await session.command('scriptevent mcp:channel c1 {"chars":200}', { timeout: 8000 });
  await session.wait(3000);

  const sayArrived = find(session, plain, 'c1.say|');
  const tellArrived = find(session, plain, 'c1.tell|');
  session.note('summary', find(session, plain, 'MCPB|c1|'));
  session.note('say_reaches_socket', !!sayArrived);
  session.note('tell_reaches_socket', !!tellArrived);
  log(`  say:  ${sayArrived ? 'arrived' : 'NOT delivered'}`);
  log(`  tell: ${tellArrived ? 'arrived' : 'NOT delivered'}`);

  // --- does tell have the same ceiling? ---------------------------------------------------
  if (tellArrived) {
    let ok = 200;
    let bad = 900;
    for (let step = 0; step < 5 && bad - ok > 30; step++) {
      const chars = Math.floor((ok + bad) / 2);
      const at = session.events.length;
      await session.command(`scriptevent mcp:channel t${chars} {"chars":${chars}}`, { timeout: 8000 });
      await session.wait(2500);
      if (find(session, at, `t${chars}.tell|`)) ok = chars;
      else bad = chars;
    }
    session.note('tell_line_limit', { longestThatArrives: ok, shortestThatDoesNot: bad });
    log(`  tell ceiling: ${ok} chars (say measured 481)`);
  }

  // --- does hiding the chat break delivery? -----------------------------------------------
  //
  // The important question is not whether /hud is accepted but whether the lines still reach
  // the socket while the chat is hidden. If they do, the transport never has to change.
  const hidden = session.events.length;
  await session.command('scriptevent mcp:channel h1 {"chars":200,"hide":true}', { timeout: 8000 });
  await session.wait(3000);

  session.note('hide_summary', find(session, hidden, 'MCPB|h1|'));
  session.note('say_survives_hidden_chat', !!find(session, hidden, 'h1.say|'));
  session.note('tell_survives_hidden_chat', !!find(session, hidden, 'h1.tell|'));
  log(`  with chat hidden - say: ${find(session, hidden, 'h1.say|') ? 'still arrives' : 'LOST'}`);

  const hudWorks = session.notes.say_survives_hidden_chat;
  session.note('reading',
    hudWorks
      ? 'Lines still reach the socket while the chat is hidden, so /hud answers the visibility problem without touching the transport. Hide it for the duration of a bulk read and put it back.'
      : session.notes.tell_reaches_socket
        ? 'Hiding the chat stops delivery, but tell reaches the socket - so a private message is the way to keep it off everyone else\'s screen.'
        : 'Neither hiding nor tell helps: say is the only channel and it is public. Bulk reads should go to the world file instead, and the add-on kept for point queries.');
  log('');
  log(session.notes.reading);
}
