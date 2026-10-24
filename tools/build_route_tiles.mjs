// Autotiles für den Modus „Route“ aus den PMD-Tilesets (D:/Pokemon Sprites/Tilesets).
// Für jede Kachel wird gemessen, welche ihrer 8 Ränder (und die Mitte) Wand, Boden oder Wasser zeigen.
// Im Spiel wählt die Karte je Feld eine Kachel, deren Ränder zu den Nachbarn passen – zufällig unter allen passenden,
// damit nichts sichtbar wiederholt wird. Ergebnis: public/art/route/<thema>.png + public/config/route_tiles.json
// Aufruf: node tools/build_route_tiles.mjs [--preview <ordner>]
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.env.TILES_SRC || 'D:/Pokemon Sprites/Tilesets';
const T = 24, ROWS = 10, COLS = 16;
// Themen: Datei und Name; byType ordnet Gegner-Typen einem Thema zu
const THEMES = {
  wald: { file: 'dayforest.png', name: 'Wald' },
  herbst: { file: 'autumn forest.png', name: 'Herbstwald', seam: 'W' },
  nachtwald: { file: 'darkforest.png', name: 'Dunkler Wald' },
  eis: { file: 'icecave.png', name: 'Eishöhle' },
};
// seam: bei diesen Geländen nur nahtlose Füllkacheln (z. B. Herbstwald, dessen Baum-Teile sonst zerschnitten wirken)
const BY_TYPE = { Normal: 'wald', Käfer: 'wald', Pflanze: 'wald', Fee: 'herbst', Flug: 'herbst', Feuer: 'herbst', Kampf: 'herbst', Drache: 'herbst', Gift: 'nachtwald', Geist: 'nachtwald', Unlicht: 'nachtwald', Psycho: 'nachtwald', Wasser: 'eis', Eis: 'eis', Elektro: 'eis', Gestein: 'herbst', Boden: 'herbst', Stahl: 'nachtwald' };

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
async function analyze(file, seamOnly = '') {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Hintergrund der Tilesets ist ein dunkles Rot statt transparent (Farbe der leeren Kachel oben links) – solche Pixel zählen als leer
  const K = [data[0], data[1], data[2]];
  const key = (i) => Math.abs(data[i] - K[0]) + Math.abs(data[i + 1] - K[1]) + Math.abs(data[i + 2] - K[2]) < 24;
  const mean = (x0, y0, w, h) => { let r = 0, g = 0, b = 0, a = 0, n = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * info.width + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; a += key(i) ? 0 : data[i + 3]; n++; } return [r / n, g / n, b / n, a / n]; };
  const tiles = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const x0 = c * T, y0 = r * T;
    if (mean(x0, y0, T, T)[3] < 254) continue; // leer/transparent – schon wenige Pixel roter Hintergrund schließen die Kachel aus
    // 3×3 Bereiche (je 8×8): Reihenfolge N, NO, O, SO, S, SW, W, NW, Mitte
    const R = (i, j) => mean(x0 + i * 8, y0 + j * 8, 8, 8);
    tiles.push({ c, r, reg: [R(1, 0), R(2, 0), R(2, 1), R(2, 2), R(1, 2), R(0, 2), R(0, 1), R(0, 0), R(1, 1)] });
  }
  // Referenzfarben: Wand = Mitte der Kacheln in Zeile 0–1, Zweitgelände (Wasser/Abgrund) = Zeile 7, Boden = häufigste übrige Mittenfarbe
  const med = (list) => [0, 1, 2].map((k) => list.map((v) => v[k]).sort((a, b) => a - b)[Math.floor(list.length / 2)]);
  const W = med(tiles.filter((t) => t.r <= 1).map((t) => t.reg[8]));
  const A = med(tiles.filter((t) => t.r === 7).map((t) => t.reg[8]));
  const rest = tiles.filter((t) => dist(t.reg[8], W) > 25 && dist(t.reg[8], A) > 25).map((t) => t.reg[8]);
  const F = rest.length ? rest.map((c) => ({ c, n: rest.filter((d) => dist(c, d) < 12).length })).sort((a, b) => b.n - a.n)[0].c : [128, 128, 128];
  const cls = (col) => { const d = [['W', dist(col, W)], ['F', dist(col, F)], ['A', dist(col, A)]].sort((a, b) => a[1] - b[1]); return d[0][0]; };
  const out = tiles.map((t) => ({ c: t.c, r: t.r, t: cls(t.reg[8]), m: t.reg.slice(0, 8).map(cls).join('') }));
  // Füllkacheln (Mitte und alle Ränder gleiches Gelände): nur die, die nahtlos aneinanderpassen – sonst zerschnittene Bäume/Felsen
  const px = (c, r) => { const o = []; for (let y = 0; y < T; y++) { const row = []; for (let x = 0; x < T; x++) { const i = ((r * T + y) * info.width + c * T + x) * 4; row.push([data[i], data[i + 1], data[i + 2]]); } o.push(row); } return o; };
  const pd = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
  const inner = (t) => { let s2 = 0, n = 0; for (let y = 0; y < T; y++) for (let x = 1; x < T; x++) { s2 += pd(t[y][x], t[y][x - 1]) + pd(t[x][y], t[x - 1][y]); n += 2; } return s2 / n || 1; };
  const seam = (a, b) => { let h = 0, v = 0, h2 = 0, v2 = 0; for (let i = 0; i < T; i++) { h += pd(a.d[i][T - 1], b.d[i][0]); h2 += pd(b.d[i][T - 1], a.d[i][0]); v += pd(a.d[T - 1][i], b.d[0][i]); v2 += pd(b.d[T - 1][i], a.d[0][i]); } return Math.max(h, h2, v, v2) / T / ((a.in + b.in) / 2); };
  for (const t of seamOnly.split('')) {
    const fill = out.filter((k) => k.t === t && k.m === t.repeat(8)).map((k) => { const d = px(k.c, k.r); return { k, d, in: inner(d) }; });
    if (!fill.length) continue;
    for (const a of fill) a.self = seam(a, a);
    fill.sort((a, b) => a.self - b.self);
    const base = fill[0], lim = Math.max(1.3, base.self * 1.2);
    for (const a of fill) if (a !== base && (a.self > lim || seam(base, a) > lim)) a.k.x = 1; // x = nicht als Füllung verwenden
  }
  return { tiles: out, refs: { W, F, A } };
}

