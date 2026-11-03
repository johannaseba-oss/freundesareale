// Bodenkacheln für Sonderattacken in PokeDefense/Chaos: Eis aus dem Tileset, Wurzeln aus assets-input/defense/wurzeln.png, Schleim als Pixelgrafik.
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

// Wurzeln: vorgegebenes Bild, weicher Schatten raus, verkleinert
{
  const { data, info } = await sharp('assets-input/defense/wurzeln.png').ensureAlpha().resize(128, 128, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] < 90 ? 0 : data[i] > 180 ? 255 : data[i];
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(OUT + 'boden_wurzel.png');
}

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
