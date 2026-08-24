/**
 * Shared primitives for every shape.
 *
 * The legacy implementation had all of this in `coordinate-utils.ts` and then almost never
 * called it: `removeDuplicatePositions` was used by one calculator out of ten, and
 * `shouldPlaceBlock`, `normalizeCoordinate`, `validateCoordinates` and `roundPosition` by
 * none at all. Each calculator re-implemented rounding and the hollow test inline, which is
 * where the divergences came from - the torus decided "hollow" from an angle
 * (`Math.abs(Math.cos(minorAngle)) > 0.6`) while everything else used a distance.
 *
 * So the rule here is that shapes do not make these decisions. They describe a volume; this
 * module decides which blocks fall inside it.
 */

export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Minecraft's addressable space. Y is far narrower than X and Z. */
export const WORLD_BOUNDS = {
  X_MIN: -30_000_000,
  X_MAX: 30_000_000,
  Y_MIN: -64,
  Y_MAX: 320,
  Z_MIN: -30_000_000,
  Z_MAX: 30_000_000,
} as const;

/**
 * Thrown for input that has no sensible answer - a zero radius, a negative height, a
 * degenerate axis.
 *
 * The legacy code returned an empty array for all of these, which reads as "nothing to
 * build" and is indistinguishable from a successful call that happened to produce nothing.
 * Callers could not tell the two apart, so neither could the model driving them.
 */
export class InvalidArgumentError extends Error {
  constructor(
    public readonly parameter: string,
    public readonly value: unknown,
    reason: string
  ) {
    super(`${parameter}=${JSON.stringify(value)} is not usable: ${reason}`);
    this.name = 'InvalidArgumentError';
  }
}

/** Rounds to the block grid. Every shape works in integers from its first line. */
export function toBlock(value: number): number {
  return Math.round(value);
}

export function toBlockPosition(p: Position): Position {
  return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
}

export function isInWorld(p: Position): boolean {
  return (
    p.x >= WORLD_BOUNDS.X_MIN && p.x <= WORLD_BOUNDS.X_MAX &&
    p.y >= WORLD_BOUNDS.Y_MIN && p.y <= WORLD_BOUNDS.Y_MAX &&
    p.z >= WORLD_BOUNDS.Z_MIN && p.z <= WORLD_BOUNDS.Z_MAX
  );
}

// --- argument checks ---------------------------------------------------------------------
// Every shape validates through these, so "what counts as a usable radius" has one answer.

export function requireFiniteNumber(parameter: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new InvalidArgumentError(parameter, value, 'must be a finite number');
  }
  return value;
}

/** A radius must round to at least one block, otherwise the shape has no volume. */
export function requireRadius(parameter: string, value: number): number {
  requireFiniteNumber(parameter, value);
  const rounded = Math.round(value);
  if (rounded < 1) {
    throw new InvalidArgumentError(parameter, value, 'must round to at least 1 block');
  }
  return rounded;
}

/** A length may be as small as one block, but not zero: a zero-height cylinder has no layers. */
export function requireLength(parameter: string, value: number): number {
  requireFiniteNumber(parameter, value);
  const rounded = Math.round(value);
  if (rounded < 1) {
    throw new InvalidArgumentError(parameter, value, 'must round to at least 1 block');
  }
  return rounded;
}

/** A radius that is allowed to collapse to zero, as the waist of a double cone does. */
export function requireNonNegativeRadius(parameter: string, value: number): number {
  requireFiniteNumber(parameter, value);
  const rounded = Math.round(value);
  if (rounded < 0) {
    throw new InvalidArgumentError(parameter, value, 'must not be negative');
  }
  return rounded;
}

export function requireCount(parameter: string, value: number, minimum = 1): number {
  requireFiniteNumber(parameter, value);
  const rounded = Math.round(value);
  if (rounded < minimum) {
    throw new InvalidArgumentError(parameter, value, `must be at least ${minimum}`);
  }
  return rounded;
}

// --- the hollow decision, in one place -----------------------------------------------------

/**
 * Whether a block at `distance` from the surface's centre line belongs to the shape.
 *
 * `radius` and `distance` are compared in the same units the caller chose - squared
 * distances work as well as plain ones, as long as `innerRadius` is squared to match.
 *
 * A hollow shell is one block thick by construction: the block belongs when it is inside
 * the outer surface and outside the inner one.
 */
export function isInShell(distance: number, radius: number, innerRadius: number): boolean {
  return distance <= radius && distance >= innerRadius;
}

/**
 * The inner radius of a one-block shell.
 *
 * Returns 0 for a solid shape, so callers use one comparison for both cases instead of
 * branching. For radius 1 the shell and the solid coincide - a one-block-radius sphere has
 * no interior to remove - which is a property of the geometry, not a special case here.
 */
export function shellInnerRadius(radius: number, hollow: boolean): number {
  return hollow ? Math.max(0, radius - 1) : 0;
}

// --- collection --------------------------------------------------------------------------

/**
 * Accumulates block positions, dropping any that fall outside the world.
 *
 * Shapes iterate the voxel grid, visiting each coordinate once, so duplicates cannot arise
 * the way they did when the legacy torus sampled angles and several samples landed on the
 * same block. The set is kept anyway because `add` is also used by curve tracing, where
 * consecutive samples legitimately round to the same block.
 */
export class PositionCollector {
  private readonly seen = new Set<string>();
  private readonly positions: Position[] = [];

  add(x: number, y: number, z: number): void {
    if (
      x < WORLD_BOUNDS.X_MIN || x > WORLD_BOUNDS.X_MAX ||
      y < WORLD_BOUNDS.Y_MIN || y > WORLD_BOUNDS.Y_MAX ||
      z < WORLD_BOUNDS.Z_MIN || z > WORLD_BOUNDS.Z_MAX
    ) {
      return;
    }

    const key = `${x},${y},${z}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.positions.push({ x, y, z });
  }

  get size(): number {
    return this.positions.length;
  }

  toArray(): Position[] {
    return this.positions;
  }
}

/**
 * Binomial coefficient, computed iteratively.
 *
 * The legacy implementation built this from factorials, so `factorial(171)` overflowed to
 * Infinity and the coefficient became Infinity/Infinity = NaN. Multiplying and dividing in
 * step keeps every intermediate near the size of the result.
 */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;

  let result = 1;
  const half = Math.min(k, n - k);
  for (let i = 0; i < half; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}
