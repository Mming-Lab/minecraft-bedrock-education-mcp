/**
 * Keeping part of the world loaded, so it can be read at all.
 *
 * `dimension.getBlock` returns undefined for an unloaded chunk - that is in Mojang's own type
 * declaration, not a shortcoming of this bridge - and the reading tools report it honestly as
 * `?`. What they cannot do is anything about it. The advice attached to `?` is "read again once
 * the area is loaded", and until now nothing here could load an area, which makes that a dead
 * end rather than a next step.
 *
 * `/tickingarea` is the game's own answer: a named box that keeps ticking whether or not a
 * player is nearby. Ten of them per world, up to a hundred chunks each.
 *
 * ## This is not free, and the description says so
 *
 * A ticking area does not just make chunks readable - it makes them *run*. Water flows, fire
 * spreads, sand falls, crops grow, leaves decay, mobs move. Reading through one is therefore
 * not a read-only act, which is why these tools are marked as changing the world and why the
 * reading tools are not quietly rewritten to add areas of their own. Whether that cost is
 * acceptable is a decision for the person driving, made once, rather than a side effect they
 * discover later in a lesson.
 *
 * The areas also persist. They are saved in the world and outlive the process, so anything
 * added here can still be running next term unless it is removed.
 */

import { z } from 'zod';
import type { CommandRunner } from '../bridge/index.js';
import { BlockCoordinate, defineTool, type AnyToolDefinition } from './types.js';

/** Bedrock's own limits, from the command reference. Ten areas; a hundred chunks each. */
export const MAX_TICKING_AREAS = 10;
const CHUNK = 16;
export const MAX_AREA_CHUNKS = 100;

const AreaName = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/, 'a name is letters, digits and underscores — it is a command argument')
  .max(32)
  .describe('What to call it, so it can be removed again. Reuse of a name replaces nothing — remove first.');

export const worldLoadAreaTool = (runner: CommandRunner) =>
  defineTool({
    name: 'world.load_area',
    title: 'Keep an area loaded',
    description: [
      'Ask the game to keep a box of chunks loaded and ticking, so tools can read and build there while no player is nearby.',
      'Use this when world.read_region comes back with "?" in the grid, or when a build or clone fails with "cannot access blocks outside the world" — both mean the chunks are not loaded, and this is the only thing that changes that.',
      'This is NOT a read-only operation, despite being used to enable reading. A ticking area runs: water flows, sand falls, fire spreads, crops grow, mobs move. Do not put one around a student build and leave it — read what you needed and remove it with world.unload_area.',
      'It also persists in the world file and outlives this server, so an area left behind is still ticking next term.',
      `At most ${MAX_TICKING_AREAS} areas can exist in one world and each may cover ${MAX_AREA_CHUNKS} chunks (a chunk is 16x16). Check world.loaded_areas before adding, since the world may already have some.`,
    ].join(' '),
    inputSchema: {
      corner1: BlockCoordinate.describe('One corner of the area to keep loaded.'),
      corner2: BlockCoordinate.describe('The opposite corner. Rounded outward to whole chunks by the game.'),
      name: AreaName,
    },
    outputSchema: {
      commandLine: z.string(),
      name: z.string(),
      approximateChunks: z
        .number()
        .int()
        .describe(`Estimated from the box, before the game rounds to chunk edges. Over ${MAX_AREA_CHUNKS} is refused.`),
      statusCode: z.number().int().describe("Bedrock's own code, passed through. Negative does not mean refused."),
      statusMessage: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async ({ corner1, corner2, name }) => {
      const min = { x: Math.min(corner1.x, corner2.x), z: Math.min(corner1.z, corner2.z) };
      const max = { x: Math.max(corner1.x, corner2.x), z: Math.max(corner1.z, corner2.z) };

      // Chunks touched, not blocks: the game works in chunks and rounds outward, so a box that
      // straddles a boundary costs more than its width suggests.
      const chunksX = Math.floor(max.x / CHUNK) - Math.floor(min.x / CHUNK) + 1;
      const chunksZ = Math.floor(max.z / CHUNK) - Math.floor(min.z / CHUNK) + 1;
      const chunks = chunksX * chunksZ;

      if (chunks > MAX_AREA_CHUNKS) {
        throw new Error(
          `that box spans about ${chunksX}x${chunksZ} = ${chunks} chunks, over the ${MAX_AREA_CHUNKS} a ticking area allows. ` +
            `Use a smaller box, or several areas — but there are only ${MAX_TICKING_AREAS} areas in total.`
        );
      }

      // The y coordinates are dropped: a ticking area is a column, and passing a y that Bedrock
      // ignores would suggest it could be limited by height.
      const commandLine = `tickingarea add ${min.x} 0 ${min.z} ${max.x} 0 ${max.z} ${name}`;
      const outcome = await runner.run(commandLine);

      return {
        commandLine,
        name,
        approximateChunks: chunks,
        statusCode: outcome.statusCode,
        statusMessage: outcome.statusMessage,
      };
    },
  });

export const worldUnloadAreaTool = (runner: CommandRunner) =>
  defineTool({
    name: 'world.unload_area',
    title: 'Stop keeping an area loaded',
    description: [
      'Remove a ticking area added with world.load_area, by name.',
      'Do this as soon as the reading or building that needed it is finished. An area left behind keeps its chunks running for as long as the world exists, and there are only ten to go round.',
      'Do NOT use it to tidy up areas somebody else made — world.loaded_areas lists them, and one of them may be the world spawn, which is not yours to remove.',
    ].join(' '),
    inputSchema: { name: AreaName.describe('The name given to world.load_area.') },
    outputSchema: {
      commandLine: z.string(),
      statusCode: z.number().int(),
      statusMessage: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async ({ name }) => {
      const commandLine = `tickingarea remove ${name}`;
      const outcome = await runner.run(commandLine);
      return { commandLine, statusCode: outcome.statusCode, statusMessage: outcome.statusMessage };
    },
  });

export const worldLoadedAreasTool = (runner: CommandRunner) =>
  defineTool({
    name: 'world.loaded_areas',
    title: 'List the ticking areas',
    description: [
      'List the ticking areas this world already has, with whatever the game says about them.',
      'Call it before world.load_area: the limit of ten is per world, not per session, and a world may already be using some — including one for the spawn area that was never added by anyone.',
      'Do NOT assume the list is empty because this server has not added any.',
    ].join(' '),
    inputSchema: {},
    outputSchema: {
      commandLine: z.string(),
      statusCode: z.number().int(),
      // Passed through as text: the game formats this list in the client's language, and
      // parsing a translated sentence is exactly what made `testforblock` unusable.
      statusMessage: z.string().describe("The game's own listing, in its own words and language."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async () => {
      const commandLine = 'tickingarea list all-dimensions';
      const outcome = await runner.run(commandLine);
      return { commandLine, statusCode: outcome.statusCode, statusMessage: outcome.statusMessage };
    },
  });

export function areaTools(runner: CommandRunner): AnyToolDefinition[] {
  return [
    worldLoadAreaTool(runner),
    worldUnloadAreaTool(runner),
    worldLoadedAreasTool(runner),
  ] as unknown as AnyToolDefinition[];
}
