/**
 * Block identifiers and block states, kept apart from each other.
 *
 * This is where the worst defect in the legacy server lived. `normalizeBlockId` was the only
 * treatment a block id got, and it did two different things depending on its input:
 *
 *     normalizeBlockId('Stone')           -> 'minecraft:Stone'   // namespace added, case kept
 *     normalizeBlockId('minecraft:Stone') -> 'minecraft:stone'   // case folded
 *
 * and nothing anywhere checked the id for spaces. So `block_id: "air 0 destroy"` - which is
 * how the pre-1.19.70 syntax was written, and therefore what a model trained on old guides
 * produces - was passed straight through, and the game read the trailing words as further
 * arguments. A fill asked to replace turned into a fill that destroys.
 *
 * The fix is not a better regex on one function. It is that an id and its states are
 * separate values with separate types, and the id is rejected outright if it looks like it
 * is carrying anything else.
 *
 * Data values are gone from both /setblock and /fill as of Bedrock 1.19.70; states are the
 * only way to name a variant, and they are their own argument. That is why an id containing
 * `[` is an error here rather than something to pass along.
 */

import { InvalidArgumentError } from '../geometry/core.js';

export type BlockStateValue = string | number | boolean;
export type BlockStates = Readonly<Record<string, BlockStateValue>>;

export interface BlockSpec {
  readonly id: string;
  readonly states?: BlockStates;
}

const NAMESPACED = /^(?:([a-z0-9_]+):)?([a-z0-9_]+)$/;

/**
 * Folds an id to `namespace:name`.
 *
 * Case is folded first and unconditionally, so the two inputs above now agree. An id with no
 * namespace gets `minecraft:`, matching the legacy behaviour: unqualified names do resolve
 * in-game, but qualifying them is what keeps a vanilla block from being shadowed by an
 * add-on that happens to define the same short name.
 */
export function normalizeBlockId(raw: unknown, parameter = 'block'): string {
  if (typeof raw !== 'string') {
    throw new InvalidArgumentError(parameter, raw, 'expected a block id such as `stone`');
  }
  const id = raw.trim().toLowerCase();
  if (id === '') {
    throw new InvalidArgumentError(parameter, raw, 'expected a block id such as `stone`');
  }

  // Named diagnoses, because "does not match /^.../" tells a model nothing about what to do
  // instead, and these three mistakes are the ones that actually turn up.
  if (id.includes('[')) {
    throw new InvalidArgumentError(
      parameter,
      raw,
      'block states belong in their own argument, not in the id (use `states: { facing: "north" }`)'
    );
  }
  if (/\s/.test(id)) {
    throw new InvalidArgumentError(
      parameter,
      raw,
      'a block id is one word - the `stone 0 destroy` form was removed in 1.19.70, so pass the data value as a state and the mode as `mode`'
    );
  }
  if (!NAMESPACED.test(id)) {
    throw new InvalidArgumentError(
      parameter,
      raw,
      'expected `name` or `namespace:name` using lowercase letters, digits and underscores'
    );
  }

  return id.includes(':') ? id : `minecraft:${id}`;
}

const STATE_NAME = /^(?:[a-z0-9_]+:)?[a-z0-9_]+$/;

function formatStateValue(name: string, value: BlockStateValue, parameter: string): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new InvalidArgumentError(
        `${parameter}.${name}`,
        value,
        'a numeric block state is an integer'
      );
    }
    return String(value);
  }
  if (typeof value === 'string') {
    // Bedrock documents no escape sequence inside a state value, so a quote or a backslash
    // has no correct encoding. Refusing is the only honest option.
    if (/["\\\]]/.test(value)) {
      throw new InvalidArgumentError(
        `${parameter}.${name}`,
        value,
        'a block state value cannot contain a quote, a backslash or a bracket'
      );
    }
    return `"${value}"`;
  }
  throw new InvalidArgumentError(
    `${parameter}.${name}`,
    value,
    'a block state is a string, an integer or a boolean'
  );
}

/**
 * `["facing"="north","open"=true]`, or an empty string when there are no states.
 *
 * Names are sorted. The game does not care about the order, but a test does, and sorting
 * means the same states produce the same command regardless of the order the caller's object
 * happened to be built in.
 */
export function formatBlockStates(states: BlockStates | undefined, parameter = 'states'): string {
  if (states === undefined) return '';
  if (typeof states !== 'object' || states === null || Array.isArray(states)) {
    throw new InvalidArgumentError(parameter, states, 'expected an object of state names to values');
  }

  const names = Object.keys(states).sort();
  if (names.length === 0) return '';

  const parts = names.map((name) => {
    if (!STATE_NAME.test(name)) {
      throw new InvalidArgumentError(
        parameter,
        name,
        'a block state name is lowercase letters, digits and underscores, optionally namespaced'
      );
    }
    return `"${name}"=${formatStateValue(name, states[name] as BlockStateValue, parameter)}`;
  });

  return `[${parts.join(',')}]`;
}

/** The id and its states as they appear in a command, already space-separated. */
export function formatBlock(block: BlockSpec | string, parameter = 'block'): string {
  const spec: BlockSpec = typeof block === 'string' ? { id: block } : block;
  if (!spec || typeof spec !== 'object') {
    throw new InvalidArgumentError(parameter, block, 'expected a block id or {id, states}');
  }
  const id = normalizeBlockId(spec.id, parameter);
  const states = formatBlockStates(spec.states, `${parameter}.states`);
  return states === '' ? id : `${id} ${states}`;
}
