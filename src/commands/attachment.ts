/**
 * Which blocks fall off when the block they are stuck to is written after them.
 *
 * A build that mixes a wall with ladders on it is two groups of positions, and the placer
 * sends up to sixty-four fills at once. Its own comment said order does not matter "because
 * the boxes are disjoint", which is true of where the blocks go and false of whether they
 * stay: a ladder filled into air pops the moment the wall behind it is written, and the fill
 * that wrote the wall reports success either way. The result is a report of a ladder that is
 * not there — the same class of failure as a shape buried by a later one, except nothing in
 * the batch result notices, because as far as the batch is concerned the position was filled.
 *
 * So the placer sends these last, after everything else has been answered for. This is the
 * list it uses.
 *
 * ## The list errs toward leaving a block out, not toward putting one in
 *
 * Those two mistakes are not symmetric, which is the whole reason this is a list of names
 * rather than a guess at a pattern.
 *
 * Leaving an attaching block out costs nothing new: it is sent in the first wave, exactly as
 * it is today, and may pop exactly as it does today. The bug is unfixed for that block and no
 * worse than before.
 *
 * Putting a *supporting* block in by mistake is actively harmful. A full block listed here
 * moves into the late wave alongside the things that sit on it, and they race again — so a
 * careless suffix is not a harmless over-reach, it re-creates the failure somewhere new. That
 * is why `sea_lantern`, `coral_block`, `brown_mushroom_block`, `mushroom_stem`,
 * `amethyst_block`, `budding_amethyst` and plain `grass` are deliberately absent while their
 * near-namesakes are present, and why the patterns below anchor rather than merely contain.
 */

import type { BlockSpec } from './blocks.js';

/**
 * Names with nothing useful to match on, or where a suffix would catch a full block too.
 *
 * Both the modern and the older Bedrock spellings are here where they differ - a world saved
 * before a rename still answers with the old name, and `world.read_region` passes back
 * whatever the game said.
 */
const ATTACHED_EXACT: ReadonlySet<string> = new Set([
  // Stuck to a wall or a floor, and the reason this exists at all.
  'ladder',
  'lever',
  'bell',
  'lantern',
  'soul_lantern',
  'painting',
  'item_frame',
  'glow_item_frame',
  'flower_pot',
  'bed',
  'cake',
  'snow_layer',
  'scaffolding',
  'string',
  'tripwire',
  'tripwire_hook',
  // Redstone that sits on the block below it.
  'redstone_wire',
  'repeater',
  'powered_repeater',
  'unpowered_repeater',
  'comparator',
  'powered_comparator',
  'unpowered_comparator',
  // Rails. Named rather than matched, so `rail` itself is covered alongside the prefixed ones.
  'rail',
  'golden_rail',
  'detector_rail',
  'activator_rail',
  // Growing things. `grass` is absent on purpose: in Bedrock that is the full grass block,
  // and the plants are `short_grass` and `tall_grass`.
  'short_grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dead_bush',
  'double_plant',
  'red_flower',
  'yellow_flower',
  'wither_rose',
  'spore_blossom',
  'hanging_roots',
  'big_dripleaf',
  'small_dripleaf',
  'nether_sprouts',
  'crimson_roots',
  'warped_roots',
  'brown_mushroom',
  'red_mushroom',
  'cactus',
  'sugar_cane',
  'reeds',
  'bamboo',
  'bamboo_sapling',
  'kelp',
  'seagrass',
  'sea_pickle',
  'lily_pad',
  'waterlily',
  'nether_wart',
  'cocoa',
  'wheat',
  'carrots',
  'potatoes',
  'beetroot',
  'pumpkin_stem',
  'melon_stem',
  'sweet_berry_bush',
  'torchflower_crop',
  'pitcher_crop',
  'chorus_flower',
  'chorus_plant',
  'turtle_egg',
  'frog_spawn',
  // Grown on a surface in a cave.
  'glow_lichen',
  'sculk_vein',
  'pointed_dripstone',
  'amethyst_cluster',
]);

/**
 * Families where every member attaches and the name says so.
 *
 * Anchored at the end so that a longer name built on the same word is not swept up with it -
 * `coral` catches `tube_coral` and leaves `coral_block` alone, `_mushroom` catches
 * `red_mushroom` and leaves `brown_mushroom_block` and `mushroom_stem` alone.
 */
const ATTACHED_PATTERNS: readonly RegExp[] = [
  // Every torch, including Education Edition's coloured ones, whose names end in the colour
  // rather than in `torch`. `torchflower` is a flower and belongs here too.
  /torch/,
  /(?:^|_)sign$/,
  /_button$/,
  /_pressure_plate$/,
  /_carpet$/,
  /_banner$/,
  // Catches trapdoors as well, which attach to the side of their frame.
  /door$/,
  /_sapling$/,
  // `candle`, `white_candle`, `candle_cake`, `white_candle_cake`.
  /candle/,
  /_amethyst_bud$/,
  /(?:^|_)coral$/,
  /coral_fan/,
  /_mushroom$/,
  // `vine`, `cave_vines`, `twisting_vines`, `weeping_vines`.
  /vines?$/,
];

/**
 * Whether this block has to wait for whatever it hangs on.
 *
 * Takes the group's block as the placer holds it - a bare id or a spec with states - because
 * the caller has one or the other and normalising at every call site is how the two drift
 * apart. States are not consulted: a ladder facing north and a ladder facing south are the
 * same problem.
 */
export function needsSupport(block: BlockSpec | string): boolean {
  const id = (typeof block === 'string' ? block : block.id).toLowerCase();
  // The namespace is dropped rather than required: ids reach here both ways, and an add-on
  // block named `myaddon:ladder` is not the vanilla one but is no worse off for waiting.
  const name = id.slice(id.indexOf(':') + 1);
  if (ATTACHED_EXACT.has(name)) return true;
  return ATTACHED_PATTERNS.some((pattern) => pattern.test(name));
}
