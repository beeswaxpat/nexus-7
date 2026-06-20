// Generates the NEXUS-7 app icon with zero external dependencies.
//
// Draws a 256x256 motif into a raw RGBA buffer: a rounded-square deep-space
// badge holding a receding neon wormhole (warped cyan->violet->magenta rings
// around an off-center vanishing point) with a white-hot chromatic "7" over it,
// then encodes:
//   - build/icon.png  : a real PNG (zlib deflate + CRC32 chunks)
//   - build/icon.ico  : a valid .ico whose single entry is that PNG (Windows
//                       Vista+ reads PNG-compressed icon entries natively).
//
// No canvas, no sharp, no downloaded binaries: just node:zlib. Run with `node`.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'build');
const SIZE = 256;

// ---- tiny software rasterizer ------------------------------------------------

const px = new Uint8Array(SIZE * SIZE * 4); // RGBA, premultiplied-free straight alpha

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Alpha-over a straight-alpha source color onto the buffer at (x,y). */
function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
  const i = (y * SIZE + x) * 4;
  const sa = clamp01(a);
  const da = px[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  for (let k = 0; k < 3; k++) {
    const src = [r, g, b][k];
    const dst = px[i + k];
    px[i + k] = Math.round((src * sa + dst * da * (1 - sa)) / outA);
  }
  px[i + 3] = Math.round(outA * 255);
}

function dist(x, y, cx, cy) {
  const dx = x - cx;
  const dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Smooth 0..1 edge over `soft` px around radius `r` (1 inside, 0 outside).
function ring(d, r, soft) {
  return clamp01((r - d) / soft);
}

// ---- compose the icon --------------------------------------------------------

const cx = SIZE / 2;
const cy = SIZE / 2;

// hsl -> rgb (h in degrees) so the tunnel can sweep cyan -> violet -> magenta.
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// 1) Background: deep-space navy with a faint radial glow toward the vanishing
// point (set slightly up-left so the tunnel reads as banking, not a bullseye).
const vx = cx - SIZE * 0.04;
const vy = cy - SIZE * 0.05;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = dist(x, y, vx, vy) / (SIZE * 0.78);
    const v = clamp01(1 - d);
    const i = (y * SIZE + x) * 4;
    px[i] = Math.round(4 + 10 * v * v);
    px[i + 1] = Math.round(5 + 14 * v * v);
    px[i + 2] = Math.round(10 + 30 * v * v);
    px[i + 3] = 255;
  }
}

// 2) Backdrop stars (deterministic LCG so the icon is reproducible).
let seed = 7;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
for (let i = 0; i < 70; i++) {
  const sx0 = Math.floor(rnd() * SIZE);
  const sy0 = Math.floor(rnd() * SIZE);
  const a = 0.15 + rnd() * 0.5;
  blend(sx0, sy0, 200, 225, 255, a);
  if (rnd() < 0.3) blend(sx0 + 1, sy0, 200, 225, 255, a * 0.6);
}

// 3) The wormhole: receding warped rings around the vanishing point. Radius is
// modulated by two angular harmonics per ring (the non-Euclidean morph from the
// live graphic) and hue sweeps cyan -> violet -> magenta with depth.
const RINGS = 8;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - vx;
    const dy = (y - vy) / 0.86; // squashed -> 3D throat
    const rr = Math.sqrt(dx * dx + dy * dy);
    if (rr > SIZE * 0.62) continue;
    const th = Math.atan2(dy, dx);
    for (let k = 0; k < RINGS; k++) {
      const depth = k / (RINGS - 1); // 0 near center .. 1 outer
      const base = SIZE * (0.055 + 0.50 * depth * depth); // perspective bunching
      const wr = base * (1 + 0.07 * Math.sin(3 * th + k * 1.9) + 0.045 * Math.sin(5 * th - k * 1.3));
      const half = 1.6 + depth * 2.4; // outer rings thicker
      const band = clamp01(1 - Math.abs(rr - wr) / half);
      if (band <= 0) continue;
      const glow = clamp01(1 - Math.abs(rr - wr) / (half * 4)) * 0.30;
      const hue = 188 + 122 * depth; // cyan -> violet -> magenta
      const [r, g, b] = hslToRgb(hue, 1, 0.58);
      blend(x, y, r, g, b, clamp01(band * 0.9 + glow) * (0.35 + 0.6 * depth));
    }
  }
}

// 4) Hot core at the vanishing point (the tunnel mouth).
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = dist(x, y, vx, vy);
    const core = ring(d, SIZE * 0.045, SIZE * 0.05);
    if (core > 0) blend(x, y, 220, 245, 255, core * 0.9);
    const halo = ring(d, SIZE * 0.13, SIZE * 0.1) * 0.25;
    if (halo > 0) blend(x, y, 90, 220, 255, halo);
  }
}

