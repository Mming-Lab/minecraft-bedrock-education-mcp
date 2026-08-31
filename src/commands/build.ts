/**
 * The command strings themselves. Pure functions: no socket, no world, no clock.
 *
 * Every block a tool places leaves through here, so this is the last place a malformed
 * command can be stopped, and the only place it can be tested without Minecraft running.
 * A string this module returns is asserted against a table; whether the game *accepts* that
 * string is a separate question that only a live session can answer, and the corpus written
 * by the test exists to be replayed at one (see tools/live-probe/).
 *
 * Grammar, from minecraft.wiki's Bedrock sections:
 *
 *   setblock <position: x y z> <tileName: Block> [blockStates] [destroy|keep|replace]
 *   fill <from: x y z> <to: x y z> <tileName: Block> [blockStates] [oldBlockHandling: FillMode]
 *   fill <from: x y z> <to: x y z> <tileName: Block> [blockStates] replace [tileName] [blockStates]
 *
 * Two details that the legacy server got wrong by not distinguishing the two commands:
 * /setblock takes three modes and /fill takes five, and `hollow` and `outline` are among the
 * two that /setblock does not take. The legacy `blocks` tool offered one shared enum of five
 * modes for both actions, so `set_block` with `mode: "hollow"` produced a command the game
 * could only reject.
 */

import { InvalidArgumentError } from '../geometry/core.js';
import { formatBlock, type BlockSpec } from './blocks.js';
import {
  assertOneFrame,
  boxVolume,
  formatTriple,
  toTriple,
  type CoordinateTriple,
  type Point,
} from './coordinates.js';

export const SET_BLOCK_MODES = ['replace', 'keep', 'destroy'] as const;
export type SetBlockMode = (typeof SET_BLOCK_MODES)[number];

/**
 * `strict` is deliberately absent: the wiki lists it as Java-only, added in 25w02a. Offering
 * it would mean generating a command Bedrock cannot parse.
 */
export const FILL_MODES = ['replace', 'keep', 'destroy', 'hollow', 'outline'] as const;
export type FillMode = (typeof FILL_MODES)[number];

/**
 * The volume /fill refuses to exceed.
 *
 * Measured, not assumed. This was the one constant here without a citation - the wiki gives
 * 32768 for Java and says nothing for Bedrock - so it went to a live session, and Education
 * Edition 1.26.3200 answered with the number itself:
 *
 *     fill ~ ~ ~ ~31 ~31 ~31 minecraft:stone replace
 *       -> 32768 個のブロックで満たしました              (accepted, exactly the limit)
 *     fill ~ ~ ~ ~31 ~31 ~32 minecraft:stone replace
 *       -> 指定した領域にあるブロックが多すぎます (33792 > 32768)
 */
export const FILL_VOLUME_LIMIT = 32768;

function requireMode<T extends string>(
  mode: string,
  allowed: readonly T[],
  command: string
): T {
  if (!(allowed as readonly string[]).includes(mode)) {
    throw new InvalidArgumentError(
      'mode',
      mode,
      `/${command} takes ${allowed.join(', ')}`
    );
  }
  return mode as T;
}

/** `setblock 0 64 0 minecraft:stone ["facing"="north"] keep` */
export function buildSetBlockCommand(
  at: Point,
  block: BlockSpec | string,
  mode: SetBlockMode = 'replace'
): string {
  const position = toTriple(at, 'position');
  assertOneFrame([position], 'position');
  const checked = requireMode(mode, SET_BLOCK_MODES, 'setblock');
  return `setblock ${formatTriple(position)} ${formatBlock(block)} ${checked}`;
}

export interface FillOptions {
  readonly mode?: FillMode;
  /**
   * Fill only over blocks matching this one.
   *
   * Only the `replace` mode has a filter form, so passing a filter with any other mode is an
   * error rather than a silently dropped argument.
   */
  readonly replaceOnly?: BlockSpec | string;
}

/** `fill 0 64 0 4 64 4 minecraft:stone replace minecraft:dirt` */
export function buildFillCommand(
  from: Point,
  to: Point,
  block: BlockSpec | string,
  options: FillOptions = {}
): string {
  const a = toTriple(from, 'from');
  const b = toTriple(to, 'to');
  assertOneFrame([a, b], 'from/to');

  const mode = requireMode(options.mode ?? 'replace', FILL_MODES, 'fill');
  if (options.replaceOnly !== undefined && mode !== 'replace') {
    throw new InvalidArgumentError(
      'mode',
      mode,
      'a replace filter only exists for `replace`; drop the filter or use `replace`'
    );
  }

  const volume = boxVolume(a, b);
  if (volume !== null && volume > FILL_VOLUME_LIMIT) {
    throw new InvalidArgumentError(
      'from/to',
      { from: formatTriple(a), to: formatTriple(b) },
      `${volume} blocks exceeds the ${FILL_VOLUME_LIMIT}-block limit of /fill; split the region`
    );
  }

  const head = `fill ${formatTriple(a)} ${formatTriple(b)} ${formatBlock(block)} ${mode}`;
  return options.replaceOnly === undefined
    ? head
    : `${head} ${formatBlock(options.replaceOnly, 'replaceOnly')}`;
}

/**
 * The box a fill would cover, or `null` when the frames make that unknowable.
 *
 * Exported because a caller planning a large build needs the same number the builder checks
 * against, and re-deriving it at the call site is how the two drift apart.
 */
export function fillVolume(from: Point, to: Point): number | null {
  return boxVolume(toTriple(from, 'from'), toTriple(to, 'to'));
}

export type { CoordinateTriple, Point };
