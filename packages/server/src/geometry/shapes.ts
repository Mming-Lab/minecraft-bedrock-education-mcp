/**
 * Closed surfaces, all traced the same way: walk the voxel grid inside the shape's bounding
 * box and ask whether each block belongs.
 *
 * The legacy torus and helix instead sampled a parameter (an angle, a curve position) and
 * rounded each sample to a block. That is fine for a curve, which is one-dimensional, but
 * for a surface it means several samples land on the same block - the legacy torus emitted
 * 1152 positions covering 868 distinct blocks - and it makes the hollow test a question
 * about the parameter rather than about the geometry.
 *
 * Walking the grid visits each block once, so duplicates cannot occur, and "is this block
 * in the shell?" is asked of the block itself.
 */

import {
  type Position,
  PositionCollector,
  binomial,
  isInShell,
  requireCount,
  requireFiniteNumber,
  requireLength,
  requireNonNegativeRadius,
  requireRadius,
  shellInnerRadius,
  toBlockPosition,
  InvalidArgumentError,
} from './core.js';

export type Axis = 'x' | 'y' | 'z';

/** Maps an (along-axis, u, v) triple onto world coordinates for the chosen axis. */
function axisMapper(axis: Axis, centre: Position) {
  switch (axis) {
    case 'x':
      return (along: number, u: number, v: number) => [centre.x + along, centre.y + u, centre.z + v] as const;
    case 'z':
      return (along: number, u: number, v: number) => [centre.x + u, centre.y + v, centre.z + along] as const;
    case 'y':
      return (along: number, u: number, v: number) => [centre.x + u, centre.y + along, centre.z + v] as const;
    default:
      throw new InvalidArgumentError('axis', axis, "must be 'x', 'y' or 'z'");
  }
}

// --- cuboid --------------------------------------------------------------------------------

export function cuboid(corner1: Position, corner2: Position, hollow = false): Position[] {
  const a = toBlockPosition(corner1);
  const b = toBlockPosition(corner2);
  for (const [name, p] of [['corner1', a], ['corner2', b]] as const) {
    requireFiniteNumber(`${name}.x`, p.x);
    requireFiniteNumber(`${name}.y`, p.y);
    requireFiniteNumber(`${name}.z`, p.z);
  }

  // Corners may be given in any order.
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);

  const out = new PositionCollector();
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (hollow && x > minX && x < maxX && y > minY && y < maxY && z > minZ && z < maxZ) continue;
        out.add(x, y, z);
      }
    }
  }
  return out.toArray();
}

// --- ellipsoid and sphere --------------------------------------------------------------------

/**
 * Membership uses the normalised distance (x/rx)² + (y/ry)² + (z/rz)², which is 1 on the
 * surface whatever the radii are, so one shell test covers spheres and ellipsoids alike.
 */
export function ellipsoid(
  centre: Position,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
  hollow = false
): Position[] {
  const c = toBlockPosition(centre);
  const rx = requireRadius('radiusX', radiusX);
  const ry = requireRadius('radiusY', radiusY);
  const rz = requireRadius('radiusZ', radiusZ);

  // The inner surface is one block in along the shortest axis; scaling it by that axis keeps
  // the shell an even thickness instead of thinning where the radius is largest.
  const shortest = Math.min(rx, ry, rz);
  const innerScale = hollow ? Math.max(0, (shortest - 1) / shortest) : 0;
  const innerNormalised = innerScale * innerScale;

  const out = new PositionCollector();
  for (let dx = -rx; dx <= rx; dx++) {
    const nx = (dx / rx) ** 2;
    for (let dy = -ry; dy <= ry; dy++) {
      const ny = (dy / ry) ** 2;
      if (nx + ny > 1) continue;
      for (let dz = -rz; dz <= rz; dz++) {
        const normalised = nx + ny + (dz / rz) ** 2;
        if (!isInShell(normalised, 1, innerNormalised)) continue;
        out.add(c.x + dx, c.y + dy, c.z + dz);
      }
    }
  }
  return out.toArray();
}

export function sphere(centre: Position, radius: number, hollow = false): Position[] {
  const r = requireRadius('radius', radius);
  return ellipsoid(centre, r, r, r, hollow);
}

// --- disc and cylinder -------------------------------------------------------------------------

/**
 * A filled or hollow disc.
 *
 * "Hollow" here means an annulus one block thick, matching every other shape's shell. That
 * is deliberately not the midpoint-circle outline the MakeCode extension draws: the outline
 * is thinner and leaves diagonal gaps when stacked into a cylinder wall.
 */
