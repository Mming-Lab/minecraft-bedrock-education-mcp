/**
 * Packing a set of blocks into boxes, so a build goes out as a handful of /fill commands
 * instead of one /setblock per block.
 *
 * This matters more than it sounds. A hollow sphere of radius 5 is 264 blocks; packed, it is
 * 83 fills. A solid one is 515 blocks and 43 fills. With a hundred-command ceiling on
 * outstanding requests, that is the difference between a build that goes out in one round
 * trip and one that has to be metered.
 *
 * ## The greedy walk is the legacy algorithm; the grid it walks is not
 *
 * The legacy `optimizeBlocks` expanded over *compressed* coordinates - the sorted set of
 * distinct x values, then y, then z - and treated adjacency in that list as adjacency in the
 * world. When every coordinate between two blocks appears somewhere else in the shape, the
 * compressed grid and the real one are the same thing, which is why it looked correct: on
 * the shapes it was used for, the projection onto each axis has no holes.
 *
 * Give it a set whose projection does have a hole and it fills blocks nobody asked for:
 *
 *     optimizeBlocks([{x:0,y:0,z:0}, {x:5,y:0,z:0}])
 *       -> one box from (0,0,0) to (5,0,0)      // four blocks that were not in the input
 *
 * Nothing in the shape library produces that, which is why 78 measured cases showed zero
 * over-coverage. A selection made of two separate regions produces it immediately, and that
 * is exactly what a region edit is. So the walk below is the legacy one, step for step and
 * in the same visiting order, over real coordinates.
 */

import type { Position } from '../geometry/core.js';
import { InvalidArgumentError } from '../geometry/core.js';
import { FILL_VOLUME_LIMIT } from './build.js';

export interface Box {
  readonly from: Position;
  readonly to: Position;
}

export interface OptimizationResult {
  readonly boxes: readonly Box[];
  /** Distinct blocks in the input. Duplicates are counted once, since a fill places once. */
  readonly blockCount: number;
  /** What the caller wants to know: how many commands this became. */
  readonly fillCount: number;
}

export interface OptimizeOptions {
  /**
   * The largest box to emit, in blocks. Anything bigger is split.
   *
   * Defaulted to the /fill limit because a box over it is not a valid command - packing that
   * produced one would just move the failure to the socket.
   */
  readonly maxVolume?: number;
}

export function volumeOf(box: Box): number {
  return (
    (box.to.x - box.from.x + 1) * (box.to.y - box.from.y + 1) * (box.to.z - box.from.z + 1)
  );
}

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Halves along the longest axis until every piece fits. */
function splitToVolume(box: Box, maxVolume: number, out: Box[]): void {
  if (volumeOf(box) <= maxVolume) {
    out.push(box);
    return;
  }

  const spans: readonly ['x' | 'y' | 'z', number][] = [
    ['x', box.to.x - box.from.x],
    ['y', box.to.y - box.from.y],
    ['z', box.to.z - box.from.z],
  ];
  const [axis] = spans.reduce((a, b) => (b[1] > a[1] ? b : a));

  const lo = box.from[axis];
  const hi = box.to[axis];
  if (hi === lo) {
    // A single-block-thick slab still over the limit. Cannot be split further on this axis,
    // and the reduce above already picked the longest, so nothing can.
    out.push(box);
    return;
  }
  const mid = lo + Math.floor((hi - lo) / 2);

  splitToVolume({ from: box.from, to: { ...box.to, [axis]: mid } }, maxVolume, out);
  splitToVolume({ from: { ...box.from, [axis]: mid + 1 }, to: box.to }, maxVolume, out);
}

/**
 * Packs blocks into boxes whose union is exactly the input set.
 *
 * "Exactly" is the whole contract: never a block short, and never a block extra. A better
 * packing may use fewer boxes than this one and still be correct - so the tests assert the
 * union, and only compare box counts as a regression signal.
 */
export function optimizeToBoxes(
  positions: readonly Position[],
  options: OptimizeOptions = {}
): OptimizationResult {
  const maxVolume = options.maxVolume ?? FILL_VOLUME_LIMIT;
  if (!Number.isInteger(maxVolume) || maxVolume < 1) {
    throw new InvalidArgumentError('maxVolume', maxVolume, 'expected a positive whole number');
  }

  const remaining = new Set<string>();
  const ordered: Position[] = [];
  for (const p of positions) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.z)) {
      throw new InvalidArgumentError('positions', p, 'a block position is three whole numbers');
    }
    const k = key(p.x, p.y, p.z);
    if (remaining.has(k)) continue;
    remaining.add(k);
    ordered.push(p);
  }

  const blockCount = ordered.length;
  if (blockCount === 0) return { boxes: [], blockCount: 0, fillCount: 0 };

  // x-major, then y, then z - the order the legacy triple loop visited its grid in, kept so
  // that the packing of a dense shape is unchanged.
  ordered.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);

  const boxes: Box[] = [];

  for (const start of ordered) {
    if (!remaining.has(key(start.x, start.y, start.z))) continue;

    let maxX = start.x;
    let maxY = start.y;
    let maxZ = start.z;

    // A run along X, one block thick.
    while (remaining.has(key(maxX + 1, start.y, start.z))) maxX++;

    // Then widen that run in Y, a whole slice at a time.
    outer: for (;;) {
      const y = maxY + 1;
      for (let x = start.x; x <= maxX; x++) {
        for (let z = start.z; z <= maxZ; z++) {
          if (!remaining.has(key(x, y, z))) break outer;
        }
      }
      maxY = y;
    }

    // Then deepen the slab in Z.
    outer: for (;;) {
      const z = maxZ + 1;
      for (let x = start.x; x <= maxX; x++) {
        for (let y = start.y; y <= maxY; y++) {
          if (!remaining.has(key(x, y, z))) break outer;
        }
      }
      maxZ = z;
    }

    for (let x = start.x; x <= maxX; x++) {
      for (let y = start.y; y <= maxY; y++) {
        for (let z = start.z; z <= maxZ; z++) {
          remaining.delete(key(x, y, z));
        }
      }
    }

    splitToVolume(
      { from: { x: start.x, y: start.y, z: start.z }, to: { x: maxX, y: maxY, z: maxZ } },
      maxVolume,
      boxes
    );
  }

  return { boxes, blockCount, fillCount: boxes.length };
}
