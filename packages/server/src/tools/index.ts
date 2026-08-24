export * from './types.js';
export * from './build.js';
export * from './world.js';

import { buildTools } from './build.js';
import { offlineBridge, worldTools, type WorldBridge } from './world.js';
import type { AnyToolDefinition } from './types.js';

/**
 * Every tool the server exposes, bound to a bridge.
 *
 * Kept in a stable order because the spec asks for it: a deterministic `tools/list` lets
 * clients cache the list and improves prompt-cache hit rates on the model side. Building
 * comes before reading because that is the order a lesson goes in, and the two groups are
 * never interleaved.
 */
export function toolsFor(bridge: WorldBridge): readonly AnyToolDefinition[] {
  return [...buildTools, ...worldTools(bridge)];
}

/**
 * The same surface with nothing connected.
 *
 * The list of tools does not depend on the bridge - only what happens when one is called does
 * - so this is what any inspection of the surface should look at.
 */
export const allTools: readonly AnyToolDefinition[] = toolsFor(offlineBridge);
