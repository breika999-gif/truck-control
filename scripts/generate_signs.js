'use strict';
/**
 * generate_signs.js — EU road sign PNGs for TruckAI incident layer
 * 256×256 RGBA, callout-bubble style (white body + pointer tail at bottom)
 * Run: node scripts/generate_signs.js
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT  = path.join(__dirname, '..', 'src', 'shared', 'assets');
const SIZE = 256;

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG encoder ───────────────────────────────────────────────────────────────
function encodePNG(pixels, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t   = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    pixels.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Pixel helpers ─────────────────────────────────────────────────────────────
function newCanvas(w, h) { return Buffer.alloc(w * h * 4); }

function setPixel(buf, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w || y >= w) return;
  const i = (y * w + x) * 4;
  const sa = a / 255, da = buf[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa < 1e-6) return;
  buf[i]     = Math.round((r * sa + buf[i]     * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}

// AA filled circle
function fillCircle(buf, w, cx, cy, r, R, G, B, A) {
  const or = Math.ceil(r + 1);
  for (let y = cy - or; y <= cy + or; y++)
    for (let x = cx - or; x <= cx + or; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const aa = Math.max(0, Math.min(1, r - d + 0.5));
      if (aa > 0) setPixel(buf, w, x, y, R, G, B, Math.round(A * aa));
    }
}

// AA ring (annulus)
function fillRing(buf, w, cx, cy, inner, outer, R, G, B, A) {
  for (let y = cy - outer - 1; y <= cy + outer + 1; y++)
    for (let x = cx - outer - 1; x <= cx + outer + 1; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const aaO = Math.max(0, Math.min(1, outer - d + 0.5));
      const aaI = Math.max(0, Math.min(1, d - inner + 0.5));
      const aa  = aaO * aaI;
      if (aa > 0) setPixel(buf, w, x, y, R, G, B, Math.round(A * aa));
    }
}

// AA rounded horizontal bar
function fillBar(buf, w, cx, cy, halfW, halfH, R, G, B, A) {
  for (let y = cy - halfH; y <= cy + halfH; y++)
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      const dx = Math.max(0, Math.abs(x - cx) - (halfW - halfH));
      const dy = Math.abs(y - cy);
      const d  = Math.sqrt(dx * dx + dy * dy);
      const aa = Math.max(0, Math.min(1, halfH - d + 0.5));
      if (aa > 0) setPixel(buf, w, x, y, R, G, B, Math.round(A * aa));
    }
}

// AA filled equilateral triangle (pointing up)
// top vertex at (cx, ty), base at y=by, half-width at base = hw
function fillTrianglePts(buf, w, cx, ty, by, hw, R, G, B, A) {
  for (let py = ty - 1; py <= by + 1; py++) {
    const t = (py - ty) / (by - ty);
    const xL = cx - hw * t, xR = cx + hw * t;
    for (let px = Math.floor(xL) - 1; px <= Math.ceil(xR) + 1; px++) {
      const aaL  = Math.max(0, Math.min(1, px - xL + 0.5));
      const aaR  = Math.max(0, Math.min(1, xR - px + 0.5));
      const aaT  = Math.max(0, Math.min(1, py - ty + 0.5));
      const aaB  = Math.max(0, Math.min(1, by - py + 0.5));
      const aa   = Math.min(aaL, aaR, aaT, aaB);
      if (aa > 0) setPixel(buf, w, px, py, R, G, B, Math.round(A * aa));
    }
  }
}

// Callout pointer: isoceles triangle pointing DOWN from (cx, baseY) to tip (cx, tipY)
// halfBase = half-width of base
function fillPointer(buf, w, cx, baseY, tipY, halfBase, R, G, B, A) {
  for (let py = baseY; py <= tipY + 1; py++) {
    const t  = (py - baseY) / (tipY - baseY);
    const xL = cx - halfBase * (1 - t);
    const xR = cx + halfBase * (1 - t);
    for (let px = Math.floor(xL) - 1; px <= Math.ceil(xR) + 1; px++) {
      const aaL = Math.max(0, Math.min(1, px - xL + 0.5));
      const aaR = Math.max(0, Math.min(1, xR - px + 0.5));
      const aaT = Math.max(0, Math.min(1, py - baseY + 0.5));
      const aaB = Math.max(0, Math.min(1, tipY - py + 0.5));
      const aa  = Math.min(aaL, aaR, aaT, aaB);
      if (aa > 0) setPixel(buf, w, px, py, R, G, B, Math.round(A * aa));
    }
  }
}

// Soft drop-shadow circle
function shadowCircle(buf, w, cx, cy, r, spread) {
  for (let y = cy - r - spread; y <= cy + r + spread; y++)
    for (let x = cx - r - spread; x <= cx + r + spread; x++) {
      const d  = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const t  = Math.max(0, Math.min(1, (r + spread - d) / spread));
      const aa = t * t * (1 - t * 0.4); // ease-out
      if (aa > 0.01) setPixel(buf, w, x, y, 0, 0, 0, Math.round(55 * aa));
    }
}

// Soft drop-shadow for triangle
function shadowTriangle(buf, w, cx, ty, by, hw, spread) {
  for (let py = ty - spread; py <= by + spread; py++)
    for (let px = cx - hw - spread; px <= cx + hw + spread; px++) {
      // Signed distance to filled triangle (approx via closest point)
      const t = Math.max(0, Math.min(1, (py - ty) / (by - ty)));
      const edgeL = cx - hw * t, edgeR = cx + hw * t;
      const dX = px < edgeL ? edgeL - px : px > edgeR ? px - edgeR : 0;
      const dY = py < ty ? ty - py : py > by ? py - by : 0;
      const d  = Math.sqrt(dX * dX + dY * dY);
      const aa = Math.max(0, (spread - d) / spread);
      const v  = aa * aa;
      if (v > 0.01) setPixel(buf, w, px, py, 0, 0, 0, Math.round(50 * v));
    }
}

// ── Sign generators ───────────────────────────────────────────────────────────
const W = SIZE;

// EU B1 / Road-Closed sign — callout bubble with red ring + horizontal bar
function generateClosedRoad() {
  const buf = newCanvas(W, W);
  const cx = 128, cy = 108; // circle center (shifted up, leaves room for pointer)
  const outerR = 106, innerR = 72; // red ring: 34px thick — prominent EU B1 style

  // 1. Drop shadow
  shadowCircle(buf, W, cx + 5, cy + 5, outerR, 14);

  // 2. Bright red ring (EU B1 standard)
  fillRing(buf, W, cx, cy, innerR, outerR, 220, 15, 15, 255);

  // 3. White fill inside ring
  fillCircle(buf, W, cx, cy, innerR - 1, 255, 255, 255, 255);

  // 4. Red prohibition bar (horizontal) — 120×32 px
  fillBar(buf, W, cx, cy, 62, 16, 220, 15, 15, 255);

  // 5. White highlight arc (top-left) — gives 3-D depth
  fillCircle(buf, W, cx - 28, cy - 26, 36, 255, 255, 255, 40);

  // 6. White callout pointer
  fillPointer(buf, W, cx, cy + outerR - 2, 248, 20, 255, 255, 255, 255);
  // Red border of pointer
  fillPointer(buf, W, cx, cy + outerR - 2, 248, 22, 210, 20, 20, 255);
  // Re-draw white center
  fillPointer(buf, W, cx, cy + outerR - 4, 246, 17, 255, 255, 255, 255);

  return encodePNG(buf, W, W);
}

// EU danger/warning triangle — callout bubble with triangle inside
function generateDanger() {
  const buf = newCanvas(W, W);
  // Triangle geometry: top vertex, base y, half-base
  const tx = 128, ty = 18, by = 202, hw = 108;
  // Inner (yellow fill): slightly smaller
  const ity = ty + 16, iby = by - 10, ihw = hw - 14;

  // 1. Drop shadow
  shadowTriangle(buf, W, tx, ty, by, hw, 14);

  // 2. Red border triangle
  fillTrianglePts(buf, W, tx, ty, by, hw, 205, 18, 18, 255);

  // 3. Yellow-amber fill triangle
  fillTrianglePts(buf, W, tx, ity, iby, ihw, 255, 200, 0, 255);

  // 4. Exclamation mark — shaft
  const shaftCX = tx, shaftTop = ity + 28, shaftBot = iby - 30;
  fillBar(buf, W, shaftCX, Math.round((shaftTop + shaftBot) / 2),
          9, Math.round((shaftBot - shaftTop) / 2), 30, 20, 0, 240);
  // dot
  fillCircle(buf, W, shaftCX, iby - 14, 9, 30, 20, 0, 240);

  // 5. White highlight on triangle (top-left face)
  fillCircle(buf, W, tx - 22, ty + 30, 18, 255, 255, 255, 35);

  // 6. Callout pointer — white with dark border
  const pointerBaseY = by - 2;
  fillPointer(buf, W, tx, pointerBaseY, 248, 24, 205, 18, 18, 255);
  fillPointer(buf, W, tx, pointerBaseY + 2, 246, 18, 255, 200, 0, 255);

  return encodePNG(buf, W, W);
}

// Google-style yellow star map pin — 128×128
function generateStar() {
  const buf = newCanvas(128, 128);
  const cx = 64, cy = 58; // slightly up for pin tail

  // Drop shadow
  for (let i = 0; i < 10; i++) {
    const r = 42 - i * 2;
    if (r < 1) break;
    fillCircle(buf, 128, cx + 3, cy + 3, r, 0, 0, 0, Math.round(40 * (1 - i / 10)));
  }

  // Star polygon — 5 points, outer r=46, inner r=19
  function starVerts(ocx, ocy, outerR, innerR, n = 5) {
    const v = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (i * Math.PI / n) - Math.PI / 2;
      v.push([ocx + r * Math.cos(a), ocy + r * Math.sin(a)]);
    }
    return v;
  }

  function fillPoly(b, w, verts, R, G, B, A) {
    const ys = verts.map(v => v[1]);
    const minY = Math.floor(Math.min(...ys)) - 1;
    const maxY = Math.ceil(Math.max(...ys)) + 1;
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0; i < verts.length; i++) {
        const [x1, y1] = verts[i], [x2, y2] = verts[(i + 1) % verts.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y))
          xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
      }
      xs.sort((a, z) => a - z);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.floor(xs[k]); x <= Math.ceil(xs[k + 1]); x++) {
          const aa = Math.max(0, Math.min(1, Math.min(x - xs[k] + 0.5, xs[k + 1] - x + 0.5)));
          if (aa > 0) setPixel(b, w, x, y, R, G, B, Math.round(A * aa));
        }
      }
    }
  }

  // Orange border star (slightly larger)
  fillPoly(buf, 128, starVerts(cx, cy, 50, 21), 220, 100, 0, 255);
  // Gold fill star
  fillPoly(buf, 128, starVerts(cx, cy, 46, 19), 255, 215, 0, 255);
  // Inner bright highlight
  fillPoly(buf, 128, starVerts(cx - 3, cy - 3, 28, 12), 255, 240, 120, 100);

  // Pin pointer at bottom
  fillPointer(buf, 128, cx, cy + 46, 116, 12, 220, 100, 0, 255);
  fillPointer(buf, 128, cx, cy + 46, 114,  9, 255, 215,   0, 255);

  return encodePNG(buf, 128, 128);
}

// ── Write files ───────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(OUT, 'sign_closed.png'), generateClosedRoad());
console.log('✓  sign_closed.png  (256×256, EU B1 callout)');

fs.writeFileSync(path.join(OUT, 'sign_danger_0.png'), generateDanger());
console.log('✓  sign_danger_0.png  (256×256, EU warning callout)');

fs.writeFileSync(path.join(OUT, 'star_icon.png'), generateStar());
console.log('✓  star_icon.png  (128×128, Google-style yellow star)');

console.log('\nDone.');
