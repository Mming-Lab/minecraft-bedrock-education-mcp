// A-8: what does a bare number mean in a getchunkdata entry?
//
// The encoding is otherwise settled. Entries are comma separated; `*N` adds N more of the
// preceding entry (224+1 + 1 + 13+1 + 3+1 + 11+1 = 256, and the wiki's own `AAAAAA*255`
// only reaches 256 read this way); a 6-character entry is three bytes of map colour and one
// of height, with y = byte - 255; and `ff 00 ff` height 64 is the sentinel for "nothing
// found below the given y".
//
// What is left is the bare numbers - `0*13`, and in the wiki's example `171*4` and `216`.
// The last live chunk could not separate the two readings, because the only number in it was
// `0` and the first literal in that chunk was also its most common value: "index 0 of the
// dictionary" and "same as the previous entry" name the same thing there.
//
// So this builds a chunk that tells them apart. Three materials in a deliberate order:
//
//     A A A ... B C A A A ...
//
// If a number is a dictionary index, the trailing A columns encode as the index of A, which
// was the FIRST literal. If it means "repeat the previous entry", the trailing run cannot be
// a number at all, because the entry before it is C - it would have to repeat C, which is
// wrong, so a fresh literal for A must appear instead.
//
// One read decides it.

const body = (r) => (r.timedOut ? null : (r.body ?? null));
const accepted = (r) => !r.timedOut && (r.body?.statusCode ?? -1) >= 0;

async function announce(session, text) {
  await session.command(`say §b[probe]§r ${text}`, { timeout: 3000 });
}

export async function run(session, { log }) {
  await announce(session, 'dictionary experiment - about a minute.');

  const target = await session.command('querytarget @s', { timeout: 8000 });
  let at = null;
  try {
    at = JSON.parse(body(target).details)[0].position;
    at = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
  } catch {
    /* recorded as null */
  }
  const chunkX = at ? at.x >> 4 : 0;
  const chunkZ = at ? at.z >> 4 : 0;
  session.note('chunk', { chunkX, chunkZ });

  const top = await session.command(`gettopsolidblock ${chunkX * 16 + 8} 320 ${chunkZ * 16 + 8}`, { timeout: 8000 });
  const surfaceY = body(top)?.position?.y ?? null;
  session.note('surface_y', surfaceY);
  if (surfaceY === null) {
    session.note('reading', 'could not find the surface, so nothing was built or read');
    return;
  }

  const readRaw = async () => {
    const reply = await session.command(`getchunkdata overworld ${chunkX} ${chunkZ} 320`, { timeout: 8000 });
    return accepted(reply) ? body(reply).data : { error: body(reply) };
  };

  session.note('before', await readRaw());

  // The chunk's own coordinates, so the columns land where the read will see them. Columns
  // are laid out along one row; which row does not matter, only that A comes back after C.
  const x0 = chunkX * 16;
  const z0 = chunkZ * 16;
  const y = surfaceY + 1;

  // Two lone markers in the middle of a row that is otherwise the untouched surface. Their
  // colours have to be distinct from the terrain and from each other.
  await session.command(`setblock ${x0 + 7} ${y} ${z0 + 7} minecraft:gold_block replace`);
  await session.command(`setblock ${x0 + 8} ${y} ${z0 + 7} minecraft:redstone_block replace`);
  await session.wait(700);

  const after = await readRaw();
  session.note('after', after);

  // Read off the shape rather than asserting a conclusion: how many literals, how many bare
  // numbers, and what the numbers are. The two readings predict different answers.
  if (typeof after === 'string') {
    const entries = after.replace(/^"|"$/g, '').split(',');
    const parsed = entries.map((e) => {
      const [value, extra] = e.split('*');
      return { value, count: extra === undefined ? 1 : Number(extra) + 1, numeric: /^\d+$/.test(value) };
    });
    session.note('entry_count', parsed.reduce((n, e) => n + e.count, 0));
    session.note('entries', parsed);
    session.note('literals_in_order', [...new Set(parsed.filter((e) => !e.numeric).map((e) => e.value))]);
    session.note('numbers_used', [...new Set(parsed.filter((e) => e.numeric).map((e) => e.value))]);

    // The discriminating question, phrased as something observable: does any bare number sit
    // immediately after an entry that is NOT the value that number would have to mean under
    // the repeat-the-previous reading?
    const firstLiteral = parsed.find((e) => !e.numeric)?.value ?? null;
    const numberAfterDifferentLiteral = parsed.some((e, i) => {
      if (!e.numeric || i === 0) return false;
      const previous = parsed[i - 1];
      return !previous.numeric && previous.value !== firstLiteral;
    });
    session.note('first_literal', firstLiteral);
    session.note(
      'reading',
      numberAfterDifferentLiteral
        ? 'A bare number follows a literal that is not the first one, so it cannot mean "repeat the previous entry" - it is an index into the values seen so far.'
        : 'Every bare number still follows the first literal, so this build did not separate the two readings. Read `entries` and try a layout that puts a number after a different literal.'
    );
  }

  await announce(session, '§aDONE§r - you can alt-tab now.');
  log('');
  log(session.notes.reading ?? 'no reading');
}
