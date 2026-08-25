/**
 * Moving a region without taking it apart.
 *
 * `world.read_region` and `build.layers` make a round trip out of one character per block, and
 * that is the right shape for editing - but a character cannot hold a block's *state*. The
 * add-on's region read sends ids alone (`main.js`, the `readregion` handler), so a staircase
 * comes back as `oak_stairs` and goes back down facing whichever way is default. Reading a
 * house and rebuilding it elsewhere straightens every stair and shuts every door.
 *
 * `/clone` never converts anything. The game copies the blocks in place, states and all, and
 * one command does it - so nothing can change underneath a read-then-write pair. It also
 * carries far more than the 4096 blocks a region read is limited to.
 *
 * ## What this deliberately does not do
 *
 * **No rotation.** Bedrock's `/clone` has no rotation parameter, and the legacy server's
 * `build_rotate` and `build_transform` only ever repainted an outline in a single material -
 * they did not move the structure they claimed to rotate. Ninety-degree rotation of a *grid*
 * is a transpose, which a caller can do to `read_region`'s output before handing it to
 * `build.layers`; it loses states for the same reason everything else does. Rotating with
 * states intact is not possible through any route this server has, and pretending otherwise
 * inside a copy tool would hide that.
 *
 * **No dimension parameter.** Nothing under `build.*` takes one, and Bedrock's `/clone` has no
 * cross-dimension form either.
 */

import { z } from 'zod';
import type { CommandRunner } from '../bridge/index.js';
import { BlockCoordinate, defineTool, type AnyToolDefinition } from './types.js';

/**
 * The largest region `/clone` will copy.
 *
 * From the Bedrock command reference — 524288 blocks, eight chunks' worth. **Not measured on
 * hardware**, unlike the `/fill` limit of 32768, which the game itself stated when asked for
 * 33792. The same source got that one right, which is a reason to believe this and not a
 * reason to stop calling it unverified.
 */
export const CLONE_VOLUME_LIMIT = 524288;

const MASK_MODES = ['replace', 'masked'] as const;
const CLONE_MODES = ['normal', 'force', 'move'] as const;

export const buildCloneRegionTool = (runner: CommandRunner) =>
  defineTool({
    name: 'build.clone_region',
    title: 'Copy or move a region',
    description: [
      'Copy a box of blocks to somewhere else, or move it, with block states and container contents intact.',
      'Use this whenever the thing being moved is more than plain blocks — stairs that face a direction, doors, chests with something in them, signs. It is also the only way to shift more than 4096 blocks, and the only one that happens in a single command, so nothing can change halfway through.',
      'Set clone_mode to "move" to take the blocks with you: the source is left as air. "force" allows the source and destination to overlap. "normal", the default, refuses an overlap rather than producing something half-copied.',
      'Set mask_mode to "masked" to copy only the solid blocks, leaving whatever is already at the destination showing through the gaps. "replace", the default, copies the air too.',
      'It canNOT rotate or mirror — Bedrock has no such option. For a quarter turn, read the region with world.read_region, transpose the rows yourself, and send the grid to build.layers; that loses block states, which is why it is not what this tool does.',
      'Do NOT reach for this to place a shape: build.cube and the rest compute what to place. This only moves blocks that already exist.',
    ].join(' '),
    inputSchema: {
      corner1: BlockCoordinate.describe('One corner of the region to copy.'),
      corner2: BlockCoordinate.describe('The opposite corner. Order does not matter.'),
      destination: BlockCoordinate.describe(
        'Where the lowest corner of the region lands. The rest is placed relative to it, so this is a corner and not a centre.'
      ),
      mask_mode: z
        .enum(MASK_MODES)
        .describe('"replace" copies air as well; "masked" copies only solid blocks.')
        .optional(),
      clone_mode: z
        .enum(CLONE_MODES)
        .describe('"normal" refuses overlap, "force" allows it, "move" clears the source.')
        .optional(),
    },
    outputSchema: {
      commandLine: z.string().describe('Exactly what was sent, so a refusal can be read against it.'),
      volume: z.number().int().describe('How many blocks the region holds.'),
      statusCode: z
        .number()
        .int()
        .describe('Bedrock\'s own code, passed through. Negative does not mean refused.'),
      statusMessage: z.string().describe("What the game said, in the client's language."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      // "move" empties the source, so running it twice copies an empty region over the result.
      idempotentHint: false,
    },
    handler: async ({ corner1, corner2, destination, mask_mode, clone_mode }) => {
      const min = {
        x: Math.min(corner1.x, corner2.x),
        y: Math.min(corner1.y, corner2.y),
        z: Math.min(corner1.z, corner2.z),
      };
      const max = {
        x: Math.max(corner1.x, corner2.x),
        y: Math.max(corner1.y, corner2.y),
        z: Math.max(corner1.z, corner2.z),
      };
      const volume = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);

      if (volume > CLONE_VOLUME_LIMIT) {
        throw new Error(
          `that region is ${volume} blocks, over /clone's ${CLONE_VOLUME_LIMIT}-block limit. Copy it in pieces.`
        );
      }

      const mask = mask_mode ?? 'replace';
      const mode = clone_mode ?? 'normal';
      // Bedrock's argument order, unchanged: begin, end, destination, maskMode, cloneMode.
      const commandLine =
        `clone ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} ` +
        `${destination.x} ${destination.y} ${destination.z} ${mask} ${mode}`;

      const outcome = await runner.run(commandLine);

      // Reported, not judged - same as every other write. A negative code from Bedrock does not
      // mean the command was refused, and reading the message instead fails on a client that
      // answers in another language. Whether the blocks arrived is a question for
      // world.read_region.
      return {
        commandLine,
        volume,
        statusCode: outcome.statusCode,
        statusMessage: outcome.statusMessage,
      };
    },
  });

export function cloneTools(runner: CommandRunner): AnyToolDefinition[] {
  return [buildCloneRegionTool(runner)] as unknown as AnyToolDefinition[];
}
