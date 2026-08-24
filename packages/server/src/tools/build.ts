/**
 * Building tools: one tool per shape, no `action` string to dispatch on.
 *
 * The legacy server bundled everything behind an `action` enum, which forced the input
 * schema to be the union of every action's parameters. Nothing could be marked required,
 * so the model had to infer which arguments a given action wanted — and the descriptions it
 * inferred from were wrong often enough to matter (`world` advertised three actions that
 * did not exist, and `sequence` advertised eight cross-tool actions of which none did).
 *
 * With one tool per shape, `required` is accurate and there is no action name to get wrong.
 *
 * Every description states when NOT to reach for the tool. That is the half a model
 * actually needs: what a tool does is usually guessable from its name, whereas which of two
 * similar tools to pick is not.
 */

import { z } from 'zod';
import {
  AxisSchema,
  BlockCoordinate,
  BlockId,
  BuildResult,
  HollowFlag,
  defineTool,
  summariseBuild,
} from './types.js';
import * as geometry from '../geometry/index.js';

const centre = BlockCoordinate.describe('Centre of the shape.');

export const buildCube = defineTool({
  name: 'build.cube',
  title: 'Cuboid',
  description: [
    'Fill the box between two opposite corners. The corners may be given in any order.',
    'Use this for walls, floors, platforms and rooms — anything rectangular.',
    'Do NOT pass air to clear a region — clearing is a separate, destructive operation and is not what this tool is for.',
  ].join(' '),
  inputSchema: {
    corner1: BlockCoordinate.describe('One corner of the box.'),
    corner2: BlockCoordinate.describe('The opposite corner.'),
    block: BlockId,
    hollow: HollowFlag.optional(),
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ corner1, corner2, block, hollow }) =>
    summariseBuild(geometry.cuboid(corner1, corner2, hollow ?? false), block, hollow ?? false),
});

export const buildSphere = defineTool({
  name: 'build.sphere',
  title: 'Sphere',
  description: [
    'Build a sphere, or an ellipsoid when the three radii differ.',
    'Use one radius for a ball or dome; use three for a stretched or squashed shape.',
    'Do NOT use this for a cylinder or a circle — build.cylinder gives flat ends, and a single disc is build.cylinder with height 1.',
    'A hollow sphere is a shell one block thick.',
  ].join(' '),
  inputSchema: {
    center: centre,
    radius: z
      .number().int().min(1).max(64)
      .describe('Radius in blocks, the same on every axis. Give this for a ball, or give all three of radiusX/Y/Z instead.')
      .optional(),
    radiusX: z.number().int().min(1).max(64).describe('East-west radius. Give all three or none.').optional(),
    radiusY: z.number().int().min(1).max(64).describe('Vertical radius. Give all three or none.').optional(),
    radiusZ: z.number().int().min(1).max(64).describe('North-south radius. Give all three or none.').optional(),
    block: BlockId,
    hollow: HollowFlag.optional(),
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ center, radius, radiusX, radiusY, radiusZ, block, hollow }) => {
    const rx = radiusX ?? radius;
    const ry = radiusY ?? radius;
    const rz = radiusZ ?? radius;
    if (rx === undefined || ry === undefined || rz === undefined) {
      throw new Error('give either `radius`, or all three of `radiusX`, `radiusY` and `radiusZ`');
    }
    return summariseBuild(
      geometry.ellipsoid(center, rx, ry, rz, hollow ?? false),
      block,
      hollow ?? false
    );
  },
});

