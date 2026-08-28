export * from './types.js';
export * from './build.js';
export * from './world.js';
export * from './layers.js';
export * from './players.js';
export * from './clone.js';
export * from './assess.js';
export * from './area.js';
export * from './plan.js';
export * from './rotate.js';

import { buildTools } from './build.js';
import { offlineBridge, worldTools, type WorldBridge } from './world.js';
import { layerTools } from './layers.js';
import { playerTools } from './players.js';
import { cloneTools } from './clone.js';
import { assessTools } from './assess.js';
import { areaTools } from './area.js';
import { planTools } from './plan.js';
import { rotateTools } from './rotate.js';
import {
  BlockStates,
  BuildOutcome,
  DryRunFlag,
  type AnyToolDefinition,
  type PlannedBuild,
} from './types.js';
import { storePlan } from '../plan/store.js';
import { placeGroups } from '../execute/placer.js';
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
    // Every shape gains the same optional states. Added here rather than in nine separate
    // definitions so that a tool cannot be written that quietly lacks it - the same reason
    // placing lives here rather than in each shape.
    inputSchema: { ...tool.inputSchema, states: BlockStates.optional(), dryRun: DryRunFlag.optional() },
    outputSchema: BuildOutcome.shape,
    handler: async (args: never) => {
      const plan = tool.handler(args) as PlannedBuild;
      // The states ride alongside the id rather than inside it. `normalizeBlockId` rejects an
      // id containing '[', so a caller who tried to splice them in would be refused - and a
      // tool that emitted that form would be teaching the shape its own validator forbids.
      const { states, dryRun } = args as unknown as {
        states?: Record<string, string | number | boolean>;
        dryRun?: boolean;
      };
      const block = states === undefined ? { id: plan.block } : { id: plan.block, states };

      // Kept, not returned. Two thousand coordinates is not an answer to "build me a sphere",
      // but the server is the only thing that knows them and dropping them is what left it
      // unable to answer any later question about the shape - including "draw it".
      //
      // The states go in with it. Storing the bare id was the first shape of this and it meant
      // a staircase kept as a plan and placed again came down facing the default - the states
      // were computed, sent once, and dropped at the point they would next be needed.
      const planId = storePlan(plan.positions, tool.name, block);
      const { positions: _positions, ...summary } = plan;

      if (dryRun === true) {
        // Nothing reaches the game. The point is plan.preview: a picture costs milliseconds
        // and a read of the same region costs minutes, so the cheap look has to come first or
        // it is not a loop a model can afford to run.
        return { ...summary, planId, commandCount: 0, unsent: [], negative: [], placed: false };
      }

      const report = await placeGroups(runner, [{ block, positions: plan.positions }]);
      return {
        ...summary,
        planId,
        commandCount: report.commandCount,
        unsent: report.unsent,
        negative: report.negative,
        placed: true,
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
    ...cloneTools(runner),
    // With the other build.* tools: it places blocks, and prefix grouping is what makes
    // tools/list cacheable.
    ...rotateTools(runner),
    // Where the players are comes before what is around them: it is the only reading tool that
    // needs no coordinates, and every other one needs coordinates.
    ...playerTools(runner),
    ...worldTools(bridge),
    // With the other world.* tools, not after the assess ones. Grouping by prefix is what
    // makes tools/list cacheable, and the surface test enforces it - I had put these last
    // because they change the world, which is a reason for the annotation, not for the order.
    ...areaTools(runner),
    // After the reading tools, because measuring is what you do with a region once you can
    // read one.
    ...assessTools(bridge),
    // Last, and grouped like the rest. Drawing a plan is the one thing here that never talks
    // to the game at all, so it sits at the end rather than interleaved with the tools that do.
    ...planTools(),
  ];
}

/**
 * The same surface with nothing connected.
 *
 * The list of tools does not depend on the connection - only what happens when one is called
 * does - so this is what any inspection of the surface should look at.
 */
export const allTools: readonly AnyToolDefinition[] = toolsFor(offlineBridge, offlineRunner);
