// Draws the toolbar icons (a basketball) as PNGs with no dependencies.
// Run with: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const ORANGE = [242, 120, 32];
const SEAM = [40, 24, 16];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Color at a point in unit coordinates, or null outside the ball.
function sample(x, y, seamWidth) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = Math.hypot(dx, dy);
  if (r > 0.47) return null;
  const nearSeam =
    r > 0.47 - seamWidth * 1.2 || // outline
    Math.abs(dx) < seamWidth / 2 || // vertical seam
    Math.abs(dy) < seamWidth / 2 || // horizontal seam
    Math.abs(Math.hypot(x + 0.12, y - 0.5) - 0.5) < seamWidth / 2 || // left curve
    Math.abs(Math.hypot(x - 1.12, y - 0.5) - 0.5) < seamWidth / 2; // right curve
  return nearSeam ? SEAM : ORANGE;
}

function draw(size) {
  const seamWidth = Math.max(1.4 / size, 0.045);
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 4; // supersampling per axis
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, seamWidth);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
        rgba[i + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return png(size, rgba);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `icon-${size}.png`), draw(size));
  console.log(`icons/icon-${size}.png`);
}
