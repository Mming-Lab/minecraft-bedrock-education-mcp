// Minimal stand-ins for the MakeCode Minecraft API so `src/coordinates.ts` can be compiled
// and executed outside the editor. Behaviour matches what the coordinate functions rely on:
// a Position is an immutable (x, y, z) triple, and everything else is inert.

enum Axis {
  X = 0,
  Y = 1,
  Z = 2,
}

enum FillOperation {
  Replace = 0,
  Hollow = 1,
  Outline = 2,
  Destroy = 3,
  Keep = 4,
}

class Position {
  constructor(private readonly _x: number, private readonly _y: number, private readonly _z: number) {}

  public getValue(axis: Axis): number {
    if (axis === Axis.X) return this._x;
    if (axis === Axis.Y) return this._y;
    return this._z;
  }

  public toString(): string {
    return `(${this._x}, ${this._y}, ${this._z})`;
  }
}

function world(x: number, y: number, z: number): Position {
  return new Position(x, y, z);
}

function pos(x: number, y: number, z: number): Position {
  return new Position(x, y, z);
}

namespace player {
  /** No-op: progress chatter is irrelevant outside the game and would flood the console. */
  export function say(_message: any): void {}
}

namespace positions {
  export function equals(a: Position, b: Position): boolean {
    return (
      a.getValue(Axis.X) === b.getValue(Axis.X) &&
      a.getValue(Axis.Y) === b.getValue(Axis.Y) &&
      a.getValue(Axis.Z) === b.getValue(Axis.Z)
    );
  }

  export function add(a: Position, b: Position): Position {
    return new Position(
      a.getValue(Axis.X) + b.getValue(Axis.X),
      a.getValue(Axis.Y) + b.getValue(Axis.Y),
      a.getValue(Axis.Z) + b.getValue(Axis.Z)
    );
  }
}

namespace blocks {
  export const placed: Position[] = [];
  export const filled: { from: Position; to: Position }[] = [];

  export function place(_block: number, position: Position): void {
    placed.push(position);
  }

  export function fill(_block: number, from: Position, to: Position, _op: FillOperation): void {
    filled.push({ from, to });
  }
}

namespace loops {
  /** No-op: the harness has no game tick to yield to. */
  export function pause(_ms: number): void {}
}

// Exposes the namespace to the CommonJS wrapper that build.mjs appends.
declare const module: any;
