/**
 * Generates a 3D navigation arrow PNG for Mapbox LocationPuck.
 * Style: TomTom/Waze — blue body, white highlight, dark shadow, sharp tip.
 * Size: 128x128 (high DPI)
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const W = 128, H = 128;
// RGBA pixel buffer
const pixels = Buffer.alloc(W * H * 4, 0);

function setPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  // Alpha-blend over existing pixel
  const sa = a / 255, da = pixels[i+3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa < 0.001) return;
  pixels[i+0] = Math.round((r * sa + pixels[i+0] * da * (1-sa)) / oa);
  pixels[i+1] = Math.round((g * sa + pixels[i+1] * da * (1-sa)) / oa);
  pixels[i+2] = Math.round((b * sa + pixels[i+2] * da * (1-sa)) / oa);
  pixels[i+3] = Math.round(oa * 255);
}

// ── Point-in-triangle test ──────────────────────────────────────────
function sign(px, py, ax, ay, bx, by) {
  return (px-bx)*(ay-by) - (ax-bx)*(py-by);
}
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = sign(px,py,ax,ay,bx,by);
  const d2 = sign(px,py,bx,by,cx,cy);
  const d3 = sign(px,py,cx,cy,ax,ay);
  const hasNeg = d1<0 || d2<0 || d3<0;
  const hasPos = d1>0 || d2>0 || d3>0;
  return !(hasNeg && hasPos);
}

// ── Arrow geometry (128x128) ────────────────────────────────────────
// Tip at top-center, wings at bottom
const cx = 64;
const TIP_Y  = 6;   // sharp tip
const MID_Y  = 72;  // widest point
const BOT_Y  = 110; // bottom corners
const NOTCH_Y = 86; // concave notch center
const HALF_W  = 46; // half-width at widest

// Arrow is made of 4 triangles:
// 1. Left body:  tip → left-mid → notch-center
// 2. Right body: tip → right-mid → notch-center
// 3. Left wing:  left-mid → left-bot → notch-center
// 4. Right wing: right-mid → right-bot → notch-center
const lMid = [cx - HALF_W, MID_Y];
const rMid = [cx + HALF_W, MID_Y];
const lBot = [cx - HALF_W + 8, BOT_Y];
const rBot = [cx + HALF_W - 8, BOT_Y];
const notch = [cx, NOTCH_Y];
const tip   = [cx, TIP_Y];

function insideArrow(x, y) {
  return (
    inTri(x,y, tip[0],tip[1], lMid[0],lMid[1], notch[0],notch[1]) ||
    inTri(x,y, tip[0],tip[1], rMid[0],rMid[1], notch[0],notch[1]) ||
    inTri(x,y, lMid[0],lMid[1], lBot[0],lBot[1], notch[0],notch[1]) ||
    inTri(x,y, rMid[0],rMid[1], rBot[0],rBot[1], notch[0],notch[1])
  );
}

// ── Render ────────────────────────────────────────────────────────────
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!insideArrow(x, y)) continue;

    // Normalized position within the arrow (0=tip, 1=bottom)
    const tY = Math.max(0, Math.min(1, (y - TIP_Y) / (BOT_Y - TIP_Y)));
    // Horizontal position (-1=left, 0=center, 1=right)
    const tX = (x - cx) / HALF_W;

    // ── Base color: light sky blue → bright cyan (top to bottom) ──
    const baseR = Math.round(60  + tY * 30);
    const baseG = Math.round(160 + tY * 40);
    const baseB = Math.round(245 - tY * 15);

    // ── 3D shading: highlight left-of-center top, shadow right bottom ──
    // Top-center white highlight
    const tipDist = Math.sqrt((x-cx)**2 + (y-TIP_Y-12)**2) / 30;
    const highlight = Math.max(0, 1 - tipDist) * 0.50;

    // Right-side directional light shadow (softer)
    const shadow = Math.max(0, tX * 0.18 + tY * 0.15);

    let r = baseR + highlight * (255 - baseR) - shadow * baseR;
    let g = baseG + highlight * (255 - baseG) - shadow * baseG;
    let b = baseB + highlight * (255 - baseB) - shadow * baseB;

    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));

    setPixel(x, y, r, g, b, 255);
  }
}

// ── Dark outline (1-2px border for crisp edges) ──────────────────────
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (insideArrow(x, y)) continue;
    // Check if any neighbor is inside
    let border = false;
    for (let dy = -2; dy <= 2 && !border; dy++)
      for (let dx = -2; dx <= 2 && !border; dx++)
        if (Math.abs(dx)+Math.abs(dy) <= 2 && insideArrow(x+dx, y+dy)) border = true;
    if (border) setPixel(x, y, 0, 100, 200, 180);
  }
}

// ── White shine streak along the top-left edge ───────────────────────
for (let y = TIP_Y; y < MID_Y - 10; y++) {
  for (let x = cx - 30; x < cx + 5; x++) {
    if (!insideArrow(x, y)) continue;
    const tY = (y - TIP_Y) / (MID_Y - TIP_Y);
    const tX = (x - (cx - 30)) / 35;
    const shine = Math.max(0, (1 - tY) * (1 - tX) * 0.45);
    if (shine > 0.02) setPixel(x, y, 255, 255, 255, Math.round(shine * 255));
  }
}

// ── PNG encode ────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c>>>1) : c>>>1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t   = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// Build raw PNG rows (filter byte 0 = None per row)
const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(W * 4 + 1);
  row[0] = 0;
  pixels.copy(row, 1, y * W * 4, (y+1) * W * 4);
  rows.push(row);
}
const compressed = zlib.deflateSync(Buffer.concat(rows));

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

const png = Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '../src/shared/assets/nav_arrow.png');
fs.writeFileSync(out, png);
console.log('nav_arrow.png created:', png.length, 'bytes');