export function disc(centre: Position, radius: number, axis: Axis = 'y', hollow = false): Position[] {
  const c = toBlockPosition(centre);
  const r = requireRadius('radius', radius);
  const inner = shellInnerRadius(r, hollow);
  const map = axisMapper(axis, c);

  const rSquared = r * r;
  const innerSquared = inner * inner;

  const out = new PositionCollector();
  for (let u = -r; u <= r; u++) {
    for (let v = -r; v <= r; v++) {
      const d = u * u + v * v;
      if (!isInShell(d, rSquared, innerSquared)) continue;
      const [x, y, z] = map(0, u, v);
      out.add(x, y, z);
    }
  }
  return out.toArray();
}

export function cylinder(
  centre: Position,
  radius: number,
  height: number,
  axis: Axis = 'y',
  hollow = false
): Position[] {
  const c = toBlockPosition(centre);
  const r = requireRadius('radius', radius);
  const h = requireLength('height', height);
  const inner = shellInnerRadius(r, hollow);
  const map = axisMapper(axis, c);

  const rSquared = r * r;
  const innerSquared = inner * inner;

  const out = new PositionCollector();
  for (let along = 0; along < h; along++) {
    // A hollow cylinder keeps its end caps solid; otherwise it is a tube, not a cylinder.
    const isCap = hollow && (along === 0 || along === h - 1);
    for (let u = -r; u <= r; u++) {
      for (let v = -r; v <= r; v++) {
        const d = u * u + v * v;
        if (d > rSquared) continue;
        if (!isCap && d < innerSquared) continue;
        const [x, y, z] = map(along, u, v);
        out.add(x, y, z);
      }
    }
  }
  return out.toArray();
}

/** A cone tapering from `radius` at the base to a point at the far end. */
export function cone(
  centre: Position,
  radius: number,
  height: number,
  axis: Axis = 'y',
  hollow = false
): Position[] {
  const c = toBlockPosition(centre);
  const r = requireRadius('radius', radius);
  const h = requireLength('height', height);
  const map = axisMapper(axis, c);

  const out = new PositionCollector();
  for (let along = 0; along < h; along++) {
    const layerRadius = Math.round(r * (1 - along / h));
    if (layerRadius < 0) continue;
    const inner = shellInnerRadius(layerRadius, hollow);
    const rSquared = layerRadius * layerRadius;
    const innerSquared = inner * inner;
    const isCap = hollow && along === 0;

    for (let u = -layerRadius; u <= layerRadius; u++) {
      for (let v = -layerRadius; v <= layerRadius; v++) {
        const d = u * u + v * v;
        if (d > rSquared) continue;
        if (!isCap && d < innerSquared) continue;
        const [x, y, z] = map(along, u, v);
        out.add(x, y, z);
      }
    }
  }
  return out.toArray();
}

// --- torus -----------------------------------------------------------------------------------

/**
 * Distance from the tube's centre circle decides membership, so the shell is a real shell
 * rather than a band of angles.
 */
export function torus(
  centre: Position,
  majorRadius: number,
  minorRadius: number,
  axis: Axis = 'y',
  hollow = false
): Position[] {
  const c = toBlockPosition(centre);
  const major = requireRadius('majorRadius', majorRadius);
  const minor = requireRadius('minorRadius', minorRadius);
  const inner = shellInnerRadius(minor, hollow);
  const map = axisMapper(axis, c);

  const minorSquared = minor * minor;
  const innerSquared = inner * inner;
  const extent = major + minor;

  const out = new PositionCollector();
  for (let u = -extent; u <= extent; u++) {
    for (let v = -extent; v <= extent; v++) {
      const fromAxis = Math.sqrt(u * u + v * v);
      const fromRing = fromAxis - major;
      const fromRingSquared = fromRing * fromRing;
      if (fromRingSquared > minorSquared) continue;

      const reach = Math.floor(Math.sqrt(minorSquared - fromRingSquared));
      for (let along = -reach; along <= reach; along++) {
        const d = fromRingSquared + along * along;
        if (!isInShell(d, minorSquared, innerSquared)) continue;
        const [x, y, z] = map(along, u, v);
        out.add(x, y, z);
      }
    }
  }
  return out.toArray();
}

// --- surfaces of revolution ---------------------------------------------------------------------

/**
 * Sweeps a radius profile along an axis: one routine behind the paraboloid, the hyperboloid
 * and anything else defined by "radius as a function of height".
 *
 * @param profile radius at a given layer, 0-indexed from the base
 */
