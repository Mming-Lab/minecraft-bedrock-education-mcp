/**
 * Where anybody is standing.
 *
 * Every other reading tool needs a place to look. `world.entities` searches around a point,
 * `world.read_region` takes two corners, `world.get_block` takes one position - and a model
 * that has just connected knows none of them. It cannot even ask where the player is, because
 * asking requires knowing roughly where to ask.
 *
 * That gap showed up the first time the tools were driven against a live game through MCP:
 * the scenario looked for a player within 64 blocks of the origin, found nothing, and could go
 * no further. The world is large and the origin is arbitrary.
 *
 * ## Why this goes through a command rather than the add-on
 *
 * `querytarget` answers with a JSON array of positions, and it needs no add-on at all. That
 * matters more than it looks: this is the tool someone reaches for when nothing else is
 * working, and making it depend on the piece most likely to be missing would be the same
 * mistake as a diagnostic that fails when the thing it diagnoses is broken.
 *
 * What it does not give is names. `querytarget` reports position, rotation and a uniqueId, and
 * nothing that says who. A caller that needs the name reads `world.entities` around the
 * position this returns - name tags come back there.
 */

import { z } from 'zod';
import type { CommandRunner } from '../bridge/index.js';
import { defineTool, type AnyToolDefinition } from './types.js';

/** One entry of `querytarget`'s reply, as the game formats it. */
interface QueryTargetEntry {
  position?: { x?: number; y?: number; z?: number };
  uniqueId?: string;
  yRot?: number;
  dimension?: number;
}

/** Which dimension a number means, in the order the game numbers them. */
const DIMENSION_NAMES = ['overworld', 'nether', 'the_end'] as const;

export const worldPlayersTool = (runner: CommandRunner) =>
  defineTool({
    name: 'world.players',
    title: 'Where the players are',
    description: [
      'List every player in the world with their position — the starting point for everything else.',
      'Call this first in a fresh session: world.read_region, world.get_block and world.entities all need somewhere to look, and nothing else can tell you where that is.',
      'Positions are exact, so round them to whole numbers before using them as block coordinates.',
      'It does not return names. If you need to know who is who, read world.entities around one of these positions — name tags come back there.',
      'Do NOT poll it while building. Positions move constantly, and a build placed relative to a position read three commands ago lands somewhere nobody asked for; read it once, decide the coordinates, and build against those.',
      'It needs no add-on, so it also works as a check that commands are reaching the game at all.',
    ].join(' '),
    inputSchema: {},
    outputSchema: {
      players: z
        .array(
          z.object({
            x: z.number(),
            y: z.number(),
            z: z.number(),
            dimension: z.string().describe('overworld, nether or the_end.'),
            facing: z.number().describe('Rotation in degrees. 0 is south, 90 is west.'),
            uniqueId: z.string().describe('Stable within a session. Not a name.'),
          })
        )
        .describe('Everyone currently in the world. Empty only if nobody is connected.'),
      count: z.number().int(),
    },
    annotations: { readOnlyHint: true },
    handler: async () => {
      const outcome = await runner.run('querytarget @a');

      // The answer is in `details`, as a JSON string. Not in `statusMessage` - that carries the
      // same JSON with a translated sentence in front of it ("対象となるデータ: [...]"), which is
      // why the message is not what gets parsed.
      const details = outcome.data['details'];
      if (typeof details !== 'string') {
        throw new Error(
          `querytarget answered without a "details" field. The game said: ${outcome.statusMessage || '(nothing)'}`
        );
      }

      let entries: unknown;
      try {
        entries = JSON.parse(details);
      } catch {
        throw new Error(`querytarget's reply was not JSON: ${details.slice(0, 120)}`);
      }
      if (!Array.isArray(entries)) {
        throw new Error('querytarget answered with something other than a list of targets');
      }

      const players = entries.flatMap((entry) => {
        const { position, uniqueId, yRot, dimension } = entry as QueryTargetEntry;
        // Skipped rather than defaulted to the origin: a player at 0,0,0 and a player whose
        // position did not arrive are different things, and one of them is a real place.
        if (position?.x === undefined || position.y === undefined || position.z === undefined) return [];
        return [
          {
            x: position.x,
            y: position.y,
            z: position.z,
            dimension: DIMENSION_NAMES[dimension ?? 0] ?? `dimension ${dimension}`,
            facing: yRot ?? 0,
            uniqueId: uniqueId ?? 'unknown',
          },
        ];
      });

      return { players, count: players.length };
    },
  });

export function playerTools(runner: CommandRunner): AnyToolDefinition[] {
  return [worldPlayersTool(runner)] as unknown as AnyToolDefinition[];
}
