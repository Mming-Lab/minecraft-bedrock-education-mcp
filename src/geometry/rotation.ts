/**
 * Rotation about a world axis.
 *
 * Results land on the block grid, so a rotation that is not a multiple of 90 degrees will
 * map several source blocks onto the same destination. Callers that need a complete
 * destination volume should collect through {@link PositionCollector}, which drops the
 * repeats, rather than assume the output is the same length as the input.
 */

import { type Position, PositionCollector, requireFiniteNumber, toBlockPosition, InvalidArgumentError } from './core.js';
import type { Axis } from './shapes.js';

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Rotates one block position about `origin`.
 *
 * Right-angle turns are applied by swapping components rather than by going through sine
 * and cosine, so a quarter turn is exact and four of them return the original position.
 * Trigonometric rounding would drift.
 */
export function rotatePoint(point: Position, origin: Position, axis: Axis, degrees: number): Position {
  requireFiniteNumber('degrees', degrees);

  const p = toBlockPosition(point);
  const o = toBlockPosition(origin);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const dz = p.z - o.z;

  // Normalise into [0, 360) so negative and over-full turns behave.
  const normalised = ((degrees % 360) + 360) % 360;

  let u: number;
  let v: number;
  if (normalised % 90 === 0) {
    const quarters = normalised / 90;
    [u, v] = rotateQuarter(planeOf(axis, dx, dy, dz), quarters);
  } else {
    const radians = normalised * DEGREES_TO_RADIANS;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const [a, b] = planeOf(axis, dx, dy, dz);
    u = Math.round(a * cos - b * sin);
    v = Math.round(a * sin + b * cos);
  }

  switch (axis) {
    // The pair for each axis is chosen so that a positive angle turns counter-clockwise
    // when looking down that axis towards the origin.
    case 'x':
      return { x: o.x + dx, y: o.y + u, z: o.z + v };
    case 'y':
      return { x: o.x + v, y: o.y + dy, z: o.z + u };
    case 'z':
      return { x: o.x + u, y: o.y + v, z: o.z + dz };
    default:
      throw new InvalidArgumentError('axis', axis, "must be 'x', 'y' or 'z'");
  }
}

function planeOf(axis: Axis, dx: number, dy: number, dz: number): [number, number] {
  switch (axis) {
    case 'x': return [dy, dz];
    case 'y': return [dz, dx];
    case 'z': return [dx, dy];
    default:
      throw new InvalidArgumentError('axis', axis, "must be 'x', 'y' or 'z'");
  }
}

function rotateQuarter([a, b]: [number, number], quarters: number): [number, number] {
  switch (quarters % 4) {
    case 0: return [a, b];
    case 1: return [-b, a];
    case 2: return [-a, -b];
    default: return [b, -a];
  }
}

/**
 * Rotates a set of blocks, dropping the repeats a non-right-angle turn produces.
 *
 * The output is therefore not necessarily the same length as the input, which is the honest
 * answer: two source blocks really can land on one destination block.
 */
export function rotatePositions(
  positions: readonly Position[],
  origin: Position,
  axis: Axis,
  degrees: number
): Position[] {
  const out = new PositionCollector();
  for (const p of positions) {
    const r = rotatePoint(p, origin, axis, degrees);
    out.add(r.x, r.y, r.z);
  }
  return out.toArray();
}