// ---- Karte (gleiche Logik wie im Spiel, src/ui/route.js) ----
export function terrainMap(level, cols = 9, rows = 13, pad = 2) {
  const cells = new Map(), key = (x, y) => x + ',' + y;
  const pathCells = [];
  const pts = level.path;
  for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0); for (let x = x0, y = y0; x !== x1 || y !== y1; x += dx, y += dy) pathCells.push([x, y]); }
  pathCells.push(pts[pts.length - 1]);
  const first = pts[0], last = pts[pts.length - 1];
  const tAt = (x, y) => {
    if (cells.has(key(x, y))) return cells.get(key(x, y));
    if (x === first[0] && y < 0) return 'F'; if (x === last[0] && y >= rows) return 'F'; // Eingang/Ausgang bis zum Rand
    return 'W';
  };
  for (const [x, y] of pathCells) cells.set(key(x, y), 'F');
  for (const [x, y] of level.slots) cells.set(key(x, y), 'F'); // Lichtungen für die Bauplätze
  for (const [x, y] of level.water || []) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!cells.has(key(x + dx, y + dy)) && x + dx >= 0 && x + dx < cols && y + dy >= 0 && y + dy < rows) cells.set(key(x + dx, y + dy), 'F'); // Ufer
  for (const [x, y] of level.water || []) cells.set(key(x, y), 'A');
  return { tAt, cols, rows, pad };
}
// erwartete Ränder einer Zelle (N, NO, O, SO, S, SW, W, NW): eigenes Gelände, wenn der Nachbar dazugehört, sonst Boden
export function expected(tAt, x, y) {
  const t = tAt(x, y);
  if (t === 'F') return 'FFFFFFFF';
  const same = (dx, dy) => tAt(x + dx, y + dy) === t;
  const o = (dx, dy) => (same(dx, dy) ? t : 'F');
  const corner = (dx, dy) => (same(dx, 0) && same(0, dy) && same(dx, dy) ? t : 'F');
  return o(0, -1) + corner(1, -1) + o(1, 0) + corner(1, 1) + o(0, 1) + corner(-1, 1) + o(-1, 0) + corner(-1, -1);
}
export function pickTile(tiles, t, exp, h) {
  let best = [], bs = 99;
  for (const k of tiles) {
    if (k.t !== t || (k.x && exp === t.repeat(8))) continue; // unpassende Füllkacheln auslassen
    let s = 0; for (let i = 0; i < 8; i++) if (k.m[i] !== exp[i]) s += i % 2 ? 1 : 2; // Kanten wichtiger als Ecken
    if (s < bs) { bs = s; best = [k]; } else if (s === bs) best.push(k);
  }
  return best.length ? best[h % best.length] : null;
}

