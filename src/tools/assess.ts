/**
 * Looking at what a student built, and declining to mark it.
 *
 * These are the tools the reading half was for. Symmetry is a Year 6 arithmetic topic in Japan
 * - 線対称 and 点対称, by those names - and reflecting or rotating a figure is Year 7. Minecraft
 * Education ships a symmetry lesson of its own. All of it was out of reach while the server
 * could place blocks and not see them.
 *
 * ## Facts, not marks
 *
 * Neither tool returns a score, a verdict, or the word "symmetric". They return how many pairs
 * were compared, how many matched, and the coordinates of the ones that did not.
 *
 * A mark out of ten collapses two different situations into one number: a child who tried to
 * mirror a castle and slipped, and a child who built a deliberately lopsided one. Only the
 * first wants correcting, and nothing in the blocks distinguishes them - the difference is in
 * what the child meant, which a teacher can ask about and a tool cannot. A mark also ends the
 * conversation it should have opened.
 *
 * So the model gets the numbers and says something useful with them. Whether 121 out of 128
 * "counts" depends on whether this is the first lesson on the topic or a check of careful
 * construction work, and that is the teacher's call.
 *
 * ## What must not be built on top of this
 *
 * Ranking students against each other. Each call looks at one region, and nothing here
 * compares two. A teacher may of course look at several results; the tool will not do the
 * comparing for them.
 */

import { z } from 'zod';
import { measureComposition, measureSymmetry, type SymmetryKind } from '../world/measure.js';
import { readRegion, type WorldBridge } from './world.js';
import { BlockCoordinate, defineTool, type AnyToolDefinition } from './types.js';

const SymmetryResultSchema = z.object({
  applicable: z
    .boolean()
    .describe('False when the region\'s shape rules this kind out — a quarter turn needs a square footprint.'),
  comparedPairs: z.number().int(),
  matchingPairs: z.number().int(),
  mismatchCount: z.number().int(),
  matchRatio: z.number().nullable().describe('matchingPairs / comparedPairs, or null when nothing was compared.'),
  indeterminatePairs: z
    .number()
    .int()
    .describe('Pairs where one side was never read. Counted apart from matches and mismatches, never as either.'),
  mismatches: z
    .array(
      z.object({
        a: z.object(BlockCoordinate.shape),
        aBlock: z.string(),
        b: z.object(BlockCoordinate.shape),
        bBlock: z.string(),
      })
    )
    .describe('Where the two halves disagree, up to maxMismatches. Use these to point at the spot rather than at the total.'),
});

const KINDS: readonly SymmetryKind[] = ['mirror_x', 'mirror_z', 'rotate_180', 'rotate_90'];