export function revolution(
  centre: Position,
  height: number,
  profile: (layer: number, height: number) => number,
  axis: Axis = 'y',
  hollow = false
): Position[] {
  const c = toBlockPosition(centre);
  const h = requireLength('height', height);
  const map = axisMapper(axis, c);

  const out = new PositionCollector();
  for (let along = 0; along < h; along++) {
    const raw = profile(along, h);
    if (!Number.isFinite(raw)) {
      throw new InvalidArgumentError('profile', raw, `radius at layer ${along} is not finite`);
    }
    const layerRadius = Math.max(0, Math.round(raw));
    const inner = shellInnerRadius(layerRadius, hollow);
    const rSquared = layerRadius * layerRadius;
    const innerSquared = inner * inner;
    const isCap = hollow && (along === 0 || along === h - 1);

    for (let u = -layerRadius; u <= layerRadius; u++) {
      for (let v = -layerRadius; v <= layerRadius; v++) {
        const d = u * u + v * v;
        if (d > rSquared) continue;
        if (!isCap && d < innerSquared) continue;
        const [x, y, z] = map(along, u, v);
        out.add(x, y, z);
      }
    }
  }
  return out.toArray();
}

/** A paraboloid whose radius reaches `radius` at the top layer. */
export function paraboloid(
  centre: Position,
  radius: number,
  height: number,
  axis: Axis = 'y',
  hollow = false
): Position[] {
  const r = requireRadius('radius', radius);
  const h = requireCount('height', height, 2);
  // A paraboloid needs a floor and a rim; one layer is a disc, not a paraboloid. Requiring
  // two also means `h - 1` below is never zero, so the profile needs no guard.
  //
  // r(layer) = radius * sqrt(layer / (height - 1)), which reaches exactly `radius` at the
  // top layer. The legacy version derived a focal length by dividing by the height, which
  // was Infinity at height zero and produced NaN radii from there on; it also topped out
  // below `radius`, so the parameter did not mean what its name said.
  return revolution(centre, h, (layer) => r * Math.sqrt(layer / (h - 1)), axis, hollow);
}

/**
 * A hyperboloid of one sheet, narrowest at the waist.
 *
 * Both radii are absolute block counts. The legacy MCP server took the waist as a *ratio*
 * and computed `radius * sqrt(waist² + t²)`, which made `radius` neither the waist nor the
 * maximum, and the MakeCode extension derived its widening term as `base - waist`, which
 * left the ends at `sqrt(waist² + (base-waist)²)` rather than at `base`. Here the profile is
 * solved so that the ends really are `baseRadius`.
 */
export function hyperboloid(
  centre: Position,
  baseRadius: number,
  waistRadius: number,
  height: number,
  axis: Axis = 'y',
  hollow = false
): Position[] {
  const base = requireRadius('baseRadius', baseRadius);
  const waist = requireNonNegativeRadius('waistRadius', waistRadius);
  const h = requireLength('height', height);

  if (waist > base) {
    throw new InvalidArgumentError(
      'waistRadius',
      waistRadius,
      `must not exceed baseRadius (${base}); a barrel is not a hyperboloid of one sheet`
    );
  }

  // r(t) = sqrt(waist² + (t*b)²) with t in [-1, 1]. Solving r(±1) = base gives b.
  const b = Math.sqrt(base * base - waist * waist);
  const half = Math.max(1, (h - 1) / 2);

  return revolution(
    centre,
    h,
    (layer) => {
      const t = (layer - (h - 1) / 2) / half;
      return Math.sqrt(waist * waist + (t * b) ** 2);
    },
    axis,
    hollow
  );
}

// --- curves -------------------------------------------------------------------------------------
// A curve is one-dimensional, so it is traced by sampling rather than by walking a volume.
// Consecutive samples can round to the same block, which is why PositionCollector dedupes.

/** Straight line between two blocks, via a 3D Bresenham walk. */
export function line(start: Position, end: Position): Position[] {
  const a = toBlockPosition(start);
  const b = toBlockPosition(end);

  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const dz = Math.abs(b.z - a.z);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  const sz = a.z < b.z ? 1 : -1;

  const out = new PositionCollector();
  let { x, y, z } = a;

  // Step along whichever axis spans the most blocks so no block along the way is skipped.
  if (dx >= dy && dx >= dz) {
    let ey = 2 * dy - dx;
    let ez = 2 * dz - dx;
    for (let i = 0; i <= dx; i++) {
      out.add(x, y, z);
      if (ey > 0) { y += sy; ey -= 2 * dx; }
      if (ez > 0) { z += sz; ez -= 2 * dx; }
      ey += 2 * dy;
      ez += 2 * dz;
      x += sx;
    }
  } else if (dy >= dx && dy >= dz) {
    let ex = 2 * dx - dy;
    let ez = 2 * dz - dy;
    for (let i = 0; i <= dy; i++) {
      out.add(x, y, z);
      if (ex > 0) { x += sx; ex -= 2 * dy; }
      if (ez > 0) { z += sz; ez -= 2 * dy; }
      ex += 2 * dx;
      ez += 2 * dz;
      y += sy;
    }
  } else {
    let ex = 2 * dx - dz;
    let ey = 2 * dy - dz;
    for (let i = 0; i <= dz; i++) {
      out.add(x, y, z);
      if (ex > 0) { x += sx; ex -= 2 * dz; }
      if (ey > 0) { y += sy; ey -= 2 * dz; }
      ex += 2 * dx;
      ey += 2 * dy;
      z += sz;
    }
  }
  return out.toArray();
}

