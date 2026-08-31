/**
 * Many shapes, one call.
 *
 * Measured on a real session: a tree of 49 Bézier curves took 384.7 seconds of wall clock,
 * and the breakdown says where it went. Server compute was 11 milliseconds. The `/fill`
 * commands were about 2 seconds. The MCP round trip over stdio was half a second. Everything
 * else - 380 seconds, 98% - was the cost of the call being made 49 times: a fixed per-call
 * overhead, and the model writing the next one.
 *
 * A regression over 152 calls from that session put it beyond doubt: `ms = 2058 - 1.24 x
 * fills`, R-squared 0.0017, and the slope is *negative*. A one-fill `build.cube` took 1942ms
 * and a 103-fill `build.torus` took 1952ms. **How much a call places does not measurably
 * affect how long it takes.** How many calls there are is the whole cost.
 *
 * So the packing was never the problem. Merging the 49 curves before packing them does take
 * 366 fills down to 159, and that is worth having - it is 82 fills that were writing blocks
 * another curve had already written - but it buys about a second out of 385.
 *
 * ## Why the result names the entries that lost blocks
 *
 * Measured the day this shipped, growing the same tree in one call: 64 shapes, 3342 blocks
 * claimed, 2452 distinct. The result said `overlaps: 890` and `oak_log: 511`, and both were
 * true. What it did not say is that the generator had produced 731 logs, so 220 of them had
 * been taken by the leaf balls placed over the branch tips - and leaves with no log within
 * four blocks decay, so burying a tip can quietly kill the ball that buried it.
 *
 * The only reason that was caught is that a script outside the server had printed 731 first.
 * A caller without a second count has nothing to compare against: the call succeeds, the
 * totals look right, and the shape is simply not there. So the entries that lost blocks name
 * themselves, and an entry down to `kept: 0` says so in the one place the caller is already
 * reading.
 *
 * ## Why one tool rather than ten plural ones
 *
 * The alternative was `build.curves`, `build.spheres` and so on. It reduces a call per shape
 * to a call per *distinct kind of shape*, which is perfect for a tree - 49 curves become one -
 * and stops well short on a building: the pagoda built earlier that day was 28 calls across
 * six different (shape, block) pairs, and plural tools would make it six rather than one.
 * Buildings mix materials; that is what makes them buildings.
 *
 * ## Why this is not the `action` enum D-6 threw out
 *
 * It looks like it. The legacy server bundled every operation behind an `action` string and
 * `build.ts` records what that cost: the input schema became the union of every action's
 * parameters, so nothing could be marked required, and the model had to infer which arguments
 * a given action wanted from descriptions that were sometimes wrong.
 *
 * A discriminated union does not do that, and the difference is checkable rather than
 * arguable. Converted to JSON Schema it produces one branch per shape, each with its own
 * accurate `required`:
 *
 *     type="cube"    required=[type, corner1, corner2, block]
 *     type="sphere"  required=[type, center, block]
 *     type="curve"   required=[type, start, end, controlPoints, block]
 *
 * `type` is a `const` per branch, not a free enum to be guessed at. D-6 rejected losing
 * `required`; it did not reject tagged branches, and D-5 - dropping the hand-rolled schema
 * layer for zod - is what makes the accurate version expressible at all.
 *
 * The branches here are not written out a second time. They are the single tools' own schemas
 * and the dispatch calls the single tools' own handlers, so there is no second ledger to drift
 * out of step with the first. The audit of the legacy tool surface measured what a second
 * ledger costs: eight cross-tool references in the legacy `sequence` tool, of which eight did
 * not exist.
 */

import { z } from 'zod';

import type { CommandRunner } from '../bridge/index.js';
import type { BlockSpec } from '../commands/index.js';
import type { Position } from '../geometry/index.js';
import { placeGroups, type BlockGroup } from '../execute/placer.js';
import { storePlan } from '../plan/store.js';
import { buildTools } from './build.js';
import {
  BlockCoordinate,
  BlockStates,
  defineTool,
  type AnyToolDefinition,
  type PlannedBuild,
} from './types.js';

/** The most shapes one call may carry. */
export const MAX_SHAPES = 512;

/**
 * How many overwritten entries are named one by one.
 *
 * The *count* of them is always exact; only the naming is capped, because a call where all five
 * hundred entries lost something would otherwise answer with a longer list than the request.
 * Worst first, so the cap drops the least interesting rows.
 */
