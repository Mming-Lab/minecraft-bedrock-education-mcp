/**
 * Measuring a build, without grading it.
 *
 * The Education Edition's arithmetic sits right on top of what a region read now returns.
 * Symmetry is a Year 6 topic in Japan - 線対称 and 点対称 by name - and moving a figure by
 * reflection or rotation is Year 7. A build either matches itself across an axis or it does
 * not, and until the world could be read, nothing here could tell.
 *
 * ## What these functions refuse to do
 *
 * They do not return a verdict. Not "symmetric", not a score, not a pass. They return how many
 * pairs were compared, how many matched, and where the ones that did not are.
 *
 * That is not squeamishness. A number out of ten collapses two different things into one: a
 * child who mirrored a castle badly, and a child who built an asymmetric castle on purpose.
 * Only one of those needs correcting, and the difference is not in the blocks - it is in what
 * the child meant, which a teacher can ask about and a tool cannot. Handing back a mark also
 * ends the conversation it should have started.
 *
 * ## Unread is not mismatched
 *
 * If either half of a pair was never read - the chunk was not loaded - the pair is counted
 * apart from both matches and mismatches. Folding it into mismatches would let a slow chunk
 * load tell a child their careful work is lopsided.
 *
 * ## What is compared
 *
 * Block ids. Not states, because the region read does not carry them (see `tools/world.ts`),
 * and because a reflected staircase legitimately faces the other way - counting that as a
 * mismatch would mark every correctly mirrored roof as wrong.
 */

import { UNKNOWN_SYMBOL, type LayeredRegion } from './layers.js';

export interface MismatchedPair {
  readonly a: { readonly x: number; readonly y: number; readonly z: number };
  readonly aBlock: string;
  readonly b: { readonly x: number; readonly y: number; readonly z: number };
  readonly bBlock: string;
}

export interface SymmetryResult {
  /** False when the shape of the region rules this kind of symmetry out entirely. */
  readonly applicable: boolean;
  readonly comparedPairs: number;
  readonly matchingPairs: number;
  readonly mismatchCount: number;
  /** Null when nothing could be compared, rather than a misleading 1 or 0. */
  readonly matchRatio: number | null;
  /** Pairs where one side was never read. Neither a match nor a mismatch. */
  readonly indeterminatePairs: number;
  /** Up to the caller's limit. `mismatchCount` is the true total. */
  readonly mismatches: readonly MismatchedPair[];
}

/** The four kinds worth asking about, named as the curriculum names them. */
export type SymmetryKind = 'mirror_x' | 'mirror_z' | 'rotate_180' | 'rotate_90';

/** Reads one cell of the grid as a block name, or null where nobody looked. */
function blockAt(region: LayeredRegion, x: number, y: number, z: number): string | null {
  const layer = region.layers[y];
  const row = layer?.rows[z];
  const symbol = row?.[x];
  if (symbol === undefined || symbol === UNKNOWN_SYMBOL) return null;
  return region.palette[symbol] ?? null;
}

/**
 * Where a cell lands under one kind of symmetry.
 *
 * Reflections are about a plane through the region rather than about a block, so the arithmetic
 * is `size - 1 - i`: with a width of 5, column 0 pairs with column 4 and column 2 pairs with
 * itself. A cell that maps to itself is skipped by the caller - comparing it to itself would
 * count a guaranteed match and inflate every ratio.
 */
function reflect(kind: SymmetryKind, size: { x: number; z: number }, x: number, z: number): { x: number; z: number } {
  const mx = size.x - 1 - x;
  const mz = size.z - 1 - z;
  switch (kind) {
    case 'mirror_x':
      return { x: mx, z };
    case 'mirror_z':
      return { x, z: mz };
    case 'rotate_180':
      return { x: mx, z: mz };
    case 'rotate_90':
      // A quarter turn about the vertical axis. Only meaningful on a square footprint, which
      // the caller checks before asking.
      return { x: size.z - 1 - z, z: x };
  }
}

export interface SymmetryOptions {
  readonly maxMismatches?: number;
}

/**
 * Compares a region against itself under one kind of symmetry.
 *
 * Every cell is visited and paired with where it maps to. Each unordered pair is therefore seen
 * twice under a reflection, so only one direction is counted - otherwise the totals double and
 * every mismatch is reported as two. A quarter turn is different: it has no pairs, it has
 * orbits of four, so there every cell is compared against its image and the count is the number
 * of cells rather than half of it.
 */
