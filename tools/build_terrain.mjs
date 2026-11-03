// Bodenkacheln für Sonderattacken in PokeDefense/Chaos: Eis aus dem Tileset, Wurzeln (transparent) und Schleim (nahtlos) als Pixelgrafik.
// Aufruf: node tools/build_terrain.mjs
import fs from 'fs';
import sharp from 'sharp';

const OUT = 'public/art/defense/', S = 24;
fs.mkdirSync(OUT, { recursive: true });
await sharp('D:/Pokemon Sprites/Tilesets/icecave.png').extract({ left: 7 * S, top: 8 * S, width: S, height: S }).png().toFile(OUT + 'boden_eis.png');

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const canvas = () => Buffer.alloc(S * S * 4);
const put = (d, x, y, c) => { x = ((x % S) + S) % S; y = ((y % S) + S) % S; d.set(c, (y * S + x) * 4); };
const save = (d, name) => sharp(d, { raw: { width: S, height: S, channels: 4 } }).png().toFile(OUT + name);

// Wurzeln: einzelne Stränge auf transparentem Grund, die Mitte treibt nach außen und läuft dünner aus (32 × 32)
const R = 32, rootPx = Buffer.alloc(R * R * 4);
const dab = (x, y, r, c) => { for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) if (a * a + b * b <= r * r + 0.5) { const X = Math.round(x + a), Y = Math.round(y + b); if (X >= 0 && Y >= 0 && X < R && Y < R) rootPx.set(c, (Y * R + X) * 4); } };
const strands = [];
const grow = (x, y, ang, len, width) => {
  for (let i = 0; i < len; i++) {
    const w = width * (1 - i / len);
    strands.push({ x, y, r: Math.max(0, Math.round(w)) });
    ang += (rnd() - 0.5) * 0.6; x += Math.cos(ang); y += Math.sin(ang);
    if (i > 2 && i % 5 === 0 && w > 0.8) grow(x, y, ang + (rnd() < 0.5 ? 0.9 : -0.9), Math.round(len * 0.45), w * 0.7);
  }
};
for (let n = 0; n < 6; n++) grow(16, 17, (n / 6) * Math.PI * 2 + rnd() * 0.5, 13, 2.4);
for (const q of strands) dab(q.x, q.y, q.r + 1, [46, 30, 16, 255]); // dunkle Kontur
for (const q of strands) dab(q.x, q.y, q.r, [120, 82, 44, 255]);
for (const q of strands) if (q.r > 0) dab(q.x - 0.5, q.y - 0.5, q.r - 1, [172, 128, 78, 255]); // heller Grat
await sharp(rootPx, { raw: { width: R, height: R, channels: 4 } }).png().toFile(OUT + 'boden_wurzel.png');

// Schleim: violette Fläche mit dunkleren Pfützen und hellen Glanzpunkten
const slime = canvas();
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(slime, x, y, [142, 96, 190, 205]);
for (let n = 0; n < 6; n++) {
  const cx = Math.floor(rnd() * S), cy = Math.floor(rnd() * S), r = 2 + Math.floor(rnd() * 3);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(slime, cx + x, cy + y, [104, 64, 156, 225]);
  put(slime, cx - 1, cy - 1, [216, 186, 240, 255]); put(slime, cx, cy - 1, [186, 150, 226, 255]);
}
await save(slime, 'boden_schleim.png');
console.log('ok');