export const buildCylinder = defineTool({
  name: 'build.cylinder',
  title: 'Cylinder',
  description: [
    'Build a cylinder along one axis. Height 1 gives a flat disc.',
    'Use this for pillars, towers, wells and round floors.',
    'Do NOT use this for a cone or a funnel — build.cone tapers, this does not.',
    'A hollow cylinder is a tube with solid ends, so it holds water or lava.',
  ].join(' '),
  inputSchema: {
    center: centre.describe('Centre of the base layer.'),
    radius: z.number().int().min(1).max(64).describe('Radius of the circular cross-section.'),
    height: z.number().int().min(1).max(384).describe('Number of layers. 1 gives a disc.'),
    axis: AxisSchema.optional(),
    block: BlockId,
    hollow: HollowFlag.optional(),
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ center, radius, height, axis, block, hollow }) =>
    summariseBuild(
      geometry.cylinder(center, radius, height, axis ?? 'y', hollow ?? false),
      block,
      hollow ?? false
    ),
});

export const buildCone = defineTool({
  name: 'build.cone',
  title: 'Cone',
  description: [
    'Build a cone tapering from a circular base to a point.',
    'Use this for roofs, spires and trees.',
    'Do NOT use this for a dish or an antenna — build.revolution with shape "paraboloid" curves, a cone is straight-sided.',
  ].join(' '),
  inputSchema: {
    center: centre.describe('Centre of the circular base.'),
    radius: z.number().int().min(1).max(64).describe('Radius at the base.'),
    height: z.number().int().min(1).max(384).describe('Distance from the base to the tip.'),
    axis: AxisSchema.optional(),
    block: BlockId,
    hollow: HollowFlag.optional(),
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ center, radius, height, axis, block, hollow }) =>
    summariseBuild(
      geometry.cone(center, radius, height, axis ?? 'y', hollow ?? false),
      block,
      hollow ?? false
    ),
});

export const buildTorus = defineTool({
  name: 'build.torus',
  title: 'Torus',
  description: [
    'Build a ring. majorRadius is the distance from the centre to the middle of the tube; minorRadius is the tube itself.',
    'Use this for arches, portals and fountain rims.',
    'Do NOT use this for a plain ring on the ground — a hollow build.cylinder with height 1 is simpler and cheaper.',
    'minorRadius must be smaller than majorRadius, or the hole closes up.',
  ].join(' '),
  inputSchema: {
    center: centre,
    majorRadius: z.number().int().min(2).max(64).describe('Centre of the ring to the centre of the tube.'),
    minorRadius: z.number().int().min(1).max(32).describe('Radius of the tube.'),
    axis: AxisSchema.optional().describe("Axis the ring lies around. 'y' lays it flat on the ground."),
    block: BlockId,
    hollow: HollowFlag.optional(),
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ center, majorRadius, minorRadius, axis, block, hollow }) =>
    summariseBuild(
      geometry.torus(center, majorRadius, minorRadius, axis ?? 'y', hollow ?? false),
      block,
      hollow ?? false
    ),
});

/**
 * One tool covers the paraboloid and the hyperboloid because both are a radius profile swept
 * along an axis; splitting them would mean two nearly identical schemas and a choice the
 * model has to make on a distinction it cannot see from the names.
 */
export const buildRevolution = defineTool({
  name: 'build.revolution',
  title: 'Surface of revolution',
  description: [
    'Build a shape formed by sweeping a curve around an axis.',
    '"paraboloid" is a dish that widens with height — satellite dishes, bowls, fountains.',
    '"hyperboloid" is an hourglass, narrowest at the waist — cooling towers, pinched columns.',
    'Do NOT use this for a straight-sided taper; that is build.cone.',
    'For the hyperboloid, baseRadius is the radius at both ends and waistRadius the narrowest point; waistRadius must not exceed baseRadius.',
  ].join(' '),
  inputSchema: {
    center: centre.describe('Centre of the base layer.'),
    shape: z
      .enum(['paraboloid', 'hyperboloid'])
      .describe('"paraboloid" widens with height like a dish; "hyperboloid" pinches in at the middle like an hourglass.'),
    height: z.number().int().min(2).max(384).describe('Number of layers along the axis. At least 2.'),
    radius: z.number().int().min(1).max(64).describe('Paraboloid only: radius at the rim.').optional(),
    baseRadius: z.number().int().min(1).max(64).describe('Hyperboloid only: radius at both ends.').optional(),
    waistRadius: z.number().int().min(0).max(64).describe('Hyperboloid only: radius at the narrowest point. 0 gives a double cone.').optional(),
    axis: AxisSchema.optional(),
    block: BlockId,
    hollow: HollowFlag.optional(),
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ center, shape, height, radius, baseRadius, waistRadius, axis, block, hollow }) => {
    const solid = hollow ?? false;
    if (shape === 'paraboloid') {
      if (radius === undefined) throw new Error('`radius` is required for shape "paraboloid"');
      return summariseBuild(
        geometry.paraboloid(center, radius, height, axis ?? 'y', solid),
        block,
        solid
      );
    }
    if (baseRadius === undefined || waistRadius === undefined) {
      throw new Error('`baseRadius` and `waistRadius` are required for shape "hyperboloid"');
    }
    return summariseBuild(
      geometry.hyperboloid(center, baseRadius, waistRadius, height, axis ?? 'y', solid),
      block,
      solid
    );
  },
});