export function measureSymmetry(
  region: LayeredRegion,
  kind: SymmetryKind,
  options: SymmetryOptions = {}
): SymmetryResult {
  const { size, origin } = region;
  const limit = options.maxMismatches ?? 50;

  if (kind === 'rotate_90' && size.x !== size.z) {
    // Not a failure of the build. A quarter turn maps the footprint onto a footprint of
    // swapped dimensions, so on anything but a square there is nothing to compare it with.
    return {
      applicable: false,
      comparedPairs: 0,
      matchingPairs: 0,
      mismatchCount: 0,
      matchRatio: null,
      indeterminatePairs: 0,
      mismatches: [],
    };
  }

  let compared = 0;
  let matching = 0;
  let indeterminate = 0;
  const mismatches: MismatchedPair[] = [];

  for (let y = 0; y < size.y; y++) {
    for (let z = 0; z < size.z; z++) {
      for (let x = 0; x < size.x; x++) {
        const to = reflect(kind, size, x, z);

        if (kind === 'rotate_90') {
          // Orbits, not pairs: a cell and its image are different cells and every one is
          // counted once.
          if (to.x === x && to.z === z) continue;
        } else {
          // Each pair once. `<` rather than `<=` also drops the cells that map to themselves,
          // which are guaranteed matches and would flatter the ratio.
          const before = to.z < z || (to.z === z && to.x < x);
          if (before || (to.x === x && to.z === z)) continue;
        }

        const here = blockAt(region, x, y, z);
        const there = blockAt(region, to.x, y, to.z);

        if (here === null || there === null) {
          indeterminate++;
          continue;
        }

        compared++;
        if (here === there) {
          matching++;
        } else if (mismatches.length < limit) {
          mismatches.push({
            a: { x: origin.x + x, y: origin.y + y, z: origin.z + z },
            aBlock: here,
            b: { x: origin.x + to.x, y: origin.y + y, z: origin.z + to.z },
            bBlock: there,
          });
        }
      }
    }
  }

  return {
    applicable: true,
    comparedPairs: compared,
    matchingPairs: matching,
    mismatchCount: compared - matching,
    matchRatio: compared === 0 ? null : matching / compared,
    indeterminatePairs: indeterminate,
    mismatches,
  };
}

export interface CompositionResult {
  readonly footprintArea: number;
  readonly boundingVolume: number;
  readonly filledCount: number;
  readonly airCount: number;
  readonly airRatio: number | null;
  readonly unknown: number;
  /** False when part of the region was never read, so the counts are of less than the whole. */
  readonly complete: boolean;
  readonly blockCounts: readonly { readonly block: string; readonly count: number }[];
  readonly distinctBlockTypes: number;
}

/**
 * Counts what a region is made of.
 *
 * For the volume topic - base area times height - and for the plainer question of whether a
 * build used the materials the lesson asked for. Hollow and solid are not reported as such:
 * what comes back is the proportion that is air, and whether that makes something "hollow" is
 * a judgement about intent.
 */
export function measureComposition(region: LayeredRegion): CompositionResult {
  const { size } = region;
  const counts = new Map<string, number>();
  let air = 0;
  let filled = 0;

  for (let y = 0; y < size.y; y++) {
    for (let z = 0; z < size.z; z++) {
      for (let x = 0; x < size.x; x++) {
        const block = blockAt(region, x, y, z);
        if (block === null) continue;
        if (block === 'air') {
          air++;
          continue;
        }
        filled++;
        counts.set(block, (counts.get(block) ?? 0) + 1);
      }
    }
  }

  const blockCounts = [...counts.entries()]
    .map(([block, count]) => ({ block, count }))
    .sort((a, b) => b.count - a.count || (a.block < b.block ? -1 : 1));

  return {
    footprintArea: size.x * size.z,
    boundingVolume: size.x * size.y * size.z,
    filledCount: filled,
    airCount: air,
    airRatio: filled + air === 0 ? null : air / (filled + air),
    unknown: region.unknown,
    complete: region.unknown === 0,
    blockCounts,
    distinctBlockTypes: blockCounts.length,
  };
}
