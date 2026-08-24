// A dispatcher, not a rig.
//
// The runner decides which rig to load when the connection opens, and it cannot be told
// otherwise without restarting - which closes the socket, and the socket cannot be reopened
// on demand because `/connect out` does not actually disconnect. So changing rigs used to
// cost a reconnect that the game would not always give.
//
// This is loaded under a fixed name and then hands off to whatever active-rig.txt names,
// re-imported fresh each time. The rig can be swapped, and edited, while the game stays
// connected.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RIG = 'focus-then-battery';

export async function run(session, context) {
  let name = DEFAULT_RIG;
  try {
    const requested = fs.readFileSync(path.join(HERE, '..', 'active-rig.txt'), 'utf8').trim();
    // Naming this file would recurse forever; anything else is taken at its word.
    if (requested && requested !== 'a4-focus') name = requested;
  } catch {
    /* the default stands */
  }

  context.log(`dispatching to rig \`${name}\``);
  const rig = await import(`./${name}.mjs?t=${Date.now()}`);
  return rig.run(session, context);
}
