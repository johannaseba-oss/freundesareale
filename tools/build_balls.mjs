// Schneidet die Pokéball-Pixelgrafiken (vergrößerter Bogen, 4×7 Bälle) auf Originalpixel herunter
// und legt sie als Bogen public/art/balls.png ab (28 Zellen à 20×20 px, zeilenweise).
// Aufruf: node tools/build_balls.mjs <bild>
import sharp from 'sharp';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.argv[2];
const PIX = 7.25, CELL = 20, COLS = 7;
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const fg = (x, y) => { const i = (y * W + x) * 4; return data[i + 3] > 128 && data[i] + data[i + 1] + data[i + 2] < 690; };
const runs = (n, f) => { const r = []; let s = -1; for (let i = 0; i <= n; i++) { const v = i < n && f(i); if (v && s < 0) s = i; if (!v && s >= 0) { r.push([s, i - 1]); s = -1; } } return r; };
const xr = runs(W, (x) => { for (let y = 0; y < H; y++) if (fg(x, y)) return true; return false; });
const yr = runs(H, (y) => { for (let x = 0; x < W; x++) if (fg(x, y)) return true; return false; });
const out = Buffer.alloc(CELL * COLS * CELL * yr.length * 4);
const OW = CELL * COLS;
let n = 0;
for (let r = 0; r < yr.length; r++) for (let c = 0; c < xr.length; c++) {
  // genaue Box dieses Balls
  const [x0a, x1a] = xr[c], [y0a, y1a] = yr[r];
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = y0a; y <= y1a; y++) for (let x = x0a; x <= x1a; x++) if (fg(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const nw = Math.round((x1 - x0 + 1) / PIX), nh = Math.round((y1 - y0 + 1) / PIX);
  const ox = Math.floor((CELL - nw) / 2), oy = Math.floor((CELL - nh) / 2);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
    const sx = Math.floor(x0 + (i + 0.5) * ((x1 - x0 + 1) / nw)), sy = Math.floor(y0 + (j + 0.5) * ((y1 - y0 + 1) / nh));
    const si = (sy * W + sx) * 4;
    const dx = c * CELL + ox + i, dy = r * CELL + oy + j;
    if (dx < c * CELL || dx >= (c + 1) * CELL || dy < r * CELL || dy >= (r + 1) * CELL) continue;
    const di = (dy * OW + dx) * 4;
    if (data[si + 3] < 128) continue;
    data.copy(out, di, si, si + 3); out[di + 3] = 255;
  }
  n++;
}
await sharp(out, { raw: { width: OW, height: CELL * yr.length, channels: 4 } }).png().toFile(path.join(ROOT, 'public/art/balls.png'));
console.log('Bälle:', n);
