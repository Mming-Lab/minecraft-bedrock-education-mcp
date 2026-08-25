/**
 * Reading the world: the half the legacy server never really had.
 *
 * Everything under `build.*` is blind. It computes positions and emits commands, and what
 * comes back says only whether the command parsed. A model that builds a tower and wants to
 * know whether it landed where it meant has no way to find out, so it cannot correct itself -
 * it can only build again and hope. That, rather than any shortage of shapes, is what makes
 * the building tools hard to steer.
 *
 * These four give it eyes. All of them go through the add-on, because the alternatives lose:
 * `testforblock` cannot report block states and answers in the client's language (a Japanese
 * client says `ダイヤモンドブロック`, which no pattern is going to survive), and the world
 * database needs a flush and cannot see anything alive.
 *
 * ## Reading a region is not the same as listing its blocks
 *
 * `world.read_region` returns horizontal layers of single characters, not an array of names.
 * The reasoning is in `world/layers.ts`; the short version is that a grid keeps the shape of
 * the thing it describes and can be edited in place, which a parameter list cannot.
 *
 * ## perMessage is chosen by retrying, not by predicting
 *
 * The add-on splits a long answer across chat lines and a line over about 505 characters
 * vanishes whole, so the number of blocks per line has to be small enough that no line goes
 * over. That number depends on how long the block names are - and the names are what the read
 * is *for*, so they are not known in advance. Measured on hardware: a region of air, stone
 * and dirt takes 64 per line comfortably, and a region of `polished_deepslate_bricks` would
 * lose every line at that setting.
 *
 * Guessing was tried and it does not survive contact with a varied region. What does work is
 * that loss is *detected*: the answer's header says how many parts to expect, and `assemble`
 * refuses a set with a hole in it. So this asks, and on a refusal halves the request and asks
 * again. Slower on the rare bad guess, and never silently short.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { BridgeProtocolError, type Assembled } from '../bridge/index.js';
import { toLayers, type LayeredRegion } from '../world/layers.js';
import { BlockCoordinate, defineTool, type AnyToolDefinition } from './types.js';

/** What these tools need of the bridge. Narrow, so tests can supply it without a socket. */
export interface WorldBridge {
  request(action: string, args?: Record<string, unknown>): Promise<Assembled>;
}

const Dimension = z
  .enum(['overworld', 'nether', 'the_end'])
  .describe('Which dimension to read. Defaults to the overworld.')
  .optional();

/**
 * The add-on's own words for "I looked and could not see", as opposed to an actual fault.
 *
 * Kept as constants because the difference decides whether a result is an answer or an error,
 * and a typo would quietly turn "not loaded" into "the bridge is broken".
 */
const NOT_LOADED = 'chunk not loaded';
const NOT_A_CONTAINER = 'not a container';

