// A-10: place one distinctive block, and note exactly when.
//
// Paired with dbwatch.mjs, which is already polling for it. The pair measures the one thing
// that decides whether reading the world database is a live view or an archive: how long an
// edit takes to reach disk.
//
// The block name comes from flush-block.txt rather than the environment, because a rig runs
// inside the long-lived runner process and never sees a variable set on the command that
// triggers it - a mistake that cost one silent 90-second timeout, placing lapis again while
// the watcher waited for iron.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function run(session, { log }) {
  let block = 'minecraft:lapis_block';
  try {
    const named = fs.readFileSync(path.join(HERE, '..', 'flush-block.txt'), 'utf8').trim();
    if (named) block = named;
  } catch {
    /* the default stands */
  }

  const placedAt = Date.now();
  const reply = await session.command(`setblock ~3 ~-1 ~3 ${block} replace`, { timeout: 8000 });
  session.note('block', block);
  session.note('placed_at_epoch_ms', placedAt);
  session.note('setblock', { code: reply.body?.statusCode ?? null, message: (reply.body?.statusMessage ?? '').replace(/§./g, '') });
  log(`${block} placed at ${new Date(placedAt).toISOString()}`);
}
