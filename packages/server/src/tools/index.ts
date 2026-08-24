export * from './types.js';
export * from './build.js';

import { buildTools } from './build.js';
import type { AnyToolDefinition } from './types.js';

/**
 * Every tool the server exposes.
 *
 * Kept in a stable order because the spec asks for it: a deterministic `tools/list` lets
 * clients cache the list and improves prompt-cache hit rates on the model side.
 */
export const allTools: readonly AnyToolDefinition[] = [...buildTools] as AnyToolDefinition[];
