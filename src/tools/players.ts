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

export interface LocatedEntity {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dimension: string;
  readonly facing: number;
  readonly uniqueId: string;
}

/**
 * Reads the positions out of a `querytarget` reply, or says why it could not.
 *
 * `null` means the game answered without a `details` field, which is what happens when the
 * selector matched nothing. Whether that is a problem depends on what was asked for - no
 * players is odd, no agent is ordinary - so the decision belongs to the caller rather than
 * here.
 */
function parseTargets(details: unknown): LocatedEntity[] | null {
  if (typeof details !== 'string') return null;

  let entries: unknown;
  try {
    entries = JSON.parse(details);
  } catch {
    throw new Error(`querytarget's reply was not JSON: ${details.slice(0, 120)}`);
  }
  if (!Array.isArray(entries)) {
    throw new Error('querytarget answered with something other than a list of targets');
  }

  return entries.flatMap((entry) => {
    const { position, uniqueId, yRot, dimension } = entry as QueryTargetEntry;
    // Skipped rather than defaulted to the origin: a target at 0,0,0 and one whose position
    // did not arrive are different things, and one of them is a real place.
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
}

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
      const players = parseTargets(outcome.data['details']);
      if (players === null) {
        // No players at all, with an MCP session attached to the world, is odd enough to be
        // worth raising rather than reporting as an empty room.
        throw new Error(
          `querytarget answered without a "details" field. The game said: ${outcome.statusMessage || '(nothing)'}`
        );
      }

      return { players, count: players.length };
    },
  });

/**
 * The Agent - the robot the Education Edition builds lessons around.
 *
 * Two commands can find it, and the difference matters. `agent getposition` returns only
 * coordinates; `querytarget @e[type=agent]` returns the same JSON shape as the player query,
 * with rotation and identity as well. The second is used here, so one parser covers both.
 *
 * ## Why this must not summon anything
 *
 * socket-be offers `getOrCreateAgent()`, and it is a trap: it never assigns to its own cache,
 * so every call sends `agent create`. A tool built on it would summon an agent as a side
 * effect of asking whether one exists - which turns "where is the agent" into "there is one
 * now, at the player". Asking a question must not change the answer.
 *
 * So an absent agent is reported as absent. Summoning is a separate, deliberate act.
 */
export const worldAgentTool = (runner: CommandRunner) =>
  defineTool({
    name: 'world.agent',
    title: 'Where the agent is',
    description: [
      "Find the Education Edition Agent — the robot — and report where it is, which way it faces, and which dimension it is in.",
      'Use this before moving the agent or building relative to it, and to check whether an agent exists at all.',
      'A world with no agent comes back as exists: false. That is an answer, not a failure — an agent has to be summoned before it exists, and this tool deliberately will not do that: asking where something is must not create it.',
      'Do NOT use this to find players — world.players does that, and an agent is not a player.',
    ].join(' '),
    inputSchema: {},
    outputSchema: {
      exists: z.boolean().describe('False means no agent has been summoned in this world.'),
      x: z.number().nullable().describe('Block centre, so .5 offsets are normal here.'),
      y: z.number().nullable(),
      z: z.number().nullable(),
      dimension: z.string().nullable(),
      facing: z.number().nullable().describe('Degrees, -180 to 180.'),
      uniqueId: z.string().nullable(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async () => {
      const outcome = await runner.run('querytarget @e[type=agent]');
      const found = parseTargets(outcome.data['details']);
      const agent = found?.[0];

      if (!agent) {
        return { exists: false, x: null, y: null, z: null, dimension: null, facing: null, uniqueId: null };
      }
      return { exists: true, ...agent };
    },
  });

export function playerTools(runner: CommandRunner): AnyToolDefinition[] {
  return [worldPlayersTool(runner), worldAgentTool(runner)] as unknown as AnyToolDefinition[];
}
