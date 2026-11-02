// Fußabdrücke übernehmen: nur Pokémon aus dem Spiel mit nicht-leerem Bild (leer = hat keine Füße). Trägt die Liste in config/footprint.json ein.
// Aufruf: node tools/build_footprints.mjs [Quellordner]
import fs from 'fs';
import sharp from 'sharp';

const SRC = process.argv[2] || 'D:/Game Asset Library/Pokemon/Footprints/FootprintAPI-main/Sprites';
const OUT = 'public/art/footprint/p', CF = 'public/config/footprint.json';
const raw = JSON.parse(fs.readFileSync('public/data/pokedex.json', 'utf8'));
const list = Array.isArray(raw) ? raw : raw.pokemon || raw.dex || Object.values(raw)[0];
fs.mkdirSync(OUT, { recursive: true });
const dex = [];
for (const p of list) {
  const f = `${SRC}/${p.dex}.png`;
  if (!fs.existsSync(f)) continue;
  const { data } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let on = false;
  for (let i = 3; i < data.length && !on; i += 4) on = data[i] > 0;
  if (!on) continue;
  fs.copyFileSync(f, `${OUT}/${p.dex}.png`);
  dex.push(p.dex);
}
dex.sort((a, b) => a - b);
const c = JSON.parse(fs.readFileSync(CF, 'utf8'));
c.dex = dex;
fs.writeFileSync(CF, JSON.stringify(c, null, 2) + '\n');
console.log(`${dex.length} Fußabdrücke`);
