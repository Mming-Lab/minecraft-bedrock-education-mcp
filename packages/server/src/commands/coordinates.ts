/**
 * Coordinates as they appear in a command, which is not the same thing as a position.
 *
 * A `Position` is three numbers. A coordinate in a command carries a *frame* as well: `5` is
 * a world coordinate, `~5` is five blocks from wherever the command runs, and `^5` is five
 * blocks in the direction the executor is facing. The three are not interchangeable, and the
 * game refuses to parse a triple that mixes local coordinates with the other two.
 *
 * The legacy server never modelled this. It interpolated numbers straight into a template
 * string, so relative placement was simply not expressible, and there was nothing that could
 * have rejected a malformed coordinate before it reached the socket.
 *
 * ## What is verified and what is not
 *
 * The argument grammar and the block-state syntax below are from minecraft.wiki's Bedrock
 * sections. Caret notation is the loose end: the /fill page lists it among the accepted
 * coordinate forms for Bedrock, while the Coordinates page describes it only under Java. So
 * `local()` exists and formats correctly, no tool emits it, and confirming that Bedrock's
 * /setblock and /fill accept it is a live-verification item. Everything the build tools
 * produce is absolute, which the wiki is unambiguous about.
 */

import { InvalidArgumentError, type Position } from '../geometry/core.js';

export type CoordinateFrame =
  /** A world coordinate: `5`, `-12`. */
  | 'absolute'
  /** An offset from the execution position: `~`, `~5`, `~-12`. */
  | 'relative'
  /** An offset along the executor's facing: `^`, `^5`. Cannot be mixed with the others. */
  | 'local';

export interface Coordinate {
  readonly frame: CoordinateFrame;
  readonly value: number;
}

export type CoordinateTriple = readonly [Coordinate, Coordinate, Coordinate];

/**
 * Anything a caller may hand to a command builder as a point.
 *
 * `Position` is accepted because that is what the geometry produces, and re-wrapping every
 * one of ten thousand positions at the call site would be noise.
 */
export type Point = Position | CoordinateTriple;

function make(frame: CoordinateFrame, value: number, parameter: string): Coordinate {
  if (!Number.isFinite(value)) {
    throw new InvalidArgumentError(parameter, value, 'a coordinate must be a finite number');
  }
  if (!Number.isInteger(value)) {
    // Block commands take a block, not a point in space. Bedrock truncates a fractional
    // coordinate rather than rejecting it, which silently places the block somewhere the
    // caller did not ask for - worse than an error.
    throw new InvalidArgumentError(
      parameter,
      value,
      'a block coordinate must be a whole number'
    );
  }
  // `-0` formats as `-0`, which is a valid but startling thing to send.
  return { frame, value: value === 0 ? 0 : value };
}

export const absolute = (value: number, parameter = 'coordinate'): Coordinate =>
  make('absolute', value, parameter);

export const relative = (value: number, parameter = 'coordinate'): Coordinate =>
  make('relative', value, parameter);

export const local = (value: number, parameter = 'coordinate'): Coordinate =>
  make('local', value, parameter);

const PREFIX: Record<CoordinateFrame, string> = {
  absolute: '',
  relative: '~',
  local: '^',
};

/** `5`, `-5`, `~`, `~-5`, `^`, `^5`. A zero offset is written bare, which is canonical. */
export function formatCoordinate(coordinate: Coordinate): string {
  const prefix = PREFIX[coordinate.frame];
  if (coordinate.frame !== 'absolute' && coordinate.value === 0) return prefix;
  return `${prefix}${coordinate.value}`;
}

/**
 * Parses one coordinate as it would be written in a command.
 *
 * Present so that a coordinate arriving as text - from a tool argument, or from a live
 * transcript being replayed - goes through exactly the same validation as one built in code.
 */
export function parseCoordinate(text: string, parameter = 'coordinate'): Coordinate {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new InvalidArgumentError(parameter, text, 'expected a coordinate like `5`, `~-2` or `^`');
  }
  const trimmed = text.trim();
  const frame: CoordinateFrame =
    trimmed.startsWith('~') ? 'relative' : trimmed.startsWith('^') ? 'local' : 'absolute';

  const digits = frame === 'absolute' ? trimmed : trimmed.slice(1);
  // A bare `~` or `^` is a zero offset. A bare absolute coordinate is nothing at all, but
  // that case is already out - `trimmed` is non-empty.
  if (digits === '') return make(frame, 0, parameter);

  if (!/^[+-]?\d+$/.test(digits)) {
    throw new InvalidArgumentError(parameter, text, 'expected a whole number after the prefix');
  }
  return make(frame, Number(digits), parameter);
}

function isTriple(point: Point): point is CoordinateTriple {
  return Array.isArray(point);
}

/** Widens a plain position into absolute coordinates; passes a triple through. */
export function toTriple(point: Point, parameter = 'position'): CoordinateTriple {
  if (isTriple(point)) {
    if (point.length !== 3) {
      throw new InvalidArgumentError(parameter, point, 'expected exactly three coordinates');
    }
    return point;
  }
  if (!point || typeof point !== 'object') {
    throw new InvalidArgumentError(parameter, point, 'expected {x, y, z} or three coordinates');
  }
  return [
    absolute(point.x, `${parameter}.x`),
    absolute(point.y, `${parameter}.y`),
    absolute(point.z, `${parameter}.z`),
  ];
}

/**
 * `^` cannot appear beside `~` or a world coordinate; the parser rejects the whole command.
 *
 * Checked across every coordinate in the command rather than per triple, because a /fill
 * whose `from` is local and whose `to` is absolute is the same mistake spread over two
 * arguments.
 */
export function assertOneFrame(triples: readonly CoordinateTriple[], parameter: string): void {
  const all = triples.flat();
  const locals = all.filter((c) => c.frame === 'local').length;
  if (locals !== 0 && locals !== all.length) {
    throw new InvalidArgumentError(
      parameter,
      triples.map((t) => t.map(formatCoordinate).join(' ')),
      'local (^) coordinates cannot be mixed with world or relative ones'
    );
  }
}

export function formatTriple(triple: CoordinateTriple): string {
  return triple.map(formatCoordinate).join(' ');
}

/**
 * How many blocks a box spans, or `null` when that cannot be known.
 *
 * Two coordinates on the same axis are only comparable when they share a frame: `~0` to `~5`
 * is six blocks wherever it runs, but `3` to `~5` depends on where the command executes.
 * Returning `null` rather than a guess is the point - a guessed volume would either wave
 * through a command the game will reject or reject one it would have accepted.
 */
export function boxVolume(from: CoordinateTriple, to: CoordinateTriple): number | null {
  let volume = 1;
  for (const [a, b] of [
    [from[0], to[0]],
    [from[1], to[1]],
    [from[2], to[2]],
  ] as const) {
    if (a.frame !== b.frame) return null;
    volume *= Math.abs(b.value - a.value) + 1;
  }
  return volume;
}
