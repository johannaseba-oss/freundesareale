// Karten-Renderer für das 16-px-Tileset (public/art/tiles2.png, Werte in tiles2.json) – für Route und Spaziergang.
// Boden + Autotiles (Weg, Wasser, hohes Gras) werden aus Viertelkacheln (8×8) zusammengesetzt; auf Wand-Feldern wächst
// ein dichter Wald aus Baum-Sprites, freie Wiese bekommt etwas Deko (Blumen, Farne, Steine …).
import { CFG } from '../config.js';

const C = () => CFG.tiles2;
let img = null;
export function tilesImage() {
  if (!img) { img = new Image(); img.src = `${import.meta.env.BASE_URL}art/tiles2.png`; }
  return img;
}
export const themeOf = (id) => C().themes[id] || C().themes.wald;
export const themeIds = () => Object.keys(C().themes);
export const themeForType = (type) => C().byType[type] || 'wald';

// Autotile an (px, py) zeichnen; same(dx, dy) = Nachbar gehört zum selben Gelände
function drawAuto(x, im, block, px, py, same) {
  const [c, r] = block, S = 16;
  for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const dx = qx ? 1 : -1, dy = qy ? 1 : -1, hz = same(dx, 0), vt = same(0, dy), dg = same(dx, dy);
    let tx, ty;
    if (hz && vt) { if (dg) { tx = c + 3; ty = r; } else { tx = c + 3 + (1 - qx); ty = r + 1 + (1 - qy); } } // Füllung / Innenecke
    else if (hz) { tx = c + 1; ty = r + (qy ? 2 : 0); } // Kante oben/unten
    else if (vt) { tx = c + (qx ? 2 : 0); ty = r + 1; } // Kante links/rechts
    else { tx = c + (qx ? 2 : 0); ty = r + (qy ? 2 : 0); } // Außenecke
    x.drawImage(im, tx * S + qx * 8, ty * S + qy * 8, 8, 8, px + qx * 8, py + qy * 8, 8, 8);
  }
}
const hash = (a, b, s) => { let h = (a * 73856093) ^ (b * 19349663) ^ (s * 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

// cellAt(x, y) → 'W' Wald/Wand, 'A' Wasser, 'P' Weg, 'T' hohes Gras, 'C' Pflaster, 'F' Wiese, 'X' freie Wiese ohne Deko (z. B. Bauplätze)
// Bereich: Spalten c0..c1, Zeilen r0..r1 (darf über die Karte hinausgehen – dort liefert cellAt meist 'W')
export function renderTerrain({ c0, r0, c1, r1, cellAt, theme, seed = 1 }) {
  const im = tilesImage(), th = themeOf(theme), S = 16;
  const cv = document.createElement('canvas'); cv.width = (c1 - c0 + 1) * S; cv.height = (r1 - r0 + 1) * S;
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  const X = (c) => (c - c0) * S, Y = (r) => (r - r0) * S;
  const base = C().base[th.base] || C().base.grass;
  // 1) Boden
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const hb = hash(c, r, seed), [tx, ty] = base[hb % 6 === 0 ? 1 + (hb >> 3) % Math.max(1, base.length - 1) : 0] || base[0]; /* meist die Haupt-Kachel, selten Abwechslung */ x.drawImage(im, tx * S, ty * S, S, S, X(c), Y(r), S, S); }
  // 2) Autotiles: hohes Gras, Weg, Wasser
  for (const [kind, key] of [['T', th.tall], ['P', th.path], ['C', th.plaza || 'cobble'], ['A', th.water]]) {
    const block = C().auto[key];
    if (!block) continue;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (cellAt(c, r) === kind) drawAuto(x, im, block, X(c), Y(r), (dx, dy) => cellAt(c + dx, r + dy) === kind);
  }
  // 3) Deko auf freier Wiese, Seerosen auf dem Wasser
  const D = C().sprites.deco, items = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const t = cellAt(c, r), hsh = hash(c, r, seed + 7);
    if (t === 'F' && (hsh % 1000) / 1000 < C().decoChance) { const k = th.deco[hsh % th.deco.length], s = D[k]; if (s) items.push({ s, x: X(c) + (S - s[2]) / 2, y: Y(r) + S - s[3], z: Y(r) + S }); }
    if (t === 'A' && cellAt(c, r - 1) === 'A' && cellAt(c, r + 1) === 'A' && cellAt(c - 1, r) === 'A' && cellAt(c + 1, r) === 'A' && hsh % 9 === 0) { const s = D[hsh % 2 ? 'lily' : 'lily2']; items.push({ s, x: X(c), y: Y(r), z: Y(r) - 999 }); }
  }
  // 4) Wald: Bäume auf Wand-Feldern; Stamm-Felder müssen Wand sein, die Krone darf nur über Wand ragen
  const T = C().sprites.tree, B = C().sprites.big, used = new Set(), key = (c, r) => c + ',' + r;
  const allW = (ca, cb, ra, rb) => { for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) if (cellAt(c, r) !== 'W') return false; return true; };
  const free = (ca, cb, ra, rb) => { for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) if (used.has(key(c, r))) return false; return true; };
  const mark = (ca, cb, ra, rb) => { for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) used.add(key(c, r)); };
  for (let r = r0 - 1; r <= r1 + 3; r++) for (let c = c0 - 2; c <= c1 + 1; c++) {
    if (cellAt(c, r) !== 'W' || used.has(key(c, r))) continue;
    const hsh = hash(c, r, seed + 3);
    if (th.big?.length && hsh % 4 === 0 && allW(c, c + 2, r - 3, r) && free(c, c + 2, r, r)) {
      const s = B[th.big[hsh % th.big.length]]; items.push({ s, x: X(c), y: Y(r) + S - s[3] + 4, z: Y(r) + S }); mark(c, c + 2, r, r); continue;
    }
    if (allW(c, c + 1, r - 2, r) && free(c, c + 1, r, r)) {
      const s = T[th.trees[hsh % th.trees.length]]; items.push({ s, x: X(c) + ((hsh >> 4) % 3) - 1, y: Y(r) + S - s[3] + 4, z: Y(r) + S }); mark(c, c + 1, r, r); continue;
    }
    if (!used.has(key(c, r))) { // Lücke: Busch oder Stein
      const pool = th.base === 'snow' ? ['snowRock', 'iceFern', 'snowRock2'] : ['fern', 'plant', 'rock', 'tuft'];
      const s = D[pool[hsh % pool.length]]; items.push({ s, x: X(c) + (S - s[2]) / 2, y: Y(r) + S - s[3], z: Y(r) + S - 1 }); used.add(key(c, r));
    }
  }
  items.sort((a, b) => a.z - b.z);
  for (const it of items) x.drawImage(im, it.s[0], it.s[1], it.s[2], it.s[3], Math.round(it.x), Math.round(it.y), it.s[2], it.s[3]);
  if (th.tint) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = th.tint; x.fillRect(0, 0, cv.width, cv.height); x.globalCompositeOperation = 'source-over'; }
  return cv;
}