export const MAX_OVERWRITTEN_LISTED = 32;

const shapeName = (toolName: string) => toolName.slice('build.'.length);

/**
 * One branch per shape, built from that shape's own schema.
 *
 * Written this way rather than by hand so the branch cannot describe a tool that does not
 * exist, or omit a parameter the tool requires. Adding a shape to `buildTools` adds it here.
 */
const branches = buildTools.map((tool) =>
  z.object({
    type: z.literal(shapeName(tool.name)).describe(`Which shape. Takes the same arguments as build.${shapeName(tool.name)}.`),
    ...(tool.inputSchema as Record<string, z.ZodTypeAny>),
    states: BlockStates.optional(),
  })
);

const ShapeEntry = z.discriminatedUnion(
  'type',
  branches as unknown as [z.ZodObject<z.ZodRawShape>, ...z.ZodObject<z.ZodRawShape>[]]
);

const key = (p: Position) => `${p.x},${p.y},${p.z}`;
const blockKey = (block: BlockSpec) =>
  block.states === undefined ? block.id : `${block.id} ${JSON.stringify(block.states)}`;

export const buildBatchTool = (runner: CommandRunner) =>
  defineTool({
    name: 'build.batch',
    title: 'Several shapes at once',
    description: [
      'Build many shapes in one call. Each entry takes exactly the arguments its own build.* tool takes, plus "type" naming which one.',
      'Reach for this whenever a thing is made of more than one shape — a tree of curves, a building of boxes and roofs, a colonnade of cylinders. It is not a convenience: measured on a real session, a tree built as 49 separate calls spent 98% of its 385 seconds on the calls themselves rather than on the blocks. The same 49 curves here are one call.',
      'Shapes may mix freely: different kinds, different blocks, different states in the same call. Where two shapes cover the same block the later entry wins, and the whole set is packed into /fill commands together — so a block two branches share is written once instead of twice.',
      'The result says how many blocks overlapped and, in "overwritten", which entries lost some of theirs to a later one. Read it: an entry with kept 0 put nothing in the world at all, and a shape meant to hold something up can be buried by the thing it holds.',
      'Do NOT use it for a single shape; it refuses fewer than two, and the single tool is clearer. Do NOT reach for it to repeat one shape at a spacing — that is the same entry many times, which works but is verbose; a real repeat tool does not exist yet.',
      'An entry with a bad argument fails the whole call, and the error names the entry by index, so fix that entry and send it again.',
    ].join(' '),
    inputSchema: {
      shapes: z
        .array(ShapeEntry)
        .min(2)
        .max(MAX_SHAPES)
        .describe(
          'Two or more shapes, laid down in order. Later entries win where they overlap earlier ones.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          'Work the whole set out and keep it for plan.preview, but place nothing. Use this to look at a tree before growing it.'
        ),
    },
    outputSchema: {
      planId: z.string().describe('Handle for the whole set, for plan.preview.'),
      placed: z.boolean().describe('False when dryRun was set.'),
      shapeCount: z.number().int(),
      blockCount: z.number().int().describe('Distinct blocks after overlaps were resolved.'),
      overlaps: z
        .number()
        .int()
        .describe(
          'Positions claimed by more than one shape. They were written once, by the last shape to claim them. Separate calls would have written each of these twice.'
        ),
      bounds: z.object({ min: BlockCoordinate, max: BlockCoordinate }),
      blocks: z
        .array(z.object({ block: z.string(), count: z.number().int() }))
        .describe('What went in, commonest first.'),
      overwritten: z
        .array(
          z.object({
            index: z.number().int().describe('Where the entry sat in the shapes array.'),
            type: z.string(),
            claimed: z.number().int().describe('Blocks the entry covers on its own.'),
            kept: z.number().int().describe('How many of them it still owns. 0 means it is buried entirely and put nothing in the world.'),
          })
        )
        .describe(
          'Entries a later entry took blocks from, most taken first. Entries that kept everything are not listed. At most 32 are named; overwrittenCount is the true total.'
        ),
      overwrittenCount: z
        .number()
        .int()
        .describe('How many entries lost blocks altogether, named above or not.'),
      commandCount: z.number().int().describe('How many /fill commands the whole set packed down to.'),
      unsent: z.array(z.object({ commandLine: z.string(), reason: z.string() })),
      negative: z.array(z.object({ commandLine: z.string(), statusMessage: z.string() })),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: async ({ shapes, dryRun }) => {
      // Later wins, so the map is filled in order and each position ends up owned by the last
      // shape that claimed it. This has to happen before any command is generated: the placer
      // runs up to 64 fills concurrently and its own comment says order does not matter
      // "because the boxes are disjoint" - true for one shape, false the moment two shapes
      // with different blocks overlap.
      const owner = new Map<string, { position: Position; block: BlockSpec; index: number }>();
      const claimedBy: number[] = [];
      let claimed = 0;

      shapes.forEach((entry, index) => {
        const tool = buildTools.find((t) => t.name === `build.${(entry as { type: string }).type}`);
        if (!tool) {
          // Unreachable through the schema - the branch literals come from buildTools - but a
          // silent skip here would place a shape short and say nothing.
          throw new Error(`shapes[${index}]: no shape called ${JSON.stringify((entry as { type: string }).type)}`);
        }

        let plan: PlannedBuild;
        try {
          plan = tool.handler(entry as never) as PlannedBuild;
        } catch (error) {
          // The index is what makes a failed batch actionable: without it the caller knows
          // only that one of five hundred entries is wrong.
          throw new Error(`shapes[${index}] (${(entry as { type: string }).type}): ${(error as Error).message}`);
        }

        const states = (entry as { states?: Record<string, string | number | boolean> }).states;
        const block: BlockSpec = states === undefined ? { id: plan.block } : { id: plan.block, states };
        // Counted as distinct positions rather than as emitted ones, so an entry is never
        // reported as having lost blocks to itself. Today no shape emits a position twice;
        // this holds if one ever does.
        const own = new Set<string>();
        for (const position of plan.positions) {
          const k = key(position);
          if (!own.has(k)) {
            own.add(k);
            claimed++;
          }
          owner.set(k, { position, block, index });
        }
        claimedBy[index] = own.size;
      });

      // What each entry still owns once the later ones have taken what they cover. An entry
      // that generated blocks and kept none of them is the failure this reports: the call
      // succeeds, the block counts look right, and the shape is simply not there.
      const keptBy = new Array<number>(shapes.length).fill(0);
      for (const { index } of owner.values()) keptBy[index]!++;

      const overwrittenAll = shapes
        .map((entry, index) => ({
          index,
          type: (entry as { type: string }).type,
          claimed: claimedBy[index] ?? 0,
          kept: keptBy[index]!,
        }))
        .filter((row) => row.kept < row.claimed)
        .sort((a, b) => b.claimed - b.kept - (a.claimed - a.kept));

      const byBlock = new Map<string, { block: BlockSpec; positions: Position[] }>();
      for (const { position, block } of owner.values()) {
        const k = blockKey(block);
        const group = byBlock.get(k) ?? { block, positions: [] };
        group.positions.push(position);
        byBlock.set(k, group);
      }

      const positions = [...owner.values()].map((v) => v.position);
      if (positions.length === 0) throw new Error('the batch covers no blocks at all');

      const xs = positions.map((p) => p.x);
      const ys = positions.map((p) => p.y);
      const zs = positions.map((p) => p.z);
      const bounds = {
        min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
        max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
      };

      const blocks = [...byBlock.values()]
        .map((g) => ({ block: g.block.id, count: g.positions.length }))
        .sort((a, b) => b.count - a.count);

      // The plan keeps the commonest block, which is what a caption needs; the groups carry
      // the rest. A batch is not one material and the plan cannot pretend otherwise.
      const planId = storePlan(positions, 'build.batch', [...byBlock.values()][0]!.block);

      const common = {
        planId,
        shapeCount: shapes.length,
        blockCount: positions.length,
        overlaps: claimed - positions.length,
        bounds,
        blocks,
        overwritten: overwrittenAll.slice(0, MAX_OVERWRITTEN_LISTED),
        overwrittenCount: overwrittenAll.length,
      };

      if (dryRun === true) {
        return { ...common, placed: false, commandCount: 0, unsent: [], negative: [] };
      }

      const groups: BlockGroup[] = [...byBlock.values()].map((g) => ({
        block: g.block,
        positions: g.positions,
      }));
      const report = await placeGroups(runner, groups);

      return {
        ...common,
        placed: true,
        commandCount: report.commandCount,
        unsent: report.unsent,
        negative: report.negative,
      };
    },
  });

export function batchTools(runner: CommandRunner): AnyToolDefinition[] {
  return [buildBatchTool(runner)] as unknown as AnyToolDefinition[];
}
