/**
 * Building from a layer grid - the same notation `world.read_region` answers in.
 *
 * The shape tools describe a thing by its parameters. That is the right way to say "a sphere
 * of radius eight", and the wrong way to say "this wall, but with the door one block left":
 * to move one block of a sphere you have to stop describing a sphere. Parameters also cannot
 * be proof-read. A model that writes `radius: 8` has to imagine what comes out, and if the
 * imagining is wrong there is nothing in front of it that says so.
 *
 * A grid can be proof-read, because the output *is* the input. And it can be edited in place:
 * change the character, leave everything else alone.
 *
 * ## Why it takes exactly what read_region gives back
 *
 * The point is the round trip. Read a region, change three characters, send it back. That only
 * works if the two notations are the same one, so this accepts the reading tool's output
 * unmodified - including the `?` entries in its palette, which describe unread blocks rather
 * than naming a block, and would otherwise fail validation on the way back in.
 *
 * ## Two reserved characters, and the difference between them
 *
 *   `.`  air - place air here, clearing whatever was there
 *   `?`  leave alone - do not touch this position at all
 *
 * They are not interchangeable and the distinction is the whole reason a partial edit works.
 * `?` is what `read_region` writes where a chunk was not loaded, and reading it as "put air
 * here" would have a model clear ground it never saw. Writing back a region that was partly
 * unread is therefore safe by construction: the parts nobody looked at are the parts nobody
 * touches.
 */

import { z } from 'zod';
import type { CommandRunner } from '../bridge/index.js';
import { normalizeBlockId } from '../commands/index.js';
import { placeGroups, type BlockGroup } from '../execute/placer.js';
import type { Position } from '../geometry/index.js';
import { AIR_SYMBOL, UNKNOWN_SYMBOL } from '../world/layers.js';
import { BlockCoordinate, defineTool, type AnyToolDefinition } from './types.js';

/**
 * The most cells a grid may describe.
 *
 * The `/fill` limit, which is what one command can cover; a grid this size is 32k characters
 * of input, so the practical ceiling arrives well before this one does.
 */
const MAX_CELLS = 32768;