// 5) The "7": white-hot core with magenta/cyan chromatic ghosts (light split
// around a mass). Two thick segments: a top bar and a diagonal.
function thickLine(x0, y0, x1, y1, half, col, alpha) {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  const minx = Math.max(0, Math.floor(Math.min(x0, x1) - half - 2));
  const maxx = Math.min(SIZE - 1, Math.ceil(Math.max(x0, x1) + half + 2));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1) - half - 2));
  const maxy = Math.min(SIZE - 1, Math.ceil(Math.max(y0, y1) + half + 2));
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      let t = len2 === 0 ? 0 : ((x - x0) * vx + (y - y0) * vy) / len2;
      t = clamp01(t);
      const px2 = x0 + t * vx;
      const py2 = y0 + t * vy;
      const d = dist(x, y, px2, py2);
      const a = clamp01((half - d) / 2.2) * alpha;
      if (a > 0) blend(x, y, col[0], col[1], col[2], a);
    }
  }
}

// The "7": top bar then diagonal down-left, sized to sit across the tunnel.
const sx = cx - SIZE * 0.21;
const sy = cy - SIZE * 0.2;
const ex = cx + SIZE * 0.21;
const dgx = cx - SIZE * 0.06;
const dgy = cy + SIZE * 0.26;
const MAG = [255, 64, 236];
const CYN = [64, 232, 255];
// soft dark backing so the bright 7 reads over the rings
thickLine(sx, sy, ex, sy, 17, [2, 3, 8], 0.72);
thickLine(ex, sy, dgx, dgy, 17, [2, 3, 8], 0.72);
// chromatic ghosts: magenta shifted right, cyan shifted left
thickLine(sx + 6, sy, ex + 6, sy, 9, MAG, 0.6);
thickLine(ex + 6, sy, dgx + 6, dgy, 9, MAG, 0.6);
thickLine(sx - 6, sy, ex - 6, sy, 9, CYN, 0.6);
thickLine(ex - 6, sy, dgx - 6, dgy, 9, CYN, 0.6);
// white-hot core
thickLine(sx, sy, ex, sy, 7, [245, 250, 255], 0.97);
thickLine(ex, sy, dgx, dgy, 7, [245, 250, 255], 0.97);

// 6) Subtle scanlines for CRT flavor.
for (let y = 0; y < SIZE; y += 3) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    px[i] = Math.round(px[i] * 0.94);
    px[i + 1] = Math.round(px[i + 1] * 0.94);
    px[i + 2] = Math.round(px[i + 2] * 0.94);
  }
}

// 7) Rounded-square badge mask + a thin neon rim so the icon has a modern
// silhouette in the taskbar instead of a hard full square.
const RAD = SIZE * 0.21;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // signed distance to the rounded-rect (inset 2px for antialiased edges)
    const qx = Math.max(Math.abs(x - cx) - (SIZE / 2 - 2 - RAD), 0);
    const qy = Math.max(Math.abs(y - cy) - (SIZE / 2 - 2 - RAD), 0);
    const sd = Math.sqrt(qx * qx + qy * qy) - RAD;
    const i = (y * SIZE + x) * 4;
    const cover = clamp01(0.5 - sd); // 1 inside, 0 outside, soft 1px edge
    px[i + 3] = Math.round(px[i + 3] * cover);
    // thin rim glow just inside the edge
    const rim = clamp01(1 - Math.abs(sd + 3) / 2.4) * 0.5 * cover;
    if (rim > 0) blend(x, y, 60, 210, 255, rim);
  }
}

// ---- PNG encoder (RGBA, 8-bit, no interlace) ---------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // raw scanlines, each prefixed with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- ICO container with a single embedded PNG entry --------------------------

function encodeIco(pngBuf, size) {
  // ICONDIR (6) + one ICONDIRENTRY (16) + PNG payload.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 means 256)
  entry[1] = size >= 256 ? 0 : size; // height (0 means 256)
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuf.length, 8); // bytes in resource
  entry.writeUInt32LE(6 + 16, 12); // offset to PNG
  return Buffer.concat([header, entry, pngBuf]);
}

// ---- write outputs -----------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const rgbaBuf = Buffer.from(px.buffer);
const png = encodePng(SIZE, SIZE, rgbaBuf);
const ico = encodeIco(png, SIZE);

const pngPath = join(OUT_DIR, 'icon.png');
const icoPath = join(OUT_DIR, 'icon.ico');
writeFileSync(pngPath, png);
writeFileSync(icoPath, ico);

// also drop a favicon into the renderer's public dir (served by vite; linked
// from index.html so the dev:web tab and the packaged window share the mark)
const faviconPath = join(__dirname, '..', 'src', 'renderer', 'public', 'favicon.png');
mkdirSync(dirname(faviconPath), { recursive: true });
writeFileSync(faviconPath, png);

console.log(`wrote ${pngPath} (${png.length} bytes)`);
console.log(`wrote ${icoPath} (${ico.length} bytes)`);
console.log(`wrote ${faviconPath} (${png.length} bytes)`);
