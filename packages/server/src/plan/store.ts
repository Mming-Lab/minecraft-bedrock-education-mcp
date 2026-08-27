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

import type { Position } from '../geometry/index.js';

/** How many plans are kept at once. */
export const MAX_PLANS = 16;

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
  readonly block: string;
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

export function storePlan(positions: readonly Position[], shape: string, block: string): string {
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
