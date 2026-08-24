// A-11: does `/structure save` write to the database immediately?
//
// A placed block took 25.4 seconds to reach disk, which is fine for surveying and useless for
// checking your own work. But a structure save is a different kind of write: it creates a
// world-level key, `structuretemplate_mystructure:<name>`, rather than editing a chunk. If
// that key lands at once, the model has an on-demand flush - ask for a structure, read it
// straight back, and get exact block data with states and no waiting.
//
// The 64-block-per-axis cap stops that being a whole-world read, but nothing stops issuing
// several of them to cover a larger region, which is the shape the idea would take.
//
// Saves under a fresh name every run, since a key that is already there proves nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function run(session, { log }) {
  let name = 'zzflush_default';
  try {
    name = fs.readFileSync(path.join(HERE, '..', 'flush-name.txt'), 'utf8').trim() || name;
  } catch {
    /* the default stands */
  }

  const at = Date.now();
  const reply = await session.command(`structure save ${name} ~ ~-1 ~ ~2 ~-1 ~2 disk`, { timeout: 10000 });
  session.note('structure_name', name);
  session.note('saved_at_epoch_ms', at);
  session.note('save_reply', {
    code: reply.body?.statusCode ?? null,
    message: (reply.body?.statusMessage ?? '').replace(/§./g, ''),
  });
  log(`structure ${name} saved at ${new Date(at).toISOString()}`);
}
