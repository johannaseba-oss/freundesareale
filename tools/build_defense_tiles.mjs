// Schneidet Kacheln (24 px) aus PMD-Tilesets für die PokeDefense-Felder: je Thema Rand-Kacheln (Bäume, Felsen …) und Boden.
// Ergebnis: public/art/defense/<thema>.png (eine Zeile: erst Rand-, dann Boden-Kacheln) + public/config/defense_themes.json
// Aufruf: node tools/build_defense_tiles.mjs [--preview]
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.env.TILES_SRC || 'D:/Pokemon Sprites/Tilesets';
const T = 24;
// [Spalte, Zeile] im Tileset
// Je Thema eine sichere Rand- und Boden-Kachel; dazu werden alle farblich ähnlichen Kacheln gesucht (kein Wasser o. Ä.)
const THEMES = {
  wald: { file: 'dayforest.png', name: 'Wald', wall: [2, 0], floor: [0, 6], exact: true },
  herbst: { file: 'autumn forest.png', name: 'Herbstwald', wall: [1, 1], floor: [10, 3] },
  eis: { file: 'icecave.png', name: 'Eishöhle', wall: [1, 1], floor: [12, 0] },
  nachtwald: { file: 'darkforest.png', name: 'Dunkler Wald', wall: [1, 1], floor: [1, 8] },
  garten: { file: 'Flowergarden.png', name: 'Blumengarten', wall: [3, 0], floor: [0, 5] },
  hoehle: { file: 'darkcave.png', name: 'Felshöhle', wall: [1, 1], floor: [11, 2] },
  kristall: { file: 'bluecrystalcave.png', name: 'Kristallhöhle', wall: [1, 1], floor: [2, 5], exact: true },
};
// Merkmale einer Kachel: mittlere Farbe + Streuung
async function features(file) {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cols = Math.floor(info.width / T), rows = Math.floor(info.height / T), out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let n = 0, m = [0, 0, 0], q = [0, 0, 0];
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const i = ((r * T + y) * info.width + c * T + x) * 4; for (let k = 0; k < 3; k++) { m[k] += data[i + k]; q[k] += data[i + k] ** 2; } n++; }
    m = m.map((v) => v / n); const sd = q.map((v, k) => Math.sqrt(Math.max(0, v / n - m[k] ** 2)));
    out.push({ c, r, m, sd });
  }
  return out;
}
const dist = (a, b) => Math.hypot(...a.m.map((v, k) => v - b.m[k])) + 0.6 * Math.hypot(...a.sd.map((v, k) => v - b.sd[k]));
async function similar(file, seed, n = 6, max = 26) {
  const all = await features(file), ref = all.find((t) => t.c === seed[0] && t.r === seed[1]);
  return all.map((t) => ({ t, d: dist(t, ref) })).filter((x) => x.d < max).sort((a, b) => a.d - b.d).slice(0, n).map((x) => [x.t.c, x.t.r]);
}
// Nahtlos: Aus den ähnlichen Kacheln nur solche nehmen, deren Kanten übergangslos aneinanderpassen
// (sonst entstehen zerschnittene Bäume/Kristalle). Kosten = Farbsprung an der Kante im Verhältnis zum
// normalen Farbsprung innerhalb der Kachel; ≤ ~1 heißt: die Naht fällt nicht auf.
const px = new Map();
async function pixels(file) {
  if (!px.has(file)) px.set(file, await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  return px.get(file);
}
async function tileData(file, [c, r]) {
  const { data, info } = await pixels(file), out = [];
  for (let y = 0; y < T; y++) { const row = []; for (let x = 0; x < T; x++) { const i = ((r * T + y) * info.width + c * T + x) * 4; row.push([data[i], data[i + 1], data[i + 2], data[i + 3]]); } out.push(row); }
  return out;
}
const pd = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
function inner(t) { let s = 0, n = 0; for (let y = 0; y < T; y++) for (let x = 1; x < T; x++) { s += pd(t[y][x], t[y][x - 1]) + pd(t[x][y], t[x - 1][y]); n += 2; } return s / n || 1; }
// a links/oben, b rechts/unten
const seamH = (a, b) => { let s = 0; for (let y = 0; y < T; y++) s += pd(a[y][T - 1], b[y][0]); return s / T; };
const seamV = (a, b) => { let s = 0; for (let x = 0; x < T; x++) s += pd(a[T - 1][x], b[0][x]); return s / T; };
const fit = (a, b) => Math.max(seamH(a.d, b.d), seamH(b.d, a.d), seamV(a.d, b.d), seamV(b.d, a.d)) / ((a.inner + b.inner) / 2);
// base = 'seed': die gewählte Kachel ist die Grundkachel (Boden), sonst die mit der unauffälligsten Naht (Rand)
async function seamless(file, seed, max, poolSize, maxDist, base = 'best') {
  const pool = await similar(file, seed, poolSize, maxDist), feats = await features(file);
  const ts = [];
  for (const p of pool) { const d = await tileData(file, p); if (d.some((r) => r.some((q) => q[3] < 250))) continue; ts.push({ p, d, inner: inner(d), f: feats.find((x) => x.c === p[0] && x.r === p[1]) }); }
  for (const t of ts) t.self = fit(t, t);
  ts.sort((a, b) => a.self - b.self);
  const first = (base === 'seed' && ts.find((t) => t.p[0] === seed[0] && t.p[1] === seed[1])) || ts[0];
  const lim = Math.max(1.25, first.self * 1.15), chosen = [first];
  // Varianten: nahtlos UND farblich fast gleich wie die Grundkachel (keine Pflanzen/Kristalle/Ornamente im Boden)
  for (const t of ts) if (t !== first && chosen.length < max && t.self < lim && dist(t.f, first.f) < 12 && chosen.every((c) => fit(c, t) < lim)) chosen.push(t);
  console.log(file, 'Naht', chosen.map((c) => c.p.join(',') + ':' + c.self.toFixed(2)).join(' '));
  return chosen.map((c) => c.p);
}
// Wand: wenige nahtlose Kacheln. Boden: genau EINE Kachel (flache, gleichmäßige Fläche) – die nahtloseste
// unter den Kacheln, die der gewählten Bodenkachel farblich fast gleichen.
async function flatFloor(file, seed) {
  const feats = await features(file), ref = feats.find((t) => t.c === seed[0] && t.r === seed[1]);
  let bestT = null, bs = Infinity;
  for (const t of feats) {
    if (dist(t, ref) > 14) continue;
    const d = await tileData(file, [t.c, t.r]);
    if (d.some((r) => r.some((q) => q[3] < 250))) continue;
    const x = { d, inner: inner(d) }, v = fit(x, x);
    if (v < bs) { bs = v; bestT = [t.c, t.r]; }
  }
  console.log(file, 'Boden', bestT.join(','), 'Naht', bs.toFixed(2));
  return [bestT];
}
for (const th of Object.values(THEMES)) { th.wall = await seamless(th.file, th.wall, 3, 40, 45); th.floor = th.exact ? [th.floor] : await flatFloor(th.file, th.floor); } // exact: Bodenkachel von Hand festgelegt (gleichmäßigste Fläche)
// welches Thema zu welchen Gegner-Typen passt (erster Treffer zählt)
const BY_TYPE = { Eis: 'eis', Geist: 'nachtwald', Unlicht: 'nachtwald', Psycho: 'kristall', Drache: 'kristall', Gestein: 'hoehle', Boden: 'hoehle', Stahl: 'hoehle', Kampf: 'hoehle', Fee: 'garten', Pflanze: 'garten', Feuer: 'herbst', Käfer: 'wald', Normal: 'wald', Flug: 'herbst', Gift: 'nachtwald', Elektro: 'kristall', Wasser: 'wald' };

fs.mkdirSync(path.join(ROOT, 'public/art/defense'), { recursive: true });
const out = {};
for (const [id, th] of Object.entries(THEMES)) {
  const tiles = [...th.wall, ...th.floor];
  const comps = await Promise.all(tiles.map(async ([c, r], i) => ({ input: await sharp(path.join(SRC, th.file)).extract({ left: c * T, top: r * T, width: T, height: T }).png().toBuffer(), left: i * T, top: 0 })));
  await sharp({ create: { width: tiles.length * T, height: T, channels: 4, background: '#0000' } }).composite(comps).png().toFile(path.join(ROOT, `public/art/defense/${id}.png`));
  out[id] = { name: th.name, wall: th.wall.length, floor: th.floor.length };
}
fs.writeFileSync(path.join(ROOT, 'public/config/defense_themes.json'), JSON.stringify({ _hinweis: 'Feld-Grafik je Thema (Bau: node tools/build_defense_tiles.mjs). byType = welches Thema zu den Gegner-Typen eines Levels passt.', themes: out, byType: BY_TYPE }, null, 1));

// Vorschau: je Thema ein kleines Feld (Rand links/rechts, Boden in der Mitte)
if (process.argv.includes('--preview')) {
  const comps = [];
  let k = 0;
  for (const [id, th] of Object.entries(THEMES)) {
    const sheet = path.join(ROOT, `public/art/defense/${id}.png`);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
      const wall = c === 0 || c === 6, n = wall ? th.wall.length : th.floor.length, i = (r * 7 + c * 3) % n + (wall ? 0 : th.wall.length);
      comps.push({ input: await sharp(sheet).extract({ left: i * T, top: 0, width: T, height: T }).png().toBuffer(), left: (k % 4) * 180 + c * T, top: Math.floor(k / 4) * 160 + r * T });
    }
    k++;
  }
  await sharp({ create: { width: 720, height: 320, channels: 4, background: '#222' } }).composite(comps).resize(1440, 640, { kernel: 'nearest' }).png().toFile(process.argv[process.argv.indexOf('--preview') + 1] || 'preview.png');
}
console.log('Themen:', Object.keys(out).join(', '));
