// Erzeugt public/config/route_levels.json: Level für den Modus „Route“ (Tower Defense mit fester Strecke).
// Jedes Level: Route als Eckpunkte im 9×13-Raster (Gegner kommen oben herein und laufen unten hinaus),
// feste Bauplätze neben der Route, Gegner-Typen, Wellen und Stärke. Danach frei von Hand anpassbar.
// Aufruf: node tools/build_route_levels.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const COLS = 9, ROWS = 13;
const TYPES = ['Normal', 'Käfer', 'Pflanze', 'Wasser', 'Feuer', 'Elektro', 'Flug', 'Gift', 'Boden', 'Gestein', 'Eis', 'Kampf', 'Psycho', 'Geist', 'Fee', 'Stahl', 'Unlicht', 'Drache'];
// Routen-Vorlagen (Eckpunkte [Spalte, Zeile]); Zeile -1 = Eingang oben, Zeile 13 = Ausgang unten
const PATHS = [
  { name: 'Schlangenpfad', pts: [[4, -1], [4, 2], [1, 2], [1, 6], [7, 6], [7, 10], [4, 10], [4, 13]] },
  { name: 'Zickzack', pts: [[1, -1], [1, 3], [7, 3], [7, 6], [1, 6], [1, 9], [7, 9], [7, 13]] },
  { name: 'Haarnadel', pts: [[1, -1], [1, 10], [4, 10], [4, 2], [7, 2], [7, 13]] },
  { name: 'Treppe', pts: [[4, -1], [4, 3], [7, 3], [7, 7], [2, 7], [2, 10], [5, 10], [5, 13]] },
  { name: 'Serpentine', pts: [[0, -1], [0, 1], [8, 1], [8, 4], [0, 4], [0, 7], [8, 7], [8, 10], [4, 10], [4, 13]] },
];
let seed = 20261024;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

function cells(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    for (let x = x0, y = y0; x !== x1 || y !== y1; x += dx, y += dy) out.push([x, y]);
  }
  out.push(pts[pts.length - 1]);
  return out.filter(([x, y]) => y >= 0 && y < ROWS && x >= 0 && x < COLS);
}
// Bauplätze: freie Felder neben der Route; bevorzugt solche, von denen aus viel Route in Reichweite liegt, mit Abstand zueinander.
// Zuerst Plätze in Verlängerung langer Geraden (dort sieht ein „Gerade“-Angreifer die ganze Strecke entlang),
// dazu ein kleiner Teich mit Seerosen-Plätzen nur für Wasser-Pokémon.
function slots(pts, n) {
  const path = cells(pts), on = new Set(path.map(([x, y]) => x + ',' + y));
  const free = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !on.has(x + ',' + y);
  const out = [], taken = (x, y) => out.some((o) => o.x === x && o.y === y);
  // 1) Enden langer Geraden (mind. 4 Felder): das Feld direkt hinter dem Ende, in Linie mit der Strecke
  const ends = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.abs(x1 - x0) + Math.abs(y1 - y0), dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    if (len < 4) continue;
    for (const [x, y] of [[x0 - dx, y0 - dy], [x1 + dx, y1 + dy]]) if (free(x, y)) ends.push({ x, y, score: len + rnd() });
  }
  ends.sort((a, b) => b.score - a.score);
  for (const e of ends) if (out.length < 3 && !taken(e.x, e.y)) out.push({ ...e, line: true });
  // 2) Teich (2×2) nahe der Route, abseits der Linien-Plätze; ein Seerosen-Platz an der Route
  let pond = null;
  const pondCand = [];
  for (let y = 1; y < ROWS - 2; y++) for (let x = 0; x < COLS - 1; x++) {
    const cellsP = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    if (!cellsP.every(([a, b]) => free(a, b) && !taken(a, b))) continue;
    const near = cellsP.reduce((m, [a, b]) => m + path.filter(([px, py]) => Math.max(Math.abs(px - a), Math.abs(py - b)) <= 1).length, 0);
    if (near) pondCand.push({ cellsP, score: near + rnd() * 3 });
  }
  pondCand.sort((a, b) => b.score - a.score);
  if (pondCand.length) {
    pond = pondCand[0].cellsP;
    const best = [...pond].sort((a, b) => path.filter(([px, py]) => Math.hypot(px - b[0], py - b[1]) <= 2).length - path.filter(([px, py]) => Math.hypot(px - a[0], py - a[1]) <= 2).length);
    out.push({ x: best[0][0], y: best[0][1], water: true });
    if (rnd() < 0.5) { const o = best.find(([a, b]) => Math.abs(a - best[0][0]) + Math.abs(b - best[0][1]) === 2) || null; if (o) out.push({ x: o[0], y: o[1], water: true }); }
  }
  const inPond = (x, y) => pond?.some(([a, b]) => a === x && b === y);
  const cand = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (on.has(x + ',' + y) || inPond(x, y)) continue;
    const near = path.filter(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) <= 1).length;
    if (!near) continue;
    const reach = path.filter(([px, py]) => Math.hypot(px - x, py - y) <= 2).length;
    cand.push({ x, y, score: near * 2 + reach + rnd() * 2 });
  }
  cand.sort((a, b) => b.score - a.score);
  for (const c of cand) {
    if (out.length >= n) break;
    if (out.some((o) => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) < 2)) continue; // nicht direkt nebeneinander
    out.push(c);
  }
  return { slots: out.sort((a, b) => a.y - b.y || a.x - b.x).map((c) => (c.water ? [c.x, c.y, 'w'] : [c.x, c.y])), water: pond || [] };
}

const levels = [];
for (let n = 1; n <= 30; n++) {
  const P = PATHS[(n - 1) % PATHS.length];
  const mixed = n % 5 === 0;
  const types = n <= 3 ? [['Normal'], ['Käfer'], ['Pflanze']][n - 1] : mixed ? [TYPES[(n * 7) % TYPES.length], TYPES[(n * 11 + 3) % TYPES.length]] : [TYPES[(n * 5) % TYPES.length]];
  levels.push({
    n,
    name: P.name,
    path: P.pts,
    ...slots(P.pts, Math.max(11, 15 - Math.floor(n / 8))),
    types: [...new Set(types)],
    waves: 6 + Math.floor(n / 4),
    enemyLevel: Math.round(1 + (n - 1) * 1.55), // Level 1 mit frisch gezogenen Pokémon schaffbar
    countMult: +(0.8 + n * 0.03).toFixed(2),
    finalStage: n < 6 ? 2 : 3,
  });
}
fs.writeFileSync(path.join(ROOT, 'public/config/route_levels.json'), JSON.stringify({
  _hinweis: 'Route-Level. path = Eckpunkte der Route [Spalte, Zeile] im 9×13-Raster (Zeile -1 = Eingang oben, 13 = Ausgang unten), slots = Bauplätze ([Spalte, Zeile] bzw. [Spalte, Zeile, "w"] = Seerose im Teich, nur für Wasser-Pokémon), water = Teich-Felder, types = Gegner-Typen, waves = Wellen, enemyLevel = Gegnerlevel in Welle 1 (+enemy.levelPerWave je Welle), countMult = Gegneranzahl-Faktor, finalStage = höchste Entwicklungsstufe. Neu erzeugen: node tools/build_route_levels.mjs',
  levels,
}, null, 1));
console.log('Level:', levels.length, 'Bauplätze:', levels.map((l) => l.slots.length).join(','), 'Seerosen:', levels.map((l) => l.slots.filter((x) => x[2] === 'w').length).join(','));
