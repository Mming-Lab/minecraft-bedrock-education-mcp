// Drawing a plan before it is built.
//
//   node test/plan.test.mjs
//
// D-14 diagnosed the geometry tools as blind. `world.read_region` answered "what is there
// now", but only after the blocks are placed and only 4096 at a time - about five minutes for
// a radius-32 sphere. The server already knows every position it is about to fill, so it can
// answer "what will this be" without asking the game anything.
//
// What is checked here is the part that fails silently. A picture that is drawn from the
// wrong positions still looks like a picture, so the tests assert against pixels the geometry
// forces to a known value rather than against a byte count. And the store is bounded, which
// only matters when the bound is actually reached - so it is reached here rather than trusted.

import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { toolsFor, offlineBridge, offlineRunner, IMAGE_CONTENT, imageAttachment } from '../dist/tools/index.js';
import { encodePng, renderPlan } from '../dist/render/png.js';
import { storePlan, getPlan, resetPlans, planCount, MAX_PLANS } from '../dist/plan/store.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((error) => {
      failed++;
      console.log(`  FAIL ${name}`);
      console.log(`       ${(error.stack ?? error.message).split('\n').slice(0, 4).join('\n       ')}`);
    });
}

const tools = toolsFor(offlineBridge, offlineRunner);
const tool = (name) => tools.find((t) => t.name === name);

/** Pulls the pixels back out of a PNG this module wrote, so the assertions are about what a
 *  viewer would see rather than about how it was compressed. */
function decodeOurPng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (type === 'IDAT') idat.push(body);
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const pixel = (x, y) => {
    const at = y * (1 + stride) + 1 + x * 3;
    return [raw[at], raw[at + 1], raw[at + 2]];
  };
  return { width, height, pixel };
}

console.log('plan');

await test('an empty plan draws a blank picture rather than throwing', () => {
  // A shape can legitimately cover nothing once a caller starts intersecting things. A
  // renderer that divided by a zero span would fail on the first such plan.
  const drawn = renderPlan([], 'front', 64, 64);
  const { pixel } = decodeOurPng(drawn.png);
  assert.deepEqual(pixel(32, 32), [255, 255, 255]);
});

await test('a single block lands somewhere, and the rest of the picture stays blank', () => {
  const drawn = renderPlan([{ x: 0, y: 0, z: 0 }], 'front', 64, 64);
  const { pixel, width, height } = decodeOurPng(drawn.png);
  let painted = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixel(x, y)[0] !== 255) painted++;
    }
  }
  // One block scaled up to fill the frame: every pixel is the block, or none of it is.
  assert.equal(painted, drawn.scale * drawn.scale);
});

await test('the span reported is the span of the plan, in blocks', () => {
  const wall = [];
  for (let x = 0; x < 10; x++) for (let y = 0; y < 4; y++) wall.push({ x, y, z: 0 });
  const drawn = renderPlan(wall, 'front', 256, 256);
  assert.equal(drawn.spanAcross, 10);
  assert.equal(drawn.spanUp, 4);
});

await test('front and side show different faces of the same plan', () => {
  // A plan that is long in x and thin in z must be wide from the front and narrow from the
  // side. A renderer that ignored the view would pass every other test here.
  const bar = [];
  for (let x = 0; x < 12; x++) bar.push({ x, y: 0, z: 0 });
  assert.equal(renderPlan(bar, 'front', 128, 128).spanAcross, 12);
  assert.equal(renderPlan(bar, 'side', 128, 128).spanAcross, 1);
});

await test('nearer blocks are drawn lighter, which is the only depth cue there is', () => {
  // Two blocks at the same screen position, different depths. The near one must win, and it
  // must be the lighter of the two shades - otherwise the picture reads inside-out.
  const near = renderPlan([{ x: 0, y: 0, z: 10 }], 'front', 8, 8);
  const far = renderPlan([{ x: 0, y: 0, z: -10 }], 'front', 8, 8);
  // Each alone spans one depth, so both get the same shade; the cue only exists across a
  // range. Draw them together and the near one has to be on top.
  const both = renderPlan(
    [
      { x: 0, y: 0, z: -10 },
      { x: 0, y: 0, z: 10 },
    ],
    'front',
    8,
    8
  );
  assert.equal(decodeOurPng(near.png).pixel(4, 4)[0], decodeOurPng(far.png).pixel(4, 4)[0]);
  const shade = decodeOurPng(both.png).pixel(4, 4)[0];
  assert.ok(shade > decodeOurPng(near.png).pixel(4, 4)[0] - 1, 'the near block did not win');
});

await test('the PNG this writes can be read back by node:zlib, header and all', () => {
  // The encoder is hand-written against the spec. If the CRC or the filter byte were wrong a
  // viewer would refuse it, and nothing else in the suite would notice.
  const rgb = new Uint8Array(4 * 4 * 3).fill(0x40);
  const { width, height, pixel } = decodeOurPng(encodePng(4, 4, rgb));
  assert.equal(width, 4);
  assert.equal(height, 4);
  assert.deepEqual(pixel(2, 2), [0x40, 0x40, 0x40]);
});

await test('dryRun keeps the plan and sends nothing to the game', async () => {
  resetPlans();
  // offlineRunner throws on any command, so a build that reached the game would fail here.
  const result = await tool('build.sphere').handler({
    center: { x: 0, y: 0, z: 0 },
    radius: 3,
    block: 'stone',
    dryRun: true,
  });
  assert.equal(result.placed, false);
  assert.equal(result.commandCount, 0);
  assert.ok(result.planId, 'no planId came back');
  assert.equal(getPlan(result.planId).positions.length, result.blockCount);
});

await test('the coordinates do not travel in the result', () => {
  // The reason they were dropped in the first place, and still the reason. Keeping them on
  // the server was the change; returning them would undo it.
  resetPlans();
  const planId = storePlan([{ x: 1, y: 2, z: 3 }], 'build.cube', { id: 'stone' });
  const drawn = tool('plan.preview').handler({ planId });
  const serialised = JSON.stringify(drawn);
  assert.ok(!serialised.includes('"positions"'));
  // ...and neither does the picture, which would be tens of kilobytes of base64.
  assert.ok(!serialised.includes('data'), 'the image leaked into the JSON');
  assert.ok(imageAttachment(drawn), 'the image is not on the symbol either');
  assert.equal(imageAttachment(drawn).mimeType, 'image/png');
});

await test('a planId that aged out says what to do about it', () => {
  resetPlans();
  assert.throws(() => tool('plan.preview').handler({ planId: 'p0' }), /dryRun/);
});

await test('the store evicts rather than growing without limit', () => {
  resetPlans();
  const ids = [];
  for (let i = 0; i < MAX_PLANS + 5; i++) ids.push(storePlan([{ x: i, y: 0, z: 0 }], 'build.cube', { id: 'stone' }));
  assert.equal(planCount(), MAX_PLANS);
  assert.equal(getPlan(ids[0]), undefined, 'the oldest plan survived the limit');
  assert.ok(getPlan(ids[ids.length - 1]), 'the newest plan was evicted');
});

await test('plan.preview never touches the world and says so', () => {
  assert.equal(tool('plan.preview').annotations.readOnlyHint, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
