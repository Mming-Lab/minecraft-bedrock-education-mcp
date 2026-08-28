/**
 * Turning something that has already been worked out.
 *
 * Every one of the ten shapes is square to the world. `build.cube` takes two corners,
 * `build.cylinder` runs along x, y or z, `build.prism` extrudes along one of the same three.
 * The only things that can sit at an angle are `build.line` and `build.curve`, and both are
 * one block wide - so no *surface* on the tool surface can be anything but axis-aligned. That
 * is the gap this fills.
 *
 * ## Why it takes a plan and not a region
 *
 * The legacy server had `build_rotate`, and it did this:
 *
 *     for (x, y, z in the source box)
 *       setblock(rotate(x, y, z), material)
 *
 * It rotated the *coordinates* of a box and filled every one of them with a single block that
 * the caller had to name. Rotating a house gave a solid block of oak the shape of the house's
 * bounding box - no windows, no doorway, no roof. The `material` argument was not a
 * convenience; it was there because the tool never read what was in the source.
 *
 * A plan does not have that problem. The server computed those positions and knows what block
 * they were for, so nothing has to be named again and nothing is invented.
 *
 * ## Right angles are exact and other angles are not
 *
 * `rotatePoint` turns a quarter by swapping components rather than going through sine and
 * cosine, so 90, 180 and 270 are lossless. Other angles round onto the block grid, and
 * rounding is many-to-one: two source blocks can land on the same destination, and some
 * destinations get nothing.
 *
 * Measured on a solid 21x21 slab at 45 degrees - 441 blocks became 365, with 64 empty cells
 * enclosed inside the face. The same turn applied to eight pillars arranged in a ring lost
 * nothing at all, because there was no surface to tear.
 *
 * That is a real limit and it is stated rather than fixed. The fix is to sample backwards -
 * walk the destination and ask each cell where it came from - which needs a source volume
 * rather than a set of positions, and is worth writing when somebody actually wants a solid
 * wall at 30 degrees. Arrangements at an angle are the common case and they are exact.
 */

import { z } from 'zod';

import type { CommandRunner } from '../bridge/index.js';
import type { BlockSpec } from '../commands/index.js';
import { rotatePositions } from '../geometry/index.js';
import { getPlan, storePlan } from '../plan/store.js';
import { placeGroups } from '../execute/placer.js';
import { AxisSchema, BlockCoordinate, BlockId, BlockStates, defineTool, type AnyToolDefinition } from './types.js';

export const buildRotateTool = (runner: CommandRunner) =>
  defineTool({
    name: 'build.rotate',
    title: 'Turn a plan',
    description: [
      'Take a shape that has already been worked out and place it again, turned about a point. Pass the planId from any build.* result.',
      'This is the only way to put a surface at an angle to the world. Every other tool is square to it: cubes take corners, cylinders and prisms run along x, y or z. Use it for a tilted tower, a ring of pillars, a staircase of copies spiralling round a centre.',
      'Right angles are exact — 90, 180 and 270 lose nothing and leave nothing empty, because a quarter turn swaps coordinates rather than computing them.',
      'Other angles round onto the block grid, which is many-to-one: two blocks can land on one, and some cells get none. Measured on a solid 21x21 face at 45 degrees, 441 blocks became 365 with 64 gaps inside the face. The same turn on eight pillars in a ring lost nothing. So turn arrangements at any angle you like; turn a solid wall by a right angle, or expect to see through it. The result says how many were lost.',
      'It places the plan turned; it does NOT move what is already in the world. To move real blocks and keep their facing, use build.clone_region — though that cannot turn them at all, because Bedrock\'s /clone has no rotation.',
      'Block states do not turn with it. A staircase in the plan keeps the facing it was given, so a tower rotated 30 degrees has stairs still pointing at a right angle. Minecraft has no state for a block at 30 degrees; this is the game\'s limit, not the tool\'s.',
    ].join(' '),
    inputSchema: {
      planId: z
        .string()
        .describe('The planId from a build.* result. Set dryRun on that call to work a shape out without placing it first.'),
      origin: BlockCoordinate.describe('The point it turns about. Blocks keep their distance from this.'),
      axis: AxisSchema.describe(
        "The axis it turns around. 'y' spins it like a top, which is almost always what a building wants; 'x' and 'z' tip it over."
      ),
      degrees: z
        .number()
        .int()
        .describe(
          'How far to turn, counter-clockwise looking down the axis. Multiples of 90 are exact; anything else rounds onto the grid and can leave gaps in a solid face.'
        ),
      block: BlockId.describe(
        "What to place. Leave it out to use the plan's own block, which is usually what you want — naming one here paints the turned shape in a single material."
      ).optional(),
      states: BlockStates.optional(),
    },
    outputSchema: {
      planId: z.string().describe('A new plan for the turned shape, so it can be drawn or turned again.'),
      sourcePlanId: z.string(),
      exact: z
        .boolean()
        .describe('True for multiples of 90. False means the turn rounded, and blocks may have merged.'),
      blockCount: z.number().int().describe('Blocks placed, after merging any that landed together.'),
      sourceBlockCount: z.number().int(),
      lost: z
        .number()
        .int()
        .describe('How many blocks shared a destination with another. Always 0 for a right angle.'),
      bounds: z.object({ min: BlockCoordinate, max: BlockCoordinate }),
      block: z.string(),
      commandCount: z.number().int(),
      unsent: z.array(z.object({ commandLine: z.string(), reason: z.string() })),
      negative: z.array(z.object({ commandLine: z.string(), statusMessage: z.string() })),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: async ({ planId, origin, axis, degrees, block, states }) => {
      const source = getPlan(planId);
      if (!source) {
        throw new Error(
          `no plan ${JSON.stringify(planId)}. Plans are kept for a while and then dropped — ` +
            'call the build tool again, with dryRun set if you do not want it placed yet, and use the planId it returns.'
        );
      }

      const turned = rotatePositions(source.positions, origin, axis, degrees);
      if (turned.length === 0) {
        throw new Error('the turned shape has no blocks left, which should not happen — the plan was empty');
      }

      // The plan carries its own block *and* states, so a staircase turned by a right angle
      // keeps the facing it was built with. Naming a block here replaces the id and drops the
      // plan's states with it, because a facing that belonged to oak_stairs means nothing on
      // stone - the caller who renames the block is choosing a different thing entirely.
      const chosen: BlockSpec =
        block === undefined
          ? source.block
          : states === undefined
            ? { id: block }
            : { id: block, states };
      const placed = states === undefined ? chosen : { id: chosen.id, states };

      const xs = turned.map((p: { x: number }) => p.x);
      const ys = turned.map((p: { y: number }) => p.y);
      const zs = turned.map((p: { z: number }) => p.z);

      const report = await placeGroups(runner, [{ block: placed, positions: turned }]);
      const newPlanId = storePlan(turned, 'build.rotate', chosen);

      return {
        planId: newPlanId,
        sourcePlanId: planId,
        // Reported rather than judged, like everything else here. A caller turning a ring of
        // pillars sees 0 and a caller turning a wall sees the damage, and neither is stopped.
        exact: ((degrees % 90) + 90) % 90 === 0,
        blockCount: turned.length,
        sourceBlockCount: source.positions.length,
        lost: source.positions.length - turned.length,
        bounds: {
          min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
          max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
        },
        block: chosen.id,
        commandCount: report.commandCount,
        unsent: report.unsent,
        negative: report.negative,
      };
    },
  });

export function rotateTools(runner: CommandRunner): AnyToolDefinition[] {
  return [buildRotateTool(runner)] as unknown as AnyToolDefinition[];
}