export const buildLayersTool = (runner: CommandRunner) =>
  defineTool({
    name: 'build.layers',
    title: 'Build from a layer grid',
    description: [
      'Build from horizontal layers of single characters — the same notation world.read_region returns.',
      'Use this for anything a parameter cannot describe: rooms with doors and windows, asymmetric structures, lettering, patterns, or a small edit to something that is already there.',
      'The intended loop is read, change, send back: world.read_region a region, change the characters you want changed, and pass the result here unmodified. Its palette and layers go straight in.',
      '"." is air and will clear what is there. "?" means leave that position completely alone — so a region that was partly unread can be written back safely, and so a small change does not have to describe the whole area.',
      'Do NOT use this for spheres, cylinders, cones, tori or helices — build.sphere and the other shape tools compute those exactly, and a hand-sliced curve comes out lumpy.',
      'Do NOT use it for large plain volumes either: build.cube fills a box with two corners rather than thousands of characters.',
    ].join(' '),
    inputSchema: {
      origin: BlockCoordinate.describe(
        'The block at the first character of the first row of the bottom layer. Everything else is placed relative to it.'
      ),
      palette: z
        .record(z.string(), z.string())
        .describe(
          'One character to one block id, e.g. { "a": "stone", "b": "oak_planks" }. ' +
            '"." and "?" are reserved and any entry for them is ignored, so read_region\'s palette can be passed through as it is.'
        ),
      layers: z
        .array(
          z.object({
            y: z
              .number()
              .int()
              .optional()
              .describe('Optional. If given it must match origin.y plus this layer\'s index — a guard against a grid that got reordered.'),
            rows: z
              .array(z.string())
              .min(1)
              .describe('One string per row, north to south. Each character is one block, west to east.'),
          })
        )
        .min(1)
        .describe('Bottom layer first, going up. Every layer must be the same size.'),
    },
    outputSchema: {
      blockCount: z.number().int().describe('How many blocks were placed, air included.'),
      untouched: z.number().int().describe('How many positions were left alone because of a "?".'),
      bounds: z
        .object({ min: z.object(BlockCoordinate.shape), max: z.object(BlockCoordinate.shape) })
        .describe('The box the grid covers.'),
      kinds: z
        .array(z.object({ block: z.string(), count: z.number().int() }))
        .describe('What was placed, commonest first.'),
      commandCount: z.number().int(),
      unsent: z.array(z.object({ commandLine: z.string(), reason: z.string() })),
      negative: z.array(z.object({ commandLine: z.string(), statusMessage: z.string() })),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: async ({ origin, palette, layers }) => {
      const height = layers.length;
      const depth = layers[0]!.rows.length;
      const width = layers[0]!.rows[0]?.length ?? 0;

      if (width === 0) throw new Error('the first row is empty; a grid needs at least one block');
      if (height * depth * width > MAX_CELLS) {
        throw new Error(
          `that grid is ${width}x${height}x${depth} = ${height * depth * width} cells, over the ${MAX_CELLS} limit. Build it in pieces.`
        );
      }

      // Every layer the same size. A ragged grid is almost always a row that lost or gained a
      // character during an edit, and placing it anyway would shift everything after it.
      layers.forEach((layer, index) => {
        if (layer.y !== undefined && layer.y !== origin.y + index) {
          throw new Error(
            `layer ${index} says y=${layer.y} but sits at y=${origin.y + index} counting up from origin. ` +
              `Either the layers are out of order or origin.y is wrong.`
          );
        }
        if (layer.rows.length !== depth) {
          throw new Error(
            `layer ${index} has ${layer.rows.length} rows and layer 0 has ${depth}; every layer must be the same size`
          );
        }
        layer.rows.forEach((row, z) => {
          if (row.length !== width) {
            throw new Error(
              `layer ${index} row ${z} is ${row.length} characters and the first row is ${width}; ` +
                `a row that lost or gained a character shifts everything after it`
            );
          }
        });
      });

      // Reserved characters never reach the palette lookup, so an entry for them - which
      // read_region's palette has for `?` - is ignored rather than validated as a block id.
      const blockFor = new Map<string, string>();
      for (const [symbol, name] of Object.entries(palette)) {
        if (symbol === AIR_SYMBOL || symbol === UNKNOWN_SYMBOL) continue;
        if (symbol.length !== 1) {
          throw new Error(`palette key ${JSON.stringify(symbol)} is not a single character`);
        }
        blockFor.set(symbol, normalizeBlockId(name, `palette[${JSON.stringify(symbol)}]`));
      }

      const byBlock = new Map<string, Position[]>();
      let untouched = 0;

      layers.forEach((layer, y) => {
        layer.rows.forEach((row, z) => {
          [...row].forEach((symbol, x) => {
            if (symbol === UNKNOWN_SYMBOL) {
              untouched++;
              return;
            }
            const block = symbol === AIR_SYMBOL ? 'minecraft:air' : blockFor.get(symbol);
            if (block === undefined) {
              throw new Error(
                `layer ${y}, row ${z}, column ${x} is ${JSON.stringify(symbol)}, which the palette does not name. ` +
                  `Add it to the palette, or use "." for air or "?" to leave that block alone.`
              );
            }
            const positions = byBlock.get(block) ?? [];
            positions.push({ x: origin.x + x, y: origin.y + y, z: origin.z + z });
            byBlock.set(block, positions);
          });
        });
      });

      const groups: BlockGroup[] = [...byBlock.entries()].map(([block, positions]) => ({ block, positions }));
      const blockCount = groups.reduce((total, group) => total + group.positions.length, 0);
      if (blockCount === 0) {
        throw new Error('every position in the grid is "?", so there is nothing to build');
      }

      const report = await placeGroups(runner, groups);

      return {
        blockCount,
        untouched,
        bounds: {
          min: origin,
          max: { x: origin.x + width - 1, y: origin.y + height - 1, z: origin.z + depth - 1 },
        },
        kinds: groups
          .map((group) => ({ block: String(group.block), count: group.positions.length }))
          .sort((a, b) => b.count - a.count || (a.block < b.block ? -1 : 1)),
        commandCount: report.commandCount,
        unsent: report.unsent,
        negative: report.negative,
      };
    },
  });

export function layerTools(runner: CommandRunner): AnyToolDefinition[] {
  return [buildLayersTool(runner)] as unknown as AnyToolDefinition[];
}
