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
  // Padding is the caller's slip, not a different block. Trimmed here so that the schema and
  // `normalizeBlockId`, which also trims, cannot disagree about ` stone`.
  .trim()
  .regex(
    // Any namespace, not just `minecraft:` - Education Edition loads add-ons, and an add-on
    // block is `myaddon:reactor`. Case is accepted here and folded by `normalizeBlockId`;
    // the two must agree on what they take, which `commands.test.mjs` checks.
    /^(?:[A-Za-z0-9_]+:)?[A-Za-z0-9_]+$/,
    "must be a plain block id such as 'stone' or 'minecraft:oak_planks' — no spaces, states or quotes"
  )
  .describe("Block identifier. The 'minecraft:' prefix is optional.");

/**
 * Block states are structured rather than spliced into the id, for the same reason.
 *
 * Namespaced names are accepted because the game returns them: a chest reads back with both
 * `facing_direction` and `minecraft:cardinal_direction`, measured on hardware. Rejecting the
 * second would mean a state read from `world.get_block` could not be written back.
 */
export const BlockStates = z
  .record(z.string().regex(/^(?:[a-z0-9_]+:)?[a-z0-9_]+$/), z.union([z.string(), z.number(), z.boolean()]))
  .describe(
    "Block states, e.g. { weirdo_direction: 2, upside_down_bit: false } for a staircase. " +
      'Omit unless the block needs them; every block has a default. ' +
      'Read the names for a block you can see with world.get_block, which returns them.'
  );

/**
 * A block, optionally with the states that decide which way it faces.
 *
 * Writing takes states and reading a whole region does not, which looks lopsided until you
 * see what each side is for. Reading has to cover whatever the world happens to contain -
 * `liquid_depth` on every water block, `wall_connection_type_*` on every fence post - and
 * carrying that in a layer grid makes regions unreadable: a cobblestone wall serialises to
 * about 193 characters, two fit in a chat line, and a 16-cubed read is 2048 lines. Writing
 * covers only what the author chose, which is two or three variants of one staircase, and it
 * travels as an argument rather than through the chat ceiling.
 */
export const BlockWithStates = z.union([
  BlockId,
  z.object({
    id: BlockId,
    states: BlockStates.optional(),
  }),
]);

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
 * A shape worked out but not yet placed.
 *
 * The positions ride along because something has to actually build it, and the packer that
 * turns them into `/fill` commands needs them. They are stripped before the result leaves the
 * server: a radius-8 sphere is over two thousand coordinates and the model asked for a
 * sphere, not a list.
 */
export interface PlannedBuild extends BuildResultValue {
  readonly positions: readonly Position[];
}

/**
 * What a build tool returns once it has been built.
 *
 * The extra fields are about the sending, not the shape, and they are deliberately factual
 * rather than a verdict. Bedrock's status codes do not mean what they look like they mean -
 * `0 blocks filled` is negative and describes a command that ran - so this reports what the
 * game said and leaves the judging to whoever reads the blocks afterwards.
 */
export const BuildOutcome = BuildResult.extend({
  commandCount: z
    .number()
    .int()
    .describe('How many /fill commands the shape packed down to.'),
  unsent: z
    .array(z.object({ commandLine: z.string(), reason: z.string() }))
    .describe('Commands that never reached the game. These are real failures.'),
  negative: z
    .array(z.object({ commandLine: z.string(), statusMessage: z.string() }))
    .describe(
      'Commands the game answered with a negative status. Usually harmless — "0 blocks filled" ' +
        'means nothing matched, and "cannot be placed" means the block was already there. ' +
        'To find out whether the shape is actually in the world, read it with world.read_region.'
    ),
  planId: z
    .string()
    .describe(
      'Handle for the positions this shape covers, kept on the server. Pass it to plan.preview ' +
        'to see the shape drawn. It stays valid for a while and then ages out; build again to get a new one.'
    ),
  placed: z
    .boolean()
    .describe('False when dryRun was set, meaning nothing was sent to the game.'),
});

/**
 * Work the shape out and keep it, but do not build it.
 *
 * Separate from the shape parameters because it is the same question for every shape, and
 * because the answer changes what the call *is*: with it set, nothing reaches the world.
 */
export const DryRunFlag = z
  .boolean()
  .describe(
    'Work out the shape and keep it for plan.preview, but place nothing. Use this to look ' +
      'before building — a picture costs milliseconds, and reading the same region back out ' +
      'of the game costs minutes.'
  );

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
): PlannedBuild {
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
    positions,
  };
}

// --- tool definition -------------------------------------------------------------------------

/**
 * The shape a tool's schemas take.
 *
 * The SDK declares its own `ZodRawShape` as `Record<string, z.ZodType>`. Zod 4 exports a
 * `ZodRawShape` too, but it resolves to the core `$ZodType` rather than the classic
 * `ZodType`, so the two do not unify. Matching the SDK's spelling here keeps registration
 * assignable without a cast.
 */
export type ToolSchemaShape = Record<string, z.ZodType>;

/**
 * A tool as data.
 *
 * `outputSchema` is required here even though the SDK treats it as optional. The legacy
 * server had no notion of it at all, so every result arrived as an unstructured blob of text
 * that the model had to parse back out.
 */
export interface ToolDefinition<
  Input extends ToolSchemaShape = ToolSchemaShape,
  Output extends ToolSchemaShape = ToolSchemaShape,
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
export type AnyToolDefinition = Omit<ToolDefinition<ToolSchemaShape, ToolSchemaShape>, 'handler'> & {
  handler: (args: never) => unknown;
};

export function defineTool<Input extends ToolSchemaShape, Output extends ToolSchemaShape>(
  definition: ToolDefinition<Input, Output>
): ToolDefinition<Input, Output> {
  return definition;
}

/**
 * Where a tool hangs an image on its result.
 *
 * A symbol rather than a field because the result is serialised twice on the way out - once
 * as the JSON a model reads, once as `structuredContent` - and `JSON.stringify` skips symbol
 * keys. A base64 PNG in either of those would be tens of kilobytes of noise in the model's
 * context, which is the opposite of what drawing the plan is for.
 */
export const IMAGE_CONTENT = Symbol.for('mcp.imageContent');

export interface ImageAttachment {
  readonly data: string;
  readonly mimeType: string;
}

/** Reads the attachment off a handler's result, if it hung one there. */
export function imageAttachment(result: unknown): ImageAttachment | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  return (result as Record<symbol, ImageAttachment | undefined>)[IMAGE_CONTENT];
}

/**
 * The same object with the attachment removed.
 *
 * `structuredContent` is validated against the output schema key by key, and a symbol key is
 * not a string - so an object carrying one is refused by the SDK before it ever reaches the
 * client. `JSON.stringify` skipping symbols is not the same as the object not having them.
 */
export function withoutAttachment<T>(result: T): T {
  if (typeof result !== 'object' || result === null) return result;
  const { [IMAGE_CONTENT]: _dropped, ...rest } = result as Record<symbol, unknown>;
  return rest as T;
}
