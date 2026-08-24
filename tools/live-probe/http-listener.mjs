// The other end of the @minecraft/server-net probe.
//
//   node http-listener.mjs [--port 19132]
//
// If a script inside the game can POST here, HTTP is the better channel and the design should
// use it. The one in use now - `/scriptevent` in, `world.sendMessage` out - works, but the
// return path is the player's chat: every reply is visible in game, a chat line has a length
// limit, and a region read becomes a hundred of them.
//
// Anything that arrives is printed whole. A request that never comes is the answer too: the
// module is refused on this build, and the chat channel stays.

import http from 'node:http';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const PORT = Number(portIndex >= 0 ? args[portIndex + 1] : 19132);

const started = Date.now();
const log = (...parts) => console.log(`[${String(Date.now() - started).padStart(6)}ms]`, ...parts);

let count = 0;

const server = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    count++;
    const body = Buffer.concat(chunks).toString();
    log(`#${count} ${request.method} ${request.url} from ${request.socket.remoteAddress}`);
    log(`   headers: ${JSON.stringify(request.headers)}`);
    log(`   body: ${body || '(empty)'}`);

    // A recognisable reply, so the game side can prove it read the response and not just that
    // the request left.
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, seen: count, echo: body.slice(0, 100) }));
  });
});

server.on('error', (error) => {
  console.error(`\nlistener error: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log(`  HTTP listener on 127.0.0.1:${PORT}`);
  console.log('');
  console.log('  Waiting for a POST from inside Minecraft.');
  console.log('  Nothing arriving means @minecraft/server-net is refused on this build,');
  console.log('  which is the expected answer for a client rather than a dedicated server.');
  console.log('');
});
