/**
 * Keeping the positions a shape worked out, instead of throwing them away.
 *
 * `building()` used to compute a shape's positions, hand them to the placer, and drop them:
 *
 *     // `positions` is deliberately dropped: two thousand coordinates is not an answer to
 *     // "build me a sphere"
 *
 * Not returning them is right - two thousand coordinates would fill the model's context and
 * tell it nothing. Discarding them is a different decision, and it was the one that left the
 * server unable to answer any question about what it had just built. It knows exactly which
 * blocks a sphere covers; it computed them.
 *
 * So the positions are kept here under a short id, and the id is what goes back. Drawing a
 * picture, and later comparing a plan against the world, both need this and neither needs the
 * coordinates to travel.
 *
 * ## Why it is bounded, and bounded twice
 *
 * A radius-32 sphere is 137,065 positions. Keeping every plan a lesson produces would grow
 * without limit inside a process that is expected to run all day. Two limits rather than one,
 * because either alone fails: a count alone lets a handful of enormous plans sit in memory,
 * and a position budget alone lets thousands of tiny ones accumulate their own overhead.
 *
 * Eviction is oldest-first. A model that wants to look at a plan does so in the turn it made
 * it, and a plan that has aged out says so rather than being silently redrawn from nothing.
 */

import type { BlockSpec } from '../commands/index.js';
import type { Position } from '../geometry/index.js';

/**
 * How many plans are kept at once.
 *
 * Sixteen was the first number here and it was too low, for a reason that only shows up in
 * use: `building()` stores a plan on *every* build, not only on a dry run. A tree built from
 * forty-nine curves therefore evicts its own first thirty-three plans while it is still being
 * built, and a model that then asked to draw the trunk would be told the plan had aged out -
 * with nothing in the schema to warn it. The failure appears at N=17 and not at N=16, which is
 * the worst shape a limit can have: the same call succeeds or fails depending on how much
 * happened before it.
 *
 * The position budget below is the limit that actually protects memory. This one only stops
 * thousands of tiny plans accumulating their own overhead, and it can be generous.
 */
export const MAX_PLANS = 256;

/**
 * Total positions held across all plans.
 *
 * Sized so the largest single shape the tools can produce still fits: a radius-64 sphere is
 * about 1.1 million positions, and one of those plus room for several ordinary plans is the
 * shape of the budget. At roughly 32 bytes a position this is tens of megabytes, which is the
 * cost of being able to check work rather than guess at it.
 */
export const MAX_STORED_POSITIONS = 2_000_000;

export interface StoredPlan {
  readonly planId: string;
  readonly positions: readonly Position[];
  /** What made it, for the caller's benefit when a picture comes back and needs a caption. */
  readonly shape: string;
  /**
   * The block *and its states*, not just the id.
   *
   * Storing a bare string was the first shape of this and it was wrong. D-15 decided that the
   * write side keeps states while the read side drops them, and a plan is on the write side:
   * a staircase built with a facing, kept as a plan, and placed again through build.rotate
   * would have come back down facing the default. The states were computed, sent to the game
   * once, and then thrown away at the point where they would be needed again.
   */
  readonly block: BlockSpec;
}

interface Entry extends StoredPlan {
  readonly sequence: number;
}

const plans = new Map<string, Entry>();
let nextSequence = 0;
let heldPositions = 0;

/** Ids are short because they travel in every build result and are typed back by a model. */
function mintId(): string {
  const id = `p${nextSequence.toString(36)}`;
  return id;
}

function evictOldest(): void {
  let oldest: Entry | undefined;
  for (const entry of plans.values()) {
    if (!oldest || entry.sequence < oldest.sequence) oldest = entry;
  }
  if (!oldest) return;
  plans.delete(oldest.planId);
  heldPositions -= oldest.positions.length;
}

export function storePlan(positions: readonly Position[], shape: string, block: BlockSpec): string {
  const planId = mintId();
  nextSequence++;

  plans.set(planId, { planId, positions, shape, block, sequence: nextSequence });
  heldPositions += positions.length;

  while (plans.size > MAX_PLANS || (heldPositions > MAX_STORED_POSITIONS && plans.size > 1)) {
    evictOldest();
  }
  return planId;
}

/** Returns undefined for an id that never existed and for one that has aged out. The caller
 * cannot tell those apart, and does not need to: both mean "build it again to look at it". */
export function getPlan(planId: string): StoredPlan | undefined {
  return plans.get(planId);
}

export function planCount(): number {
  return plans.size;
}

export function storedPositionCount(): number {
  return heldPositions;
}

/** Only for tests: the store is process-wide state and a suite that leaves plans behind would
 * change what the next one measures. */
export function resetPlans(): void {
  plans.clear();
  heldPositions = 0;
  nextSequence = 0;
}
