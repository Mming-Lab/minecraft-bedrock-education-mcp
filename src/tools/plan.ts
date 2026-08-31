/**
 * Looking at a shape before it exists.
 *
 * Every other way of checking a build costs a round trip through the game. `world.read_region`
 * reads 4096 blocks in about four seconds, so confirming a radius-32 sphere is roughly five
 * minutes of reads - and it can only be done after the blocks are placed, which is after the
 * mistake is in the world.
 *
 * The server already knows the answer. A shape tool computes every position before it packs
 * them into `/fill` commands; those positions are now kept, and drawing them takes about
 * fifty milliseconds regardless of size. That is the difference between a check a model can
 * run on every attempt and one it runs once and hopes.
 *
 * D-14 recorded that the layer grid's real advantage over geometry was that *the writing is
 * the picture* - a model could see its own mistake before sending it. This gives geometry the
 * same property without giving up the compression: a radius-32 sphere is six numbers going
 * out and a 2.4 kilobyte drawing coming back, where the grid would be 137,065 characters.
 *
 * It draws the plan, not the world. Anything already standing where the shape will go is not
 * in the picture, and neither is terrain. "Will this collide with something" is a different
 * question and `world.read_region` is the tool for it.
 */

import { z } from 'zod';

import { getPlan } from '../plan/store.js';
import { renderPlan } from '../render/png.js';
import { IMAGE_CONTENT, defineTool, type AnyToolDefinition } from './types.js';

const VIEWS = ['front', 'side', 'top'] as const;

export const planPreview = defineTool({
  name: 'plan.preview',
  title: 'Draw a plan',
  description: [
    'Draw a shape you have worked out, as a picture, without touching the world.',
    'Pass the planId that came back from any build.* call. Set dryRun on that call to work the shape out without placing it, look at the drawing, and only build once it is the shape you meant.',
    'The picture is an orthographic elevation with nearer blocks drawn lighter — no perspective, no textures. It answers "is this the shape I intended", which the parameters cannot, and deliberately not "does this look good".',
    'It draws the plan and nothing else. Terrain and anything already standing there are not in it, so it cannot tell you whether the shape will collide with something — read the region with world.read_region for that.',
    'Do NOT use this to check what is in the world. It has never looked at the world; it draws the positions the shape function computed.',
  ].join(' '),
  inputSchema: {
    planId: z
      .string()
      .describe('The planId from a build.* result. Plans age out, so draw it in the same session that made it.'),
    view: z
      .enum(VIEWS)
      .describe(
        'front looks north from the south (east to the right). side looks west from the east (south to the right). top looks down (east right, north up).'
      )
      .optional(),
    size: z
      .number()
      .int()
      .min(64)
      .max(512)
      .describe('Width and height of the picture in pixels. Default 256.')
      .optional(),
  },
  outputSchema: {
    planId: z.string(),
    view: z.enum(VIEWS),
    shape: z.string().describe('Which tool made the plan.'),
    block: z.string(),
    blockCount: z.number().int(),
    width: z.number().int(),
    height: z.number().int(),
    scale: z.number().int().describe('Pixels per block. 1 means the plan was too big to enlarge.'),
    spanAcross: z.number().int().describe('Blocks across the picture, before scaling.'),
    spanUp: z.number().int().describe('Blocks up the picture, before scaling.'),
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: ({ planId, view, size }) => {
    const plan = getPlan(planId);
    if (!plan) {
      // A plan that aged out and one that never existed are the same answer, because the
      // caller does the same thing about both.
      throw new Error(
        `no plan ${JSON.stringify(planId)}. Plans are kept for a while and then dropped — ` +
          'call the build tool again, with dryRun set if you do not want it placed yet, and use the planId it returns.'
      );
    }

    const chosen = view ?? 'front';
    const drawn = renderPlan(plan.positions, chosen, size ?? 256, size ?? 256);

    return {
      planId,
      view: chosen,
      shape: plan.shape,
      // The id alone. The picture is a silhouette with depth shading and does not draw block
      // colours, so the states have nothing to say here - they matter when the plan is placed.
      block: plan.block.id,
      blockCount: plan.positions.length,
      width: drawn.width,
      height: drawn.height,
      scale: drawn.scale,
      spanAcross: drawn.spanAcross,
      spanUp: drawn.spanUp,
      // Hung on a symbol so it does not land in the JSON the model reads. A base64 PNG there
      // would be tens of kilobytes of context spent on something it cannot read as text.
      [IMAGE_CONTENT]: { data: drawn.png.toString('base64'), mimeType: 'image/png' },
    };
  },
});

export function planTools(): AnyToolDefinition[] {
  return [planPreview] as unknown as AnyToolDefinition[];
}