export const assessSymmetryTool = (bridge: WorldBridge) =>
  defineTool({
    name: 'assess.symmetry',
    title: 'Measure how symmetric a build is',
    description: [
      'Compare a region against itself four ways — mirrored east-west, mirrored north-south, turned half a turn, and turned a quarter turn — and report how many block pairs matched and exactly where they did not.',
      'Use it for the symmetry topic in primary arithmetic, and for reflection and rotation in lower secondary: a build either matches itself across an axis or it does not, and this says which blocks disagree.',
      'It does NOT say whether the build is symmetric, and returns no score. 121 matching pairs out of 128 might be a careful job with one slip, or a deliberately asymmetric design — the blocks cannot tell you which, and the difference matters more than the number. Report the figures and the mismatch positions; let the teacher decide what they mean.',
      'A quarter turn only means anything on a square footprint; on anything else it comes back with applicable: false rather than a misleading zero.',
      'Pairs where one side was in an unloaded chunk are counted separately as indeterminate, never as mismatches — a slow chunk load must not tell a child their work is lopsided. If indeterminatePairs is above zero, call world.load_area over the build and measure again, then world.unload_area.',
      'Block states are not compared, only ids. A mirrored staircase correctly faces the other way, so comparing facings would mark every properly mirrored roof as wrong.',
      'Do NOT use this to compare two students. It looks at one region, and comparing children by a number is not what it is for.',
    ].join(' '),
    inputSchema: {
      corner1: BlockCoordinate.describe('One corner of the build.'),
      corner2: BlockCoordinate.describe('The opposite corner. Order does not matter.'),
      maxMismatches: z
        .number()
        .int()
        .min(1)
        .max(200)
        .describe('How many disagreeing pairs to list. mismatchCount is the true total either way. Defaults to 50.')
        .optional(),
      dimension: z
        .enum(['overworld', 'nether', 'the_end'])
        .describe('Which dimension the build is in. Defaults to the overworld.')
        .optional(),
    },
    outputSchema: {
      region: z.object({
        origin: z.object(BlockCoordinate.shape),
        size: z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() }),
      }),
      unknown: z.number().int().describe('Blocks in the region that were never read.'),
      mirror_x: SymmetryResultSchema.describe('Reflected east-west, about the middle of the box.'),
      mirror_z: SymmetryResultSchema.describe('Reflected north-south.'),
      rotate_180: SymmetryResultSchema.describe('Turned half a turn about the vertical axis — point symmetry.'),
      rotate_90: SymmetryResultSchema.describe('Turned a quarter turn. Square footprints only.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ corner1, corner2, maxMismatches, dimension }) => {
      const region = await readRegion(bridge, corner1, corner2, dimension);
      const options = maxMismatches === undefined ? {} : { maxMismatches };
      const measured = Object.fromEntries(
        KINDS.map((kind) => [kind, measureSymmetry(region, kind, options)])
      ) as Record<SymmetryKind, ReturnType<typeof measureSymmetry>>;

      return {
        region: { origin: region.origin, size: region.size },
        unknown: region.unknown,
        ...measured,
      };
    },
  });

export const assessCompositionTool = (bridge: WorldBridge) =>
  defineTool({
    name: 'assess.composition',
    title: 'Count what a build is made of',
    description: [
      'Report a build\'s dimensions, its footprint, how many blocks are solid, how much of the box is air, and how many of each kind of block it used.',
      'Use it for the volume topic — base area times height — and to check whether a build used the materials a lesson asked for.',
      'It does NOT say whether the build is hollow or solid: it reports the proportion that is air, because where the line falls between a hollow tower and a thick-walled one is a judgement about what was intended.',
      'If part of the region was in an unloaded chunk, complete comes back false and the counts describe less than the whole box. Call world.load_area over it and measure again rather than reporting partial numbers as though they were the answer.',
      'Do NOT use this to compare or rank students. It looks at one region.',
    ].join(' '),
    inputSchema: {
      corner1: BlockCoordinate.describe('One corner of the build.'),
      corner2: BlockCoordinate.describe('The opposite corner. Order does not matter.'),
      dimension: z
        .enum(['overworld', 'nether', 'the_end'])
        .describe('Which dimension the build is in. Defaults to the overworld.')
        .optional(),
    },
    outputSchema: {
      region: z.object({
        origin: z.object(BlockCoordinate.shape),
        size: z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() }),
      }),
      footprintArea: z.number().int().describe('size.x × size.z — the base area.'),
      boundingVolume: z.number().int().describe('The whole box, air included.'),
      filledCount: z.number().int().describe('Blocks that are neither air nor unread.'),
      airCount: z.number().int(),
      airRatio: z.number().nullable().describe('Air as a proportion of what was read.'),
      unknown: z.number().int(),
      complete: z.boolean().describe('False means part of the region was never read.'),
      blockCounts: z
        .array(z.object({ block: z.string(), count: z.number().int() }))
        .describe('Commonest first.'),
      distinctBlockTypes: z.number().int(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ corner1, corner2, dimension }) => {
      const region = await readRegion(bridge, corner1, corner2, dimension);
      return {
        region: { origin: region.origin, size: region.size },
        ...measureComposition(region),
      };
    },
  });

export function assessTools(bridge: WorldBridge): AnyToolDefinition[] {
  return [assessSymmetryTool(bridge), assessCompositionTool(bridge)] as unknown as AnyToolDefinition[];
}
