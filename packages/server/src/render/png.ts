/**
 * Drawing a plan, so it can be looked at before it is built.
 *
 * D-14 diagnosed the geometry tools as blind: parameters go in, and what comes out has to be
 * imagined. `world.read_region` answered the other half of that - what is there now - but
 * only after the blocks are placed, and only 4096 at a time at 3.7 seconds a read. Checking a
 * radius-32 sphere that way is about five minutes. Drawing the same sphere from the positions
 * the shape function already computed is 50ms, which is the difference between a loop a model
 * can run and one it cannot.
 *
 * ## Why PNG, and why by hand
 *
 * A tool result may carry an image (`ImageContentSchema` in the MCP core types), and Claude
 * Code turns one into a picture the model actually sees. So the server can answer "what will
 * this look like" with a picture rather than a paragraph.
 *
 * Writing a PNG needs a deflate stream and a CRC32, and `node:zlib` has both - so this costs
 * no dependency, which matters because D-8 puts the whole thing behind `npx`. *Reading* a PNG
 * is a different job and is not attempted here: a hand-written decoder was tried and fell
 * over on the second real file (a palette PNG), and the formats in the wild go on from there.
 * Encoding is a fixed path we choose; decoding is every path someone else chose.
 *
 * ## What the picture is
 *
 * An orthographic elevation with depth shading - nearer blocks lighter. Not a render: no
 * perspective, no block textures, no lighting. It answers "is this the shape I meant", which
 * is the question the parameters cannot answer, and deliberately not "is this pretty".
 */

import zlib from 'node:zlib';

import type { Position } from '../geometry/index.js';

/** Which way the plan is being looked at. */
export type View = 'front' | 'side' | 'top';

export interface RenderedPlan {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  /** How many pixels one block became. 1 means the plan did not fit at any larger size. */
  readonly scale: number;
  /** Blocks spanned across the image and up it, before scaling. */
  readonly spanAcross: number;
  readonly spanUp: number;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typed) >>> 0);
  return Buffer.concat([length, typed, crc]);
}

/** Truecolour, 8 bits a channel, no interlacing, filter 0 on every row. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const target = y * (1 + stride);
    raw[target] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, target + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Where each view puts the axes.
 *
 * `across` runs left to right in the image, `up` runs bottom to top, and `depth` grows
 * towards the viewer, so a larger depth is drawn in front and shaded lighter.
 *
 * - `front` looks north from the south: east is to the right, up is up.
 * - `side` looks west from the east: south is to the right, up is up.
 * - `top` looks down: east is to the right, and north is up, which is how a floor plan is
 *   read and the opposite of the layer grid's row order. The grid's rows run north to south
 *   because that is the order a region arrives in; a plan is looked at, not indexed.
 */
const VIEWS: Record<View, (p: Position) => readonly [number, number, number]> = {
  front: (p) => [p.x, p.y, p.z],
  side: (p) => [p.z, p.y, p.x],
  top: (p) => [p.x, -p.z, p.y],
};

/**
 * Draws a set of block positions as an elevation.
 *
 * The plan is scaled to whole pixels per block. A fractional scale would put seams between
 * blocks in some rows and not others, which reads as detail that is not there - and the whole
 * point of the picture is that what it shows is what the plan holds.
 */
export function renderPlan(
  positions: readonly Position[],
  view: View = 'front',
  width = 256,
  height = 256
): RenderedPlan {
  const rgb = new Uint8Array(width * height * 3).fill(0xff);

  if (positions.length === 0) {
    return { png: encodePng(width, height, rgb), width, height, scale: 1, spanAcross: 0, spanUp: 0 };
  }

  const project = VIEWS[view];
  let acrossMin = Infinity;
  let acrossMax = -Infinity;
  let upMin = Infinity;
  let upMax = -Infinity;
  let depthMin = Infinity;
  let depthMax = -Infinity;

  for (const position of positions) {
    const [across, up, depth] = project(position);
    if (across < acrossMin) acrossMin = across;
    if (across > acrossMax) acrossMax = across;
    if (up < upMin) upMin = up;
    if (up > upMax) upMax = up;
    if (depth < depthMin) depthMin = depth;
    if (depth > depthMax) depthMax = depth;
  }

  const spanAcross = acrossMax - acrossMin + 1;
  const spanUp = upMax - upMin + 1;
  const scale = Math.max(1, Math.floor(Math.min(width / spanAcross, height / spanUp)));

  // Centred, so a tall thin plan does not sit in a corner.
  const offsetX = Math.floor((width - spanAcross * scale) / 2);
  const offsetY = Math.floor((height - spanUp * scale) / 2);

  const depthSpan = Math.max(1, depthMax - depthMin);
  const nearest = new Float64Array(width * height).fill(-Infinity);

  for (const position of positions) {
    const [across, up, depth] = project(position);
    const left = (across - acrossMin) * scale + offsetX;
    const bottom = (up - upMin) * scale + offsetY;

    // Nearer wins. Equal depth also wins, so the last writer at a tie is stable regardless of
    // the order positions arrive in - they are generated by a grid walk, not sorted.
    for (let dy = 0; dy < scale; dy++) {
      const py = height - 1 - (bottom + dy);
      if (py < 0 || py >= height) continue;
      for (let dx = 0; dx < scale; dx++) {
        const px = left + dx;
        if (px < 0 || px >= width) continue;
        const cell = py * width + px;
        if (depth < nearest[cell]!) continue;
        nearest[cell] = depth;

        const t = (depth - depthMin) / depthSpan;
        const shade = Math.round(70 + 140 * t);
        const at = cell * 3;
        rgb[at] = shade;
        rgb[at + 1] = shade;
        rgb[at + 2] = Math.min(255, shade + 40);
      }
    }
  }

  return { png: encodePng(width, height, rgb), width, height, scale, spanAcross, spanUp };
}
