// Bodenkacheln für Sonderattacken in PokeDefense/Chaos: Eis aus dem Tileset, Wurzeln und Schleim als Pixelgrafik (24 × 24, nahtlos).
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

// Wurzeln: dunkler Erdton, darauf verschlungene Stränge mit heller Kante
const roots = canvas();
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(roots, x, y, (x * 3 + y * 5) % 7 === 0 ? [52, 38, 24, 215] : [66, 48, 30, 205]);
for (let n = 0; n < 5; n++) {
  let x = Math.floor(rnd() * S), y = Math.floor(rnd() * S), dx = rnd() < 0.5 ? 1 : -1;
  for (let i = 0; i < 26; i++) {
    put(roots, x, y, [124, 86, 48, 255]); put(roots, x + 1, y, [92, 62, 34, 255]); put(roots, x, y - 1, [160, 118, 70, 255]);
    if (i % 7 === 3) { put(roots, x + 1, y - 1, [122, 199, 76, 255]); put(roots, x + 2, y - 2, [79, 143, 48, 255]); }
    if (rnd() < 0.55) x += dx; else y += 1;
    if (rnd() < 0.15) dx = -dx;
  }
}
await save(roots, 'boden_wurzel.png');

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
