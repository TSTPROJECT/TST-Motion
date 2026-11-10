// Draws the app icon as PNG files (no image libraries needed).
// Run: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [0x15, 0x18, 0x21], FG = [255, 255, 255], DOT = [0xf6, 0xb5, 0x3a];

function cubic(p0, p1, p2, p3, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return pts;
}
// Same curve as icon.svg, in a 64x64 box: M14 46 C22 14 30 14 33 32 S45 50 50 18
const curve = [...cubic([14, 46], [22, 14], [30, 14], [33, 32], 40), ...cubic([33, 32], [36, 50], [45, 50], [50, 18], 40)];

function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(px - a[0], py - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}
const cover = (d, px) => Math.max(0, Math.min(1, 0.5 - d / px));

function draw(size, maskable) {
  const img = Buffer.alloc(size * size * 4);
  const k = size / 64;
  const content = maskable ? 0.72 : 1; // keep the drawing inside the maskable safe zone
  const off = (64 - 64 * content) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) / k, uy = (y + 0.5) / k; // icon units
      const onePx = 1 / k;
      // background: rounded square (full bleed when maskable)
      let a = 1;
      if (!maskable) {
        const r = 16, cx = Math.min(Math.max(ux, r), 64 - r), cy = Math.min(Math.max(uy, r), 64 - r);
        a = cover(Math.hypot(ux - cx, uy - cy) - r, onePx);
      }
      let col = [...BG];
      const cxu = (ux - off) / content, cyu = (uy - off) / content;
      let d = Infinity;
      for (let i = 1; i < curve.length; i++) d = Math.min(d, segDist(cxu, cyu, curve[i - 1], curve[i]));
      const sw = cover(d - 3, onePx / content);
      col = col.map((c, i) => c + (FG[i] - c) * sw);
      const dd = cover(Math.hypot(cxu - 50, cyu - 16) - 6, onePx / content);
      col = col.map((c, i) => c + (DOT[i] - c) * dd);
      const o = (y * size + x) * 4;
      img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, img);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", draw(192, false));
writeFileSync("public/icons/icon-512.png", draw(512, false));
writeFileSync("public/icons/icon-maskable-512.png", draw(512, true));
console.log("icons written");
