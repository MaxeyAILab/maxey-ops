// Generates simple solid-brand PWA icons (192/512 px PNG) with zero deps.
// Placeholder until real Maxey Construction logo assets are supplied.
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c,
    table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  // Burgundy square with a white "M" band motif drawn per-pixel.
  const px = Buffer.alloc(size * size * 3);
  const burgundy = [0x6e, 0x14, 0x20];
  const white = [0xff, 0xff, 0xff];
  const t = size / 12; // stroke thickness
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // "M" strokes: two verticals + two diagonals meeting mid
      const lx = size * 0.22,
        rx = size * 0.78,
        top = size * 0.25,
        bot = size * 0.75;
      let isM = false;
      if (y >= top && y <= bot) {
        if (Math.abs(x - lx) < t || Math.abs(x - rx) < t) isM = true;
        const prog = (y - top) / (bot - top);
        const dl = lx + prog * (size / 2 - lx) * 1.0;
        const dr = rx - prog * (rx - size / 2) * 1.0;
        if (prog <= 0.6 && (Math.abs(x - dl) < t || Math.abs(x - dr) < t)) isM = true;
      }
      const c = isM ? white : burgundy;
      const i = (y * size + x) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
  }
  // Add filter byte 0 per scanline
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makePng(size));
  console.log(`wrote public/icons/icon-${size}.png`);
}
