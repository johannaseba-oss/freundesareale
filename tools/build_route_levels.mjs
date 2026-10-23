// Erzeugt public/config/route_levels.json: Level für den Modus „Route“ (Tower Defense mit fester Strecke).
// Jedes Level: Route als Eckpunkte im 7×11-Raster (Gegner kommen oben herein und laufen unten hinaus),
// feste Bauplätze neben der Route, Gegner-Typen, Wellen und Stärke. Danach frei von Hand anpassbar.
// Aufruf: node tools/build_route_levels.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const COLS = 7, ROWS = 11;
const TYPES = ['Normal', 'Käfer', 'Pflanze', 'Wasser', 'Feuer', 'Elektro', 'Flug', 'Gift', 'Boden', 'Gestein', 'Eis', 'Kampf', 'Psycho', 'Geist', 'Fee', 'Stahl', 'Unlicht', 'Drache'];
// Routen-Vorlagen (Eckpunkte [Spalte, Zeile]); Zeile -1 = Eingang oben, Zeile 11 = Ausgang unten
const PATHS = [
  { name: 'Schlangenpfad', pts: [[3, -1], [3, 2], [1, 2], [1, 5], [5, 5], [5, 8], [3, 8], [3, 11]] },
  { name: 'Zickzack', pts: [[1, -1], [1, 3], [5, 3], [5, 6], [1, 6], [1, 9], [5, 9], [5, 11]] },
  { name: 'Haarnadel', pts: [[1, -1], [1, 8], [3, 8], [3, 2], [5, 2], [5, 11]] },
  { name: 'Treppe', pts: [[3, -1], [3, 3], [5, 3], [5, 6], [1, 6], [1, 9], [4, 9], [4, 11]] },
  { name: 'Serpentine', pts: [[0, -1], [0, 1], [6, 1], [6, 4], [0, 4], [0, 7], [6, 7], [6, 9], [3, 9], [3, 11]] },
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
// Bauplätze: freie Felder neben der Route; bevorzugt solche, von denen aus viel Route in Reichweite liegt, mit Abstand zueinander
function slots(pts, n) {
  const path = cells(pts), on = new Set(path.map(([x, y]) => x + ',' + y));
  const cand = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (on.has(x + ',' + y)) continue;
    const near = path.filter(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) <= 1).length;
    if (!near) continue;
    const reach = path.filter(([px, py]) => Math.hypot(px - x, py - y) <= 2).length;
    cand.push({ x, y, score: near * 2 + reach + rnd() * 2 });
  }
  cand.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cand) {
    if (out.length >= n) break;
    if (out.some((o) => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) < 2)) continue; // nicht direkt nebeneinander
    out.push(c);
  }
  return out.map((c) => [c.x, c.y]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
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
    slots: slots(P.pts, Math.max(9, 13 - Math.floor(n / 8))),
    types: [...new Set(types)],
    waves: 6 + Math.floor(n / 4),
    enemyLevel: Math.round(1 + (n - 1) * 1.55), // Level 1 mit frisch gezogenen Pokémon schaffbar
    countMult: +(0.8 + n * 0.03).toFixed(2),
    finalStage: n < 6 ? 2 : 3,
  });
}
fs.writeFileSync(path.join(ROOT, 'public/config/route_levels.json'), JSON.stringify({
  _hinweis: 'Route-Level. path = Eckpunkte der Route [Spalte, Zeile] im 7×11-Raster (Zeile -1 = Eingang oben, 11 = Ausgang unten), slots = Bauplätze, types = Gegner-Typen, waves = Wellen, enemyLevel = Gegnerlevel in Welle 1 (+enemy.levelPerWave je Welle), countMult = Gegneranzahl-Faktor, finalStage = höchste Entwicklungsstufe. Neu erzeugen: node tools/build_route_levels.mjs',
  levels,
}, null, 1));
console.log('Level:', levels.length, 'Bauplätze:', levels.map((l) => l.slots.length).join(','));
