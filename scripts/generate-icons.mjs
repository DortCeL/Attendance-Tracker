// Renders the app icons as PNG/ICO without any image dependencies.
// Usage: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../public/", import.meta.url);
mkdirSync(new URL("icons/", OUT), { recursive: true });

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const FROM = hex("#6366f1");
const TO = hex("#4338ca");
const WHITE = [255, 255, 255];
const ACCENT = hex("#4f46e5");
const RING = hex("#c7d2fe");

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(x, y, ax, ay, bx, by) {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const h = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * h, py - dy * h);
}

/** @param {{size:number, maskable:boolean}} opts */
function render({ size, maskable }) {
  const px = new Uint8Array(size * size * 4);
  // Maskable icons must keep content inside the central 80% safe zone.
  const s = maskable ? 0.8 : 1;
  const off = (1 - s) / 2;
  const T = (v) => off + v * s;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size;
      const y = (j + 0.5) / size;
      const aa = (d) => Math.max(0, Math.min(1, 0.5 - d * size));

      const t = (x + y) / 2;
      let col = FROM.map((c, k) => c + (TO[k] - c) * t);
      let alpha = maskable ? 1 : aa(sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22));

      const blend = (c, a) => {
        col = col.map((v, k) => v + (c[k] - v) * a);
      };

      // Calendar card
      blend(WHITE, aa(sdRoundRect(x, y, T(0.5), T(0.54), 0.27 * s, 0.25 * s, 0.07 * s)));
      // Binder rings
      for (const rx of [0.38, 0.62]) {
        blend(RING, aa(sdRoundRect(x, y, T(rx), T(0.28), 0.035 * s, 0.07 * s, 0.035 * s)));
      }
      // Check mark
      const w = 0.035 * s;
      const d = Math.min(
        sdSegment(x, y, T(0.37), T(0.56), T(0.46), T(0.65)),
        sdSegment(x, y, T(0.46), T(0.65), T(0.64), T(0.46)),
      );
      blend(ACCENT, aa(d - w));

      const o = (j * size + i) * 4;
      px[o] = Math.round(col[0]);
      px[o + 1] = Math.round(col[1]);
      px[o + 2] = Math.round(col[2]);
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePNG(size, px);
}

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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function encodeICO(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = size;
  header[7] = size;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const write = (name, buf) => {
  writeFileSync(new URL(name, OUT), buf);
  console.log("wrote", name);
};

write("icons/icon-192.png", render({ size: 192, maskable: false }));
write("icons/icon-512.png", render({ size: 512, maskable: false }));
write("icons/maskable-512.png", render({ size: 512, maskable: true }));
write("icons/apple-touch-icon.png", render({ size: 180, maskable: true }));
write("favicon.ico", encodeICO(render({ size: 32, maskable: false }), 32));
