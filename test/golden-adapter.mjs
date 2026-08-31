// Presents the new geometry under the legacy function names so tools/golden-extract can
// measure it.
//
// The rewrite deliberately does not keep the old names or the old argument orders - several
// of them were misleading, in particular the hyperboloid's `waist`, which was a ratio
// dressed up as a radius. Rather than compromise the new API to make the goldens run, the
// translation lives here, where each mapping is stated and can be read.
//
//   node ../../tools/golden-extract/validate.mjs \
//     --geometry ./test/golden-adapter.mjs \
//     --math     ./test/golden-adapter.mjs

import * as g from '../dist/geometry/index.js';
import { rotatePoint, rotatePositions } from '../dist/geometry/rotation.js';

export function calculateCubePositions(corner1, corner2, hollow = false) {
  return g.cuboid(corner1, corner2, hollow);
}

export function calculateSpherePositions(centre, radius, hollow = false) {
  return g.sphere(centre, radius, hollow);
}

export function calculateEllipsoidPositions(centre, radiusX, radiusY, radiusZ, hollow = false) {
  return g.ellipsoid(centre, radiusX, radiusY, radiusZ, hollow);
}

export function calculateCylinderPositions(centre, radius, height, axis = 'y', hollow = false) {
  return g.cylinder(centre, radius, height, axis, hollow);
}

/** The legacy signature carried an `offset` that shifted the disc along its axis. */
export function calculateCirclePositions(centre, radius, axis = 'y', offset = 0, hollow = false) {
  const shifted = offset === 0
    ? centre
    : axis === 'x' ? { ...centre, x: centre.x + offset }
    : axis === 'z' ? { ...centre, z: centre.z + offset }
    : { ...centre, y: centre.y + offset };
  return g.disc(shifted, radius, axis, hollow);
}

export function calculateLinePositions(start, end) {
  return g.line(start, end);
}

/** Legacy order is (start, height, radius, turns); the rewrite takes radius before height. */
export function calculateHelixPositions(start, height, radius, turns, axis = 'y') {
  return g.helix(start, radius, height, turns, axis);
}

export function calculateTorusPositions(centre, majorRadius, minorRadius, hollow = false) {
  return g.torus(centre, majorRadius, minorRadius, 'y', hollow);
}

/**
 * The legacy paraboloid opened upward or downward. The rewrite always builds upward from
 * the centre, so `down` is expressed by flipping the result about the centre's Y.
 */
export function calculateParaboloidPositions(centre, radius, height, direction = 'up', hollow = false) {
  const built = g.paraboloid(centre, radius, height, 'y', hollow);
  if (direction !== 'down') return built;
  return built.map((p) => ({ x: p.x, y: 2 * centre.y - p.y, z: p.z }));
}

/**
 * The legacy `waist` was a **ratio**: the profile was `radius * sqrt(waist² + t²)`, so the
 * waist radius was `radius * waist` and the ends reached `radius * sqrt(waist² + 1)` -
 * meaning `radius` was neither the waist nor the widest point. The rewrite takes both radii
 * as absolute block counts, so the ratio is converted here.
 */
export function calculateHyperboloidPositions(centre, radius, height, waist = 0.5, hollow = false) {
  const waistRadius = Math.round(radius * waist);
  const baseRadius = Math.round(radius * Math.sqrt(waist * waist + 1));
  return g.hyperboloid(centre, baseRadius, waistRadius, height, 'y', hollow);
}

export function calculateBezierPositions(startPoint, endPoint, controlPoints = [], segments) {
  return g.bezier(startPoint, endPoint, controlPoints, segments);
}

// --- math module surface -----------------------------------------------------------------
export function rotatePoint3D(point, origin, axis, degrees) {
  return rotatePoint(point, origin, axis, degrees);
}

export function rotatePointsArray(points, origin, axis, degrees) {
  return rotatePositions(points, origin, axis, degrees);
}