const out = { _hinweis: 'Route-Autotiles (Bau: node tools/build_route_tiles.mjs). Je Kachel: c/r = Position im Bild, t = Gelände der Mitte (W Wand, F Boden, A Wasser/Abgrund), m = Ränder N, NO, O, SO, S, SW, W, NW. byType = Thema je Gegner-Typ.', themes: {}, byType: BY_TYPE };
fs.mkdirSync(path.join(ROOT, 'public/art/route'), { recursive: true });
for (const [id, th] of Object.entries(THEMES)) {
  const a = await analyze(th.file, th.seam);
  await sharp(path.join(SRC, th.file)).extract({ left: 0, top: 0, width: COLS * T, height: ROWS * T }).png().toFile(path.join(ROOT, `public/art/route/${id}.png`));
  out.themes[id] = { name: th.name, tiles: a.tiles };
  const cnt = (t) => a.tiles.filter((k) => k.t === t).length;
  console.log(id.padEnd(10), 'Wand', cnt('W'), 'Boden', cnt('F'), 'Wasser', cnt('A'), 'Boden voll', a.tiles.filter((k) => k.t === 'F' && k.m === 'FFFFFFFF').length);
}
fs.writeFileSync(path.join(ROOT, 'public/config/route_tiles.json'), JSON.stringify(out));

// Vorschau: Level 1–5 je Thema als Bild
const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  const dir = process.argv[pi + 1];
  const levels = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/config/route_levels.json'), 'utf8')).levels;
  for (const [id] of Object.entries(THEMES)) {
    const tiles = out.themes[id].tiles, sheet = path.join(ROOT, `public/art/route/${id}.png`), lv = levels[(Object.keys(THEMES).indexOf(id)) % 5];
    const { tAt, cols, rows, pad } = terrainMap(lv);
    const comps = [];
    for (let y = -pad; y < rows + pad; y++) for (let x = -pad; x < cols + pad; x++) {
      const t = tAt(x, y), h = (((x * 73856093) ^ (y * 19349663)) >>> 0);
      const k = pickTile(tiles, t, expected(tAt, x, y), h) || pickTile(tiles, 'F', 'FFFFFFFF', h);
      comps.push({ input: await sharp(sheet).extract({ left: k.c * T, top: k.r * T, width: T, height: T }).png().toBuffer(), left: (x + pad) * T, top: (y + pad) * T });
    }
    await sharp({ create: { width: (cols + 2 * pad) * T, height: (rows + 2 * pad) * T, channels: 4, background: '#000' } }).composite(comps).png().toFile(path.join(dir, `route_${id}.png`));
  }
  console.log('Vorschau in', dir);
}
