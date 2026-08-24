// B-6: where exactly is the line-length ceiling, and what does a full chunk cost?
//
// The bridge works and the shape of its limit is known: 300-character lines all arrive, 600
// arrive not at all, and 200 lines in a burst lose nothing. So the constraint is line length,
// not line count - which is the good case, because a long read can be split into more lines
// but cannot be made to fit in a wider one.
//
// Two numbers finish the design. The exact ceiling, so a splitter can pack to just under it.
// And the wall-clock cost of a 16x16x16 region - 4096 blocks - which is the unit a build tool
// actually reads.

const collect = (session, from, needle) =>
  session.events.slice(from).map((e) => e.event?.message ?? '').filter((m) => m.includes(needle));

export async function run(session, { log }) {
  await session.command('say probe: chat control', { timeout: 6000 });
  await session.wait(800);

  // --- the ceiling, by bisection ----------------------------------------------------------
  let ok = 300;
  let bad = 700;
  const tried = {};
  for (let step = 0; step < 7 && bad - ok > 8; step++) {
    const chars = Math.floor((ok + bad) / 2);
    const from = session.events.length;
    await session.command(`scriptevent mcp:bench L${chars} {"count":3,"chars":${chars}}`, { timeout: 8000 });
    await session.wait(2500);
    const arrived = collect(session, from, `L${chars}.`).length;
    tried[chars] = arrived;
    log(`  ${chars} chars: ${arrived} of 3 arrived`);
    if (arrived === 3) ok = chars;
    else bad = chars;
  }
  session.note('line_length_tried', tried);
  session.note('longest_line_that_arrives', ok);
  session.note('shortest_line_that_does_not', bad);

  // --- a full subchunk ---------------------------------------------------------------------
  //
  // 4096 blocks, packed to sit under the ceiling just measured. The reply says how many parts
  // to expect, so arrival can be checked rather than assumed.
  const target = await session.command('querytarget @s', { timeout: 6000 });
  let at = null;
  try {
    const p = JSON.parse(target.body.details)[0].position;
    at = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  } catch { /* recorded null */ }

  if (at) {
    const perMessage = 24;
    const from = session.events.length;
    const startedAt = Date.now();
    await session.command(
      `scriptevent mcp:readregion R {"x1":${at.x - 8},"y1":${at.y - 8},"z1":${at.z - 8},"x2":${at.x + 7},"y2":${at.y + 7},"z2":${at.z + 7},"perMessage":${perMessage}}`,
      { timeout: 15000 }
    );

    // Poll until the parts stop arriving, so the timing is the read's rather than a fixed wait.
    let lines = 0;
    let quiet = 0;
    while (quiet < 6) {
      await session.wait(500);
      const now = collect(session, from, 'MCPB|R').length;
      if (now === lines) quiet++;
      else { quiet = 0; lines = now; }
    }
    const ms = Date.now() - startedAt;

    const header = collect(session, from, 'MCPB|R|')[0] ?? null;
    let expected = null;
    try { expected = JSON.parse(header.slice(header.indexOf('{'))).parts + 1; } catch { /* null */ }

    session.note('region_16x16x16', {
      blocks: 4096,
      perMessage,
      expectedLines: expected,
      linesArrived: lines,
      complete: expected !== null && lines >= expected,
      ms,
    });
    session.note('region_header', header);
    log(`  16^3: ${lines} of ${expected} lines in ${ms}ms`);
  }

  const region = session.notes.region_16x16x16;
  session.note('reading',
    `Lines up to ${ok} characters arrive; ${bad} do not. ` +
    (region
      ? `A 4096-block region came back as ${region.linesArrived} lines in ${region.ms}ms, ${region.complete ? 'complete' : 'INCOMPLETE'}.`
      : 'region not measured.'));
  log('');
  log(session.notes.reading);
}