export function helix(
  centre: Position,
  radius: number,
  height: number,
  turns: number,
  axis: Axis = 'y',
  clockwise = true
): Position[] {
  const c = toBlockPosition(centre);
  const r = requireRadius('radius', radius);
  const h = requireLength('height', height);
  requireFiniteNumber('turns', turns);
  if (turns === 0) {
    throw new InvalidArgumentError('turns', turns, 'must not be zero; use a line for a straight run');
  }
  const map = axisMapper(axis, c);

  // The curve travels hypot(arc, rise) blocks over the whole of t, so that many samples keep
  // each step to at most one block and consecutive blocks touch.
  //
  // Rounded rather than ceilinged, this is off by a fraction and that fraction is enough:
  // 25 samples over a length of 25.2 steps 1.008 blocks at a time, and since each axis is
  // rounded on its own, a step just over one block can land two blocks away - 0.4999 rounds
  // to 0 while 1.5001 rounds to 2. A radius-4 single-turn helix came out in two pieces.
  const arc = 2 * Math.PI * r * Math.abs(turns);
  const steps = Math.max(1, Math.ceil(Math.hypot(arc, h)));
  const direction = clockwise ? 1 : -1;

  const out = new PositionCollector();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = turns * 2 * Math.PI * t * direction;
    const [x, y, z] = map(
      Math.round(h * t),
      Math.round(r * Math.cos(angle)),
      Math.round(r * Math.sin(angle))
    );
    out.add(x, y, z);
  }
  return out.toArray();
}

/** Bézier curve of any degree, through de Casteljau-equivalent Bernstein weights. */
export function bezier(
  start: Position,
  end: Position,
  controlPoints: readonly Position[] = [],
  segments?: number
): Position[] {
  const points = [toBlockPosition(start), ...controlPoints.map(toBlockPosition), toBlockPosition(end)];
  const degree = points.length - 1;

  // A Bézier is not traversed at a constant rate: with two control points in the same place
  // the curve crawls at one end and races at the other. Sampling once per block of the
  // control polygon's *length* therefore leaves gaps wherever the curve is moving fastest -
  // which it does, at up to `degree * longestSegment` blocks per unit of t.
  //
  // That bound is exactly what makes the step count safe: |B'(t)| <= n * max|P(i+1) - P(i)|,
  // so taking that many samples keeps every step to at most one block. Repeats are dropped
  // by the collector, so oversampling the slow stretches costs nothing but time.
  let longestSegment = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    longestSegment = Math.max(longestSegment, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  // `segments` raises the sample count; it cannot lower it below the bound. Asking for one
  // segment across a forty-block span used to return the two endpoints and nothing between
  // them — a "curve" in two pieces, from a knob the caller was invited to turn.
  const required = Math.max(1, Math.ceil(degree * longestSegment));
  const steps = segments === undefined
    ? required
    : Math.max(required, requireCount('segments', segments));

  const weights: number[] = [];
  for (let i = 0; i <= degree; i++) weights.push(binomial(degree, i));

  const out = new PositionCollector();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i <= degree; i++) {
      const w = weights[i]! * (1 - t) ** (degree - i) * t ** i;
      const p = points[i]!;
      x += w * p.x;
      y += w * p.y;
      z += w * p.z;
    }
    out.add(Math.round(x), Math.round(y), Math.round(z));
  }
  return out.toArray();
}

/** One vertex of a prism's cross-section, in the plane perpendicular to the extrusion axis. */
export interface CrossSectionVertex {
  readonly u: number;
  readonly v: number;
}

/**
 * Walks the edges of a polygon a block at a time.
 *
 * The outline is rasterised separately from the interior, and always kept, because a
 * point-in-polygon test is ambiguous exactly on the boundary - a vertex or a horizontal edge
 * can fall either side of the crossing rule depending on which way the comparison is
 * written. Tracing the edges first means the wall of a hollow prism cannot spring a leak at
 * the one place a leak would be hardest to see.
 */