export const buildLine = defineTool({
  name: 'build.line',
  title: 'Line',
  description: [
    'Draw a straight line of blocks between two points.',
    'Use this for beams, rails, wires and edges.',
    'Do NOT use this to fill a rectangular region — build.cube does that in one call.',
  ].join(' '),
  inputSchema: {
    start: BlockCoordinate.describe('First block of the line.'),
    end: BlockCoordinate.describe('Last block of the line. Both ends are included.'),
    block: BlockId,
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ start, end, block }) => summariseBuild(geometry.line(start, end), block),
});

export const buildHelix = defineTool({
  name: 'build.helix',
  title: 'Helix',
  description: [
    'Draw a spiral winding around an axis.',
    'Use this for spiral staircases, DNA models and helical ramps.',
    'Do NOT use this for a vertical line — that is build.line; a helix with no turns is rejected.',
    'The result is a curve one block wide, not a solid; stack or thicken it separately if you need steps.',
  ].join(' '),
  inputSchema: {
    center: centre.describe('Centre of the base of the spiral.'),
    radius: z.number().int().min(1).max(64).describe('Distance from the axis to the curve.'),
    height: z.number().int().min(1).max(384).describe('Rise over the whole spiral.'),
    turns: z.number().min(0.25).max(64).describe('Full revolutions over the height. Fractions are allowed.'),
    axis: AxisSchema.optional(),
    clockwise: z.boolean().optional().describe('Direction of the winding, seen looking along the axis.'),
    block: BlockId,
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ center, radius, height, turns, axis, clockwise, block }) =>
    summariseBuild(
      geometry.helix(center, radius, height, turns, axis ?? 'y', clockwise ?? true),
      block
    ),
});

export const buildCurve = defineTool({
  name: 'build.curve',
  title: 'Bezier curve',
  description: [
    'Draw a smooth curve from start to end, bent by the control points.',
    'Use this for arches, roads, rivers and anything that should not be straight.',
    'Do NOT use this without control points — with none it is a straight line, and build.line is clearer.',
    'The curve is traced one block wide with no gaps; more control points bend it more sharply.',
  ].join(' '),
  inputSchema: {
    start: BlockCoordinate.describe('Where the curve begins.'),
    end: BlockCoordinate.describe('Where the curve ends.'),
    controlPoints: z
      .array(BlockCoordinate)
      .min(1)
      .max(16)
      .describe('Points the curve bends towards. It does not pass through them.'),
    segments: z
      .number()
      .int()
      .min(1)
      .max(4096)
      .optional()
      .describe('Sample count. Leave unset — the default follows the length of the curve.'),
    block: BlockId,
  },
  outputSchema: BuildResult.shape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: ({ start, end, controlPoints, segments, block }) =>
    summariseBuild(geometry.bezier(start, end, controlPoints, segments), block),
});

export const buildTools = [
  buildCube,
  buildSphere,
  buildCylinder,
  buildCone,
  buildTorus,
  buildRevolution,
  buildLine,
  buildHelix,
  buildCurve,
];
