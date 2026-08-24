/**
 * Turning computed positions into blocks that are actually in the world.
 *
 * Until now the building tools stopped one step short: they worked out which positions a
 * shape covers, summarised it, and returned. Nothing was ever placed. A model calling
 * `build.sphere` got a confident report of a sphere that did not exist.
 *
 * This is that step. Positions go through the box packer, each box becomes one `/fill`, and
 * the fills go out over the socket.
 *
 * ## What counts as a failure, and what does not
 *
 * Bedrock's `statusCode` is not a verdict. `0 blocks filled` is negative and means the fill
 * ran and matched nothing; `that block cannot be placed` is negative and means the block was
 * already there. Of seventeen commands in an earlier corpus, eight looked refused and exactly
 * one was a real syntax error. Treating a negative code as an error would report successful
 * builds as failures.
 *
 * Reading the message instead is worse, not better: the game answers in the client's language,
 * and this one is Japanese. `testforblock` was abandoned for exactly that reason.
 *
 * So nothing here judges. What is reported is what happened - how many commands went out, how
 * many the game answered negatively, and what it said - and the tool description points at
 * `world.read_region` for the question of whether the thing is actually there. That is now a
 * real answer rather than a deflection: reading the world is a tool the model has.
 *
 * ## Why the sending is capped
 *
 * A hundred `execute if block` commands in flight came back in 774ms with nothing lost, which
 * is the only measurement there is. 64 is under it, and unbounded is not an option: a
 * radius-32 sphere is thousands of positions, and a failure mode where the game silently drops
 * commands under load would be indistinguishable from a shape that built wrong.
 */

import type { CommandOutcome, CommandRunner } from '../bridge/index.js';
import { buildFillCommand, optimizeToBoxes, type BlockSpec, type Box } from '../commands/index.js';
import type { Position } from '../geometry/index.js';

/** How many commands may be in flight. Below the 100 that was measured to be safe. */
export const MAX_IN_FLIGHT = 64;

export type { CommandOutcome, CommandRunner };

export interface PlacementReport {
  /** Distinct positions the shape covers. */
  readonly blockCount: number;
  /** How many `/fill` commands it packed down to. */
  readonly commandCount: number;
  /** Commands that never reached the game at all. These are unambiguous failures. */
  readonly unsent: readonly { readonly commandLine: string; readonly reason: string }[];
  /**
   * Commands the game answered with a negative code.
   *
   * Reported, not judged: most of these are ordinary outcomes. A caller that wants to know
   * whether the blocks are there should read them.
   */
  readonly negative: readonly { readonly commandLine: string; readonly statusMessage: string }[];
}

/**
 * Runs commands with a cap on how many are in flight at once.
 *
 * Deliberately not `Promise.all` over the whole list. Order does not matter - the fills cover
 * disjoint boxes - but the count does.
 */
async function runAll(
  runner: CommandRunner,
  commands: readonly string[]
): Promise<(CommandOutcome | Error)[]> {
  const results: (CommandOutcome | Error)[] = new Array(commands.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= commands.length) return;
      const commandLine = commands[index]!;
      try {
        results[index] = await runner.run(commandLine);
      } catch (error) {
        // Kept rather than thrown: one command failing to send says nothing about the other
        // sixty, and a half-built shape the caller knows about beats an exception that leaves
        // them guessing how far it got.
        results[index] = error instanceof Error ? error : new Error(String(error));
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_IN_FLIGHT, commands.length) }, () => worker())
  );
  return results;
}

/** The `/fill` commands a shape becomes, without sending them. Exported for tests and dry runs. */
export function commandsFor(
  positions: readonly Position[],
  block: BlockSpec | string
): { commands: string[]; boxes: readonly Box[]; blockCount: number } {
  const { boxes, blockCount } = optimizeToBoxes(positions);
  const commands = boxes.map((box) => buildFillCommand(box.from, box.to, block));
  return { commands, boxes, blockCount };
}

/**
 * Places a shape, and reports what the game said about it.
 *
 * Throws only when nothing could be sent at all - which is what "Minecraft is not connected"
 * looks like, and is worth an error because there is a specific thing the person can do about
 * it. A build that partly landed comes back as a report instead, since the caller needs to
 * know which part.
 */
export async function placeBlocks(
  runner: CommandRunner,
  positions: readonly Position[],
  block: BlockSpec | string
): Promise<PlacementReport> {
  const { commands, blockCount } = commandsFor(positions, block);
  const results = await runAll(runner, commands);

  const unsent: { commandLine: string; reason: string }[] = [];
  const negative: { commandLine: string; statusMessage: string }[] = [];

  results.forEach((result, index) => {
    const commandLine = commands[index]!;
    if (result instanceof Error) {
      unsent.push({ commandLine, reason: result.message });
      return;
    }
    if (result.statusCode < 0) negative.push({ commandLine, statusMessage: result.statusMessage });
  });

  // Everything failed to send: that is not a partly-built shape, it is a missing connection,
  // and saying so once beats handing back a report of nothing having happened.
  if (unsent.length === commands.length && commands.length > 0) {
    throw new Error(unsent[0]!.reason);
  }

  return { blockCount, commandCount: commands.length, unsent, negative };
}