function traceEdge(
  a: CrossSectionVertex,
  b: CrossSectionVertex,
  visit: (u: number, v: number) => void
): void {
  let u = a.u;
  let v = a.v;
  const du = Math.abs(b.u - a.u);
  const dv = Math.abs(b.v - a.v);
  const stepU = a.u < b.u ? 1 : -1;
  const stepV = a.v < b.v ? 1 : -1;
  let error = du - dv;

  for (;;) {
    visit(u, v);
    if (u === b.u && v === b.v) return;
    const doubled = 2 * error;
    if (doubled > -dv) {
      error -= dv;
      u += stepU;
    }
    if (doubled < du) {
      error += du;
      v += stepV;
    }
  }
}

/**
 * Even-odd crossing test, used for the interior only.
 *
 * Self-intersecting outlines are not rejected: the rule simply treats a doubly-wound region
 * as outside, which is a definite answer rather than an error. Rejecting them would mean
 * detecting the intersections, and a caller that wants a star polygon is not making a
 * mistake.
 */
function isInsidePolygon(u: number, v: number, polygon: readonly CrossSectionVertex[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.v > v !== b.v > v) {
      const crossing = a.u + ((v - a.v) / (b.v - a.v)) * (b.u - a.u);
      if (u < crossing) inside = !inside;
    }
  }
  return inside;
}

/**
 * A polygon pushed along an axis.
 *
 * This is the shape the other eight do not cover. `build.cube` gives a box, `build.cylinder`
 * and `build.cone` give round things, and between them sits everything a building is made
 * of: a gable roof is a triangle extruded sideways, a hexagonal tower is a hexagon extruded
 * upwards, an L-shaped floor plan is an L. D-14 recorded that "house", "tower" and "bridge"
 * are not mathematical shapes and need decomposing; this is the first shape that decomposes
 * them without going down to one character per block.
 *
 * `crossSection` is relative to `base`, in the plane across the extrusion axis. For the
 * default 'y' axis, `u` runs east and `v` runs south, matching the layer grid.
 *
 * Hollow follows the same rule as the cylinder: walls only, with both end caps solid, so it
 * is a room rather than a tube.
 */
export function prism(
  base: Position,
  crossSection: readonly CrossSectionVertex[],
  height: number,
  axis: Axis = 'y',
  hollow = false
): Position[] {
  const b = toBlockPosition(base);
  const h = requireLength('height', height);

  if (crossSection.length < 3) {
    throw new InvalidArgumentError(
      'crossSection',
      crossSection.length,
      'needs at least 3 vertices to enclose anything'
    );
  }

  const polygon = crossSection.map((vertex, index) => ({
    u: Math.round(requireFiniteNumber(`crossSection[${index}].u`, vertex.u)),
    v: Math.round(requireFiniteNumber(`crossSection[${index}].v`, vertex.v)),
  }));

  // The outline is the same on every layer, so it is traced once and reused. Interior cells
  // likewise: extruding means every layer has identical cross-section.
  const outline = new Set<string>();
  for (let i = 0; i < polygon.length; i++) {
    traceEdge(polygon[i]!, polygon[(i + 1) % polygon.length]!, (u, v) => {
      outline.add(`${u},${v}`);
    });
  }

  const uMin = Math.min(...polygon.map((p) => p.u));
  const uMax = Math.max(...polygon.map((p) => p.u));
  const vMin = Math.min(...polygon.map((p) => p.v));
  const vMax = Math.max(...polygon.map((p) => p.v));

  const interior: CrossSectionVertex[] = [];
  for (let u = uMin; u <= uMax; u++) {
    for (let v = vMin; v <= vMax; v++) {
      if (outline.has(`${u},${v}`)) continue;
      if (isInsidePolygon(u, v, polygon)) interior.push({ u, v });
    }
  }

  const wall = [...outline].map((key) => {
    const [u, v] = key.split(',');
    return { u: Number(u), v: Number(v) };
  });

  const map = axisMapper(axis, b);
  const out = new PositionCollector();

  for (let along = 0; along < h; along++) {
    const solidLayer = !hollow || along === 0 || along === h - 1;
    for (const cell of wall) {
      const [x, y, z] = map(along, cell.u, cell.v);
      out.add(x, y, z);
    }
    if (!solidLayer) continue;
    for (const cell of interior) {
      const [x, y, z] = map(along, cell.u, cell.v);
      out.add(x, y, z);
    }
  }
  return out.toArray();
}
