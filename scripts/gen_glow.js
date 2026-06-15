// Generates a 64x64 blue radial glow PNG for LocationPuck shadowImage
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const SIZE = 64;
const cx = SIZE / 2, cy = SIZE / 2;

// CRC32 table
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// Build RGBA rows: blue glow, soft quadratic falloff
const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(SIZE * 4 + 1);
  row[0] = 0; // filter: None
  for (let x = 0; x < SIZE; x++) {
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    const t = Math.max(0, 1 - dist / (SIZE / 2));
    const a = Math.round(t * t * 200); // max 200/255 opacity at center
    row[1 + x*4 + 0] = 30;  // R
    row[1 + x*4 + 1] = 144; // G
    row[1 + x*4 + 2] = 255; // B
    row[1 + x*4 + 3] = a;   // A
  }
  rows.push(row);
}

const compressed = zlib.deflateSync(Buffer.concat(rows));

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

const png = Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '../src/shared/assets/nav_glow.png');
fs.writeFileSync(out, png);
console.log('Created:', out, '(' + png.length + ' bytes)');