/** The add-on's reply, before it is known to be good. */
interface AddonReply {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Reads the header, failing on anything that is not one of the outcomes the caller expects.
 *
 * `expected` lists the `error` strings that are answers rather than faults - an unloaded
 * chunk is a fact about the world, while "no handler for getblock" is a fault in the
 * installation, and a caller that treated them alike would retry the one it cannot fix.
 */
function headerOf(reply: Assembled, expected: readonly string[] = []): AddonReply {
  const header = reply.header as AddonReply;
  if (header.ok === false) {
    const error = String(header.error ?? 'the add-on refused the request without saying why');
    if (!expected.includes(error)) throw new Error(error);
  }
  return header;
}

// --- is anything on the other end? ------------------------------------------------------------

/**
 * The add-on version this server expects, read from the add-on it ships with.
 *
 * Read rather than written down, because a constant here and a version in the manifest are
 * two things that can disagree - and this whole check exists because two copies of the same
 * add-on disagreed without anyone noticing.
 *
 * Read lazily, and never fatally. A missing manifest means a broken install, but the building
 * tools do not need it, and taking the server down over it would remove capabilities that
 * were working. `world.bridge_status` is the one place that cares, and it reports rather than
 * throws.
 */
export function expectedAddonVersion(): string {
  try {
    // From dist/tools/ up to the package root, where `files` puts the add-on.
    const manifest = JSON.parse(
      readFileSync(new URL('../../addon/manifest.json', import.meta.url), 'utf8')
    ) as { header?: { version?: number[] } };
    const version = manifest.header?.version;
    return Array.isArray(version) ? version.join('.') : 'unreadable';
  } catch {
    return 'not installed';
  }
}

export const worldBridgeStatus = (bridge: WorldBridge) =>
  defineTool({
    name: 'world.bridge_status',
    title: 'Check the connection and the add-on',
    description: [
      'Report whether Minecraft is connected, whether the bridge add-on is loaded, and which version of it is running.',
      'Call this first when any world.* tool fails, or before a lesson, to find out which of the three possible problems you have: nothing connected, no add-on, or an add-on that is out of date.',
      'It never fails — a missing connection is one of its answers, and the answer says what to do about it.',
      'Do NOT call it before every read. The other tools already say what is wrong when they fail; this is for when you want to know before asking.',
    ].join(' '),
    inputSchema: {},
    outputSchema: {
      connected: z.boolean().describe('Whether the add-on answered at all.'),
      addonVersion: z.string().nullable().describe('What the add-on says it is, or null if it did not answer.'),
      expectedVersion: z.string().describe('What this server was written against.'),
      upToDate: z.boolean().describe('False means the game is running an older script than the files on disk.'),
      players: z.number().int().describe('How many players are in the world.'),
      tick: z.number().int().describe("The world's tick counter — proof the answer is live."),
      advice: z
        .string()
        .nullable()
        .describe('What to do about it, in words that can be passed on to the person at the keyboard. Null when everything is fine.'),
    },
    annotations: { readOnlyHint: true },
    handler: async () => {
      // Outside the try: the catch below reports it too, and a bridge that never answered
      // still leaves "what this server expects" worth saying.
      const expected = expectedAddonVersion();
      try {
        const header = headerOf(await bridge.request('ping'));
        const addonVersion = String(header.version ?? 'unknown');
        const upToDate = addonVersion === expected;
        return {
          connected: true,
          addonVersion,
          expectedVersion: expected,
          upToDate,
          players: Number(header.players ?? 0),
          tick: Number(header.tick ?? 0),
          advice: upToDate
            ? null
            : `The game is running add-on ${addonVersion} and this server expects ${expected}. ` +
              `Copying the files over is not enough: pack folders are only scanned when Minecraft launches, ` +
              `so the game has to be closed and reopened — reloading the world keeps the old script.`,
        };
      } catch (error) {
        // Deliberately an answer rather than a failure. This is the tool someone reaches for
        // *because* something is wrong, and throwing would make it the fourth thing that does
        // not work rather than the one that explains the other three.
        return {
          connected: false,
          addonVersion: null,
          expectedVersion: expected,
          upToDate: false,
          players: 0,
          tick: 0,
          advice: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

// --- reading one block -----------------------------------------------------------------------

export const worldGetBlock = (bridge: WorldBridge) =>
  defineTool({
    name: 'world.get_block',
    title: 'Read one block',
    description: [
      'Read the block at one position, with its block states (facing, open, half, and so on).',
      'Use this to check a single spot — whether something landed where it was meant to, which way a stair faces, what a marker is sitting on.',
      'Do NOT call this in a loop to survey an area: each call is a round trip through the game. Use world.read_region, which reads thousands of blocks in one.',
      'A position in an unloaded chunk comes back as status "not_loaded". That is not air. Nobody looked.',
    ].join(' '),
    inputSchema: {
      position: BlockCoordinate.describe('The block to read.'),
      dimension: Dimension,
    },
    outputSchema: {
      status: z
        .enum(['read', 'not_loaded'])
        .describe('"not_loaded" means the chunk is not in memory, so the block is unknown — not that it is air.'),
      block: z.string().nullable().describe('Block id, e.g. "minecraft:oak_stairs". Null when not read.'),
      states: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .nullable()
        .describe('Block states such as { facing_direction: 2 }. Null when not read, empty when the block has none.'),
      position: z.object(BlockCoordinate.shape),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ position, dimension }) => {
      const reply = await bridge.request('getblock', {
        x: position.x,
        y: position.y,
        z: position.z,
        ...(dimension === undefined ? {} : { dimension }),
      });
      const header = headerOf(reply, [NOT_LOADED]);

      if (header.ok === false) {
        return { status: 'not_loaded' as const, block: null, states: null, position };
      }
      return {
        status: 'read' as const,
        block: String(header.name),
        states: (header.states ?? {}) as Record<string, string | number | boolean>,
        position,
      };
    },
  });

// --- reading a region ------------------------------------------------------------------------

/**
 * The largest box that has actually been measured through this path.
 *
 * 16x16x16 came back in 3.7 seconds over 172 chat lines with nothing lost. Bigger boxes have
 * not been tried, and a limit set past the measurements would be a guess dressed as a
 * capability - so this is the measurement, and a caller wanting more is told to read in
 * pieces rather than left waiting on an unknown.
 */
const MAX_REGION_BLOCKS = 4096;

/** Where the retry starts. Conservative: 24 held for 4096 blocks of ordinary terrain. */
const FIRST_PER_MESSAGE = 24;

export const worldReadRegion = (bridge: WorldBridge) =>
  defineTool({
    name: 'world.read_region',
    title: 'Read a region',
    description: [
      'Read every block in a box and return it as horizontal layers of single characters, bottom layer first, with a palette naming what each character is.',
      'Use this before building anywhere that might already have something in it, and after building to check what actually landed.',
      'The grid can be read the way the structure is shaped — a wall is a run of the same character — and it is the same notation you would use to describe what to build.',
      `The box may hold at most ${MAX_REGION_BLOCKS} blocks (16x16x16). Read a larger area in pieces.`,
      'A "?" in the grid means the chunk was not loaded, so that block was never read. It is NOT air. Do not build into it without reading again once the area is loaded.',
      'The grid carries block ids and NOT block states: a staircase comes back as "oak_stairs" with no facing, a door with no hinge or open flag. Reading a region and building it back somewhere else will straighten every stair and close every door.',
      'Where the state matters, read that position with world.get_block, which does return states. To move or copy something with its states intact, use build.clone_region — it never converts to a grid at all.',
      'Do NOT use this to read one block — world.get_block is one round trip and returns more.',
    ].join(' '),
    inputSchema: {
      corner1: BlockCoordinate.describe('One corner of the box.'),
      corner2: BlockCoordinate.describe('The opposite corner. Order does not matter.'),
      dimension: Dimension,
    },
    outputSchema: {
      origin: z.object(BlockCoordinate.shape).describe('The lowest corner: the [0][0] of the first layer.'),
      size: z
        .object({ x: z.number().int(), y: z.number().int(), z: z.number().int() })
        .describe('Box dimensions in blocks.'),
      palette: z
        .record(z.string(), z.string())
        .describe('Character to block name. "." is air; "?" is not read.'),
      layers: z
        .array(
          z.object({
            y: z.number().int().describe('World height of this grid.'),
            rows: z
              .array(z.string())
              .describe('One string per z (north to south); each character is one x (west to east).'),
          })
        )
        .describe('Bottom to top.'),
      unknown: z
        .number()
        .int()
        .describe('How many blocks were in unloaded chunks. Above zero, the read is partial.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ corner1, corner2, dimension }): Promise<LayeredRegion> => {
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
      const size = { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 };
      const volume = size.x * size.y * size.z;

      if (volume > MAX_REGION_BLOCKS) {
        throw new Error(
          `that box is ${size.x}x${size.y}x${size.z} = ${volume} blocks, over the ${MAX_REGION_BLOCKS} limit. ` +
            `Read it in pieces — for example, one layer's worth at a time.`
        );
      }

      const box = {
        x1: min.x, y1: min.y, z1: min.z,
        x2: max.x, y2: max.y, z2: max.z,
        ...(dimension === undefined ? {} : { dimension }),
      };

      // Halving on refusal rather than predicting. A refusal here means a chat line was too
      // long and vanished, which only happens because the block names turned out longer than
      // the last guess assumed - so the next guess is informed by the failure, and three
      // halvings take 24 down to 3, which no plausible block name overruns.
      let perMessage = FIRST_PER_MESSAGE;
      let lastRefusal: Error | null = null;

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const reply = await bridge.request('readregion', { ...box, perMessage });
          const header = headerOf(reply);
          const blocks = reply.parts.flatMap((part) => {
            const list = (part as { blocks?: unknown }).blocks;
            return Array.isArray(list) ? (list as (string | null)[]) : [];
          });

          // The add-on's own count, checked against what arrived. `assemble` already proved no
          // part is missing; this catches a part that arrived with fewer blocks in it than it
          // should have, which no count of parts would notice.
          const claimed = typeof header.total === 'number' ? header.total : volume;
          if (blocks.length !== claimed) {
            throw new Error(
              `the add-on said ${claimed} blocks and sent ${blocks.length}. The region has not been read completely.`
            );
          }

          return toLayers(min, size, blocks);
        } catch (error) {
          if (!(error instanceof BridgeProtocolError)) throw error;
          // Losing lines is the one failure worth retrying, because the cause is known and
          // the fix is mechanical. Anything else - a timeout, a missing add-on - would only
          // fail the same way again, more slowly.
          lastRefusal = error;
          perMessage = Math.max(1, Math.floor(perMessage / 2));
        }
      }

      throw new Error(
        `the region could not be read whole even at ${perMessage} blocks per message. ` +
          `Last refusal: ${lastRefusal?.message ?? 'unknown'}`
      );
    },
  });

// --- what is alive, and what is in the boxes --------------------------------------------------

export const worldEntities = (bridge: WorldBridge) =>
  defineTool({
    name: 'world.entities',
    title: 'List nearby entities',
    description: [
      'List the entities within a radius of a point: mobs, players, dropped items, the agent — with their positions, and health and name where they have them.',
      'Use this to find out what is alive near a build, or where a player or the agent currently is.',
      'This is the one thing no other route can answer: the world file holds blocks, not creatures.',
      'Do NOT expect it to see beyond loaded chunks — nothing in an unloaded area is listed, and an empty list means "none found here", not "none exist".',
    ].join(' '),
    inputSchema: {
      center: BlockCoordinate.describe('Point to search around.'),
      radius: z.number().int().min(1).max(64).describe('Search radius in blocks. Defaults to 16.').optional(),
      limit: z.number().int().min(1).max(100).describe('Most entities to return. Defaults to 20.').optional(),
      dimension: Dimension,
    },
    outputSchema: {
      total: z.number().int().describe('How many were found, which may exceed the number returned.'),
      returned: z.number().int(),
      entities: z.array(
        z.object({
          type: z.string().describe('Entity id, e.g. "minecraft:cow".'),
          x: z.number(),
          y: z.number(),
          z: z.number(),
          health: z.number().optional(),
          name: z.string().optional().describe('Name tag, when it has one.'),
        })
      ),
    },
    annotations: { readOnlyHint: true },
    handler: async ({ center, radius, limit, dimension }) => {
      const reply = await bridge.request('entities', {
        x: center.x,
        y: center.y,
        z: center.z,
        ...(radius === undefined ? {} : { radius }),
        ...(limit === undefined ? {} : { limit }),
        ...(dimension === undefined ? {} : { dimension }),
      });
      const header = headerOf(reply);
      return {
        total: Number(header.total ?? 0),
        returned: Number(header.returned ?? 0),
        entities: (header.entities ?? []) as unknown[],
      };
    },
  });

export const worldContainer = (bridge: WorldBridge) =>
  defineTool({
    name: 'world.container',
    title: 'Read a container',
    description: [
      'Read what is inside a chest, barrel, furnace, hopper or other container, slot by slot.',
      'Use this to check whether a chest holds what a lesson expects, or to find what a build was stocked with.',
      'A block that is not a container comes back as status "not_a_container" rather than as an error, so it is safe to ask about a position you are not sure of.',
      'Do NOT use this to survey which blocks are chests — it reads one position. Find the chests with world.read_region first, then ask about each.',
    ].join(' '),
    inputSchema: {
      position: BlockCoordinate.describe('The container block.'),
      dimension: Dimension,
    },
    outputSchema: {
      status: z.enum(['read', 'not_loaded', 'not_a_container']),
      block: z.string().nullable().describe('What is actually at that position.'),
      size: z.number().int().nullable().describe('How many slots the container has.'),
      items: z
        .array(
          z.object({
            slot: z.number().int(),
            type: z.string(),
            amount: z.number().int(),
          })
        )
        .describe('Only the occupied slots; empty ones are left out.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ position, dimension }) => {
      const reply = await bridge.request('container', {
        x: position.x,
        y: position.y,
        z: position.z,
        ...(dimension === undefined ? {} : { dimension }),
      });
      const header = headerOf(reply, [NOT_LOADED, NOT_A_CONTAINER]);

      if (header.ok === false) {
        return {
          status: header.error === NOT_LOADED ? ('not_loaded' as const) : ('not_a_container' as const),
          block: header.name === undefined ? null : String(header.name),
          size: null,
          items: [],
        };
      }
      return {
        status: 'read' as const,
        block: String(header.name),
        size: Number(header.size ?? 0),
        items: (header.items ?? []) as unknown[],
      };
    },
  });

/**
 * The world tools, bound to a bridge.
 *
 * A function rather than a constant because these need the connection and the building tools
 * do not. They are still registered when nothing is connected: a model needs to see that
 * reading is possible before it asks, and a call with no game on the other end comes back
 * saying to run `/connect`, which is something the user can act on. Hiding the tools instead
 * would leave it looking like the server cannot read at all.
 */
export function worldTools(bridge: WorldBridge): AnyToolDefinition[] {
  return [
    worldBridgeStatus(bridge),
    worldGetBlock(bridge),
    worldReadRegion(bridge),
    worldEntities(bridge),
    worldContainer(bridge),
  ] as unknown as AnyToolDefinition[];
}

/**
 * A bridge with nothing on the other end.
 *
 * Used when the server is built without a connection - by the tests, and by anything that
 * only wants to inspect the tool surface. Calling it fails the same way an unconnected socket
 * does, which is the point: the surface is identical whether or not Minecraft is running, so
 * a model is never told a capability disappeared when what happened is that nobody connected.
 */
export const offlineBridge: WorldBridge = {
  async request(): Promise<Assembled> {
    throw new Error(
      'Minecraft is not connected. In the game, open the chat and run /connect localhost:19131.'
    );
  },
};
