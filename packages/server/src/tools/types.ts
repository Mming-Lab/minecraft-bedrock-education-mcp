/**
 * Shared pieces of the tool surface.
 *
 * Tools are plain data — name, schemas, handler — rather than subclasses. The legacy
 * `BaseTool` was 448 lines carrying command execution, argument validation, error shaping
 * and sequence running for every tool that extended it, so adding a tool meant inheriting
 * all of it. Here a tool is a value, and the registration step is the only thing that knows
 * about the MCP SDK.
 *
 * Handlers are also kept free of the world connection: a build tool computes which blocks
 * to place and returns that, and a separate executor turns it into commands. That split is
 * what lets the whole surface be tested without Minecraft running.
 */

import { z } from 'zod';
import type { Position } from '../geometry/index.js';

// --- coordinates ---------------------------------------------------------------------------
// Minecraft's Y range is far narrower than X and Z, and stating it in the schema means the
// model is told the limit rather than discovering it from a failed command.

export const BlockCoordinate = z.object({
  x: z.number().int().min(-30_000_000).max(30_000_000).describe('East-west. Increases to the east.'),
  y: z.number().int().min(-64).max(320).describe('Height. -64 is bedrock, 320 is the build limit.'),
  z: z.number().int().min(-30_000_000).max(30_000_000).describe('North-south. Increases to the south.'),
});

export const AxisSchema = z
  .enum(['x', 'y', 'z'])
  .describe("The axis the shape runs along. 'y' is vertical, which is almost always what you want.");

/**
 * A block identifier such as `stone` or `minecraft:oak_stairs`.
 *
 * Deliberately not a free string: the pattern rejects the block-state syntax and the stray
 * spaces that let a value change a command's meaning. The legacy server passed this straight
 * into the command line, so `block_id: "air 0 destroy"` turned a `replace` fill into a
 * `destroy` one and the response text still said `replace`.
 *
 * Whether the id actually exists is checked separately, against the registry read from the
 * running world, so an unknown id can come back with suggestions instead of a command error.
 */
export const BlockId = z
  .string()
  .regex(
    /^(?:minecraft:)?[a-z0-9_]+$/,
    "must be a plain block id such as 'stone' or 'minecraft:oak_planks' — no spaces, states or quotes"
  )
  .describe("Block identifier. The 'minecraft:' prefix is optional.");

/** Block states are structured rather than spliced into the id, for the same reason. */
export const BlockStates = z
  .record(z.string().regex(/^[a-z0-9_]+$/), z.union([z.string(), z.number(), z.boolean()]))
  .describe("Block states, e.g. { facing: 'north', open: true }. Omit unless the block needs them.");

export const HollowFlag = z
  .boolean()
  .describe('Build only the outer shell, one block thick, instead of a solid volume.');

// --- results -------------------------------------------------------------------------------

/**
 * What a build tool returns.
 *
 * The coordinates themselves are not included. A radius-8 sphere is over two thousand
 * blocks, and the model has no use for the list — it asked for a sphere, and what it needs
 * back is confirmation of what will be built and where. Reading blocks is `observe.*`'s job,
 * and that has its own compressed encoding.
 */
export const BuildResult = z.object({
  blockCount: z.number().int().describe('How many blocks the shape occupies.'),
  bounds: z
    .object({ min: BlockCoordinate, max: BlockCoordinate })
    .describe('Bounding box of the shape.'),
  block: z.string().describe('The block that will fill it.'),
  hollow: z.boolean().optional(),
});

export type BuildResultValue = z.infer<typeof BuildResult>;

/**
 * Turns a computed position list into the summary above.
 *
 * Throws rather than returning an empty summary when the shape has no blocks: a build that
 * places nothing is a failure the caller needs to see, not a successful no-op.
 */
export function summariseBuild(
  positions: readonly Position[],
  block: string,
  hollow?: boolean
): BuildResultValue {
  if (positions.length === 0) {
    throw new Error('the shape produced no blocks; check the radius and height arguments');
  }

  const first = positions[0]!;
  let minX = first.x, minY = first.y, minZ = first.z;
  let maxX = first.x, maxY = first.y, maxZ = first.z;

  for (const p of positions) {
    if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; else if (p.z > maxZ) maxZ = p.z;
  }

  return {
    blockCount: positions.length,
    bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
    block,
    ...(hollow === undefined ? {} : { hollow }),
  };
}

// --- tool definition -------------------------------------------------------------------------

/**
 * A tool as data.
 *
 * `inputSchema` and `outputSchema` are Zod raw shapes because that is what the SDK's
 * `registerTool` takes. `outputSchema` is required here even though the SDK treats it as
 * optional — the legacy server had no notion of it at all, so every result was an
 * unstructured blob of text the model had to parse back out.
 */
export interface ToolDefinition<
  Input extends z.ZodRawShape = z.ZodRawShape,
  Output extends z.ZodRawShape = z.ZodRawShape,
> {
  /** Dot-separated, e.g. `build.sphere`. The prefix groups tools that belong together. */
  name: string;
  title: string;
  /** Must say when NOT to use the tool, not only what it does. */
  description: string;
  inputSchema: Input;
  outputSchema: Output;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  handler: (args: z.infer<z.ZodObject<Input>>) => unknown;
}

/**
 * The erased form, so definitions with different schema shapes can share one array.
 *
 * Handler arguments are contravariant, so a handler typed to its own schema is not
 * assignable to one typed to an arbitrary shape. The SDK validates arguments against
 * `inputSchema` before dispatching, so each handler really does receive values of its own
 * declared shape — the erased list simply cannot express that relationship. Widening the
 * argument here keeps every individual definition fully typed, which is where the checking
 * is worth having.
 */
export type AnyToolDefinition = Omit<ToolDefinition<z.ZodRawShape, z.ZodRawShape>, 'handler'> & {
  handler: (args: never) => unknown;
};

export function defineTool<Input extends z.ZodRawShape, Output extends z.ZodRawShape>(
  definition: ToolDefinition<Input, Output>
): ToolDefinition<Input, Output> {
  return definition;
}
