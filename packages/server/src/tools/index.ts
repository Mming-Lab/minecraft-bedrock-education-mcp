export * from './types.js';
export * from './build.js';
export * from './world.js';
export * from './layers.js';
export * from './players.js';

import { buildTools } from './build.js';
import { offlineBridge, worldTools, type WorldBridge } from './world.js';
import { layerTools } from './layers.js';
import { playerTools } from './players.js';
import { BuildOutcome, type AnyToolDefinition, type PlannedBuild } from './types.js';
import { placeBlocks } from '../execute/placer.js';
import type { CommandRunner } from '../bridge/index.js';

/**
 * Wraps a shape tool so that it builds the thing rather than describing it.
 *
 * The tools in `build.ts` are pure: they work out which positions a shape covers and stop.
 * That was the whole story until now, which meant `build.sphere` returned a confident report
 * of a sphere that was never placed. This is the half that was missing.
 *
 * Keeping it here rather than inside each tool is not only tidiness. The shape functions stay
 * testable without a game - which is where the geometry bugs were found - and there is exactly
 * one place that knows a build reaches the world, so a tool cannot be added that quietly
 * forgets to.
 */
function building(tool: AnyToolDefinition, runner: CommandRunner): AnyToolDefinition {
  return {
    ...tool,
    outputSchema: BuildOutcome.shape,
    handler: async (args: never) => {
      const plan = tool.handler(args) as PlannedBuild;
      const report = await placeBlocks(runner, plan.positions, plan.block);
      // `positions` is deliberately dropped: two thousand coordinates is not an answer to
      // "build me a sphere", and the model has world.read_region when it wants the blocks.
      const { positions: _positions, ...summary } = plan;
      return {
        ...summary,
        commandCount: report.commandCount,
        unsent: report.unsent,
        negative: report.negative,
      };
    },
  };
}

/**
 * A runner with nothing on the other end.
 *
 * Same reasoning as {@link offlineBridge}: the tool list must not depend on whether a game is
 * connected, so an unbound server registers the same tools and fails the call with something
 * a person can act on.
 */
export const offlineRunner: CommandRunner = {
  async run() {
    throw new Error(
      'Minecraft is not connected. In the game, open the chat and run /connect localhost:19131.'
    );
  },
};

/**
 * Every tool the server exposes, bound to a connection.
 *
 * Kept in a stable order because the spec asks for it: a deterministic `tools/list` lets
 * clients cache the list and improves prompt-cache hit rates on the model side. Building
 * comes before reading because that is the order a lesson goes in, and the two groups are
 * never interleaved.
 */
export function toolsFor(bridge: WorldBridge, runner: CommandRunner = offlineRunner): readonly AnyToolDefinition[] {
  return [
    ...buildTools.map((tool) => building(tool as AnyToolDefinition, runner)),
    ...layerTools(runner),
    // Where the players are comes before what is around them: it is the only reading tool that
    // needs no coordinates, and every other one needs coordinates.
    ...playerTools(runner),
    ...worldTools(bridge),
  ];
}

/**
 * The same surface with nothing connected.
 *
 * The list of tools does not depend on the connection - only what happens when one is called
 * does - so this is what any inspection of the surface should look at.
 */
export const allTools: readonly AnyToolDefinition[] = toolsFor(offlineBridge, offlineRunner);
