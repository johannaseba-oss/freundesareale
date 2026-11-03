// Ausgrabung (public/config/dig.json): zufällige Erdschichten, darunter Fundstücke und Eisen. Jeder Schlag trägt Erde ab und schwächt die Stelle.
import { CFG, species } from '../config.js';
import { addCaught } from './actions.js';
import { dayKey } from '../time.js';

const D = () => CFG.dig;
const IRON = [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]]];
const between = ([a, b], rnd) => a + Math.floor(rnd() * (b - a + 1));
function pickItem(rnd) {
  const G = Object.entries(D().groups), tot = G.reduce((n, [, g]) => n + g.weight, 0);
  let r = rnd() * tot, group = G[0][0];
  for (const [k, g] of G) { if (r < g.weight) { group = k; break; } r -= g.weight; }
  // erst der Name, dann eine der Bildvarianten: mehrere Lagen desselben Fundstücks machen es nicht häufiger
  const list = D().items.filter((i) => i.group === group && (i.group !== 'fossil' || D().fossils[i.name]?.some((d) => species(d)) || combosOf(i.name).length > 0)), names = [...new Set(list.map((i) => i.name))];
  const name = names[Math.floor(rnd() * names.length)], same = list.filter((i) => i.name === name);
  return same[Math.floor(rnd() * same.length)];
}

// Fossil-Hälften: welche Kombinationen sind mit diesem Fossil möglich?
export const combosOf = (name) => (D().fossilCombos || []).filter((c) => (c.a === name || c.b === name) && species(c.dex));

export function newSite(rnd = Math.random) {
  const { cols, rows, layerHits: H } = D(), total = 3 * H;
  const cell = Array.from({ length: rows }, () => Array(cols).fill(total)), floor = Array.from({ length: rows }, () => Array(cols).fill(0));
  const used = new Set(), key = (x, y) => y * cols + x;
  const place = (w, h, cells) => {
    for (let tries = 0; tries < 80; tries++) {
      const x = Math.floor(rnd() * (cols - w + 1)), y = Math.floor(rnd() * (rows - h + 1));
      if (cells.some(([a, b]) => used.has(key(x + a, y + b)))) continue;
      cells.forEach(([a, b]) => used.add(key(x + a, y + b)));
      return { x, y };
    }
    return null;
  };
  const items = [];
  for (let n = between(D().itemCount, rnd); n > 0; n--) {
    const it = pickItem(rnd), at = place(it.w, it.h, it.cells);
    if (!at) continue;
    // unter welcher Schicht es liegt: dort ist für diese Felder Schluss mit Graben
    const chance = D().levelChance[it.group] || [1, 1, 1], sum = chance[0] + chance[1] + chance[2];
    let r = rnd() * sum, level = 0;
    while (level < 2 && r >= chance[level]) { r -= chance[level]; level++; }
    const depth = total - (level + 1) * H;
    it.cells.forEach(([a, b]) => { floor[at.y + b][at.x + a] = depth; });
    items.push({ it, ...at, depth, got: false });
  }
  const iron = new Set();
  for (let n = between(D().ironCount, rnd); n > 0; n--) {
    const shape = IRON[Math.floor(rnd() * IRON.length)], w = Math.max(...shape.map((c) => c[0])) + 1, h = Math.max(...shape.map((c) => c[1])) + 1, at = place(w, h, shape);
    if (at) shape.forEach(([a, b]) => { iron.add(key(at.x + a, at.y + b)); floor[at.y + b][at.x + a] = H; });
  }
  // Löcher: stellenweise fehlen schon Schichten; Fundstücke und Eisen bleiben dabei zugedeckt
  const keep = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (const e of items) for (let b = 0; b < e.it.h; b++) for (let a = 0; a < e.it.w; a++) keep[e.y + b][e.x + a] = Math.max(keep[e.y + b][e.x + a], e.depth + 1);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (iron.has(key(x, y))) keep[y][x] = Math.max(keep[y][x], H + 1);
  const H0 = D().holes;
  for (let n = between(H0.count, rnd); n > 0; n--) {
    const cx = rnd() * cols, cy = rnd() * rows, rad = H0.radius[0] + rnd() * (H0.radius[1] - H0.radius[0]), drop = H0.drop[Math.floor(rnd() * H0.drop.length)];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.hypot((x + 0.5 - cx) * (1 + rnd() * 0.25), y + 0.5 - cy) <= rad) cell[y][x] = Math.min(cell[y][x], Math.max(keep[y][x], total - drop));
  }
  return { cell, floor, items, iron, health: D().health, over: false };
}

export const isIron = (site, x, y) => site.iron.has(y * D().cols + x);
const revealed = (site, e) => e.it.cells.filter(([a, b]) => site.cell[e.y + b][e.x + a] <= e.depth).length / e.it.cells.length;

// Ein Schlag: trägt Erde ab, kostet Stabilität, meldet neue Funde. Auf bereits freier Erde passiert nichts.
export function strike(site, x, y, toolId) {
  const T = D().tools[toolId], { cols, rows } = D();
  if (site.over) return { noop: true };
  let removed = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const center = !dx && !dy;
    if (!center && dx && dy && !T.diagonal) continue;
    const take = Math.min(site.cell[ny][nx] - site.floor[ny][nx], center ? T.hit : T.side);
    site.cell[ny][nx] -= take; removed += take;
  }
  const iron = !removed && isIron(site, x, y);
  if (!removed && !iron) return { noop: true };
  site.health = Math.max(0, site.health - T.damage);
  const found = site.items.filter((e) => !e.got && revealed(site, e) >= (D().groups[e.it.group].revealShare ?? D().revealShare));
  found.forEach((e) => { e.got = true; e.gotAt = performance.now(); });
  const done = site.items.every((e) => e.got), collapsed = !done && site.health <= 0;
  site.over = done || collapsed;
  return { iron, found, done, collapsed };
}

// Am Ende einsammeln: alle freigelegten Fundstücke kommen ins Inventar (Schlüssel = Name, Bilder gibt es je Name mehrere)
export function claim(s, site) {
  s.dig ||= { sites: 0, found: 0 };
  s.dig.inventory ||= {};
  s.dig.sites++;
  const items = site.items.filter((e) => e.got).map((e) => e.it);
  for (const it of items) { s.dig.found++; s.dig.inventory[it.name] = (s.dig.inventory[it.name] || 0) + 1; }
  return { ok: true, items };
}
// Inventar zum Anzeigen: [{ it, count }]
export const inventory = (s) => Object.entries(s.dig?.inventory || {}).map(([name, count]) => ({ it: D().items.find((i) => i.name === name), count })).filter((e) => e.it).sort((a, b) => a.it.group.localeCompare(b.it.group) || a.it.name.localeCompare(b.it.name));

// Ausgrabungen pro Tag: jedes zufriedene Pokémon der passenden Typen gräbt einmal
const usedToday = (s, t) => { const u = s.dig?.used; return u?.day === dayKey(t) ? { n: u.n || 0, uids: u.uids || [] } : { n: 0, uids: [] }; };
const diggers = (s) => { const P = D().perDay; return s.pokemon.filter((p) => (p.satisfaction ?? 0) >= P.minSatisfaction && species(p.dex)?.types.some((x) => P.types.includes(x))); };
const freeDiggers = (s, t) => { const u = usedToday(s, t); return diggers(s).filter((p) => !u.uids.includes(p.uid)); };
export function digsLeft(s, t) { const u = usedToday(s, t); return Math.max(0, freeDiggers(s, t).length - (u.n - u.uids.length)); } // n ohne uids: Ausgrabungen aus älteren Spielständen
export const digsMax = (s, t) => digsLeft(s, t) + usedToday(s, t).n;
// wer als Nächstes gräbt (zufällig unter denen, die heute noch nicht gegraben haben)
export function nextDigger(s, t, rnd = Math.random) { const list = freeDiggers(s, t); return digsLeft(s, t) > 0 ? list[Math.floor(rnd() * list.length)] : null; }
export function useDig(s, t, uid) {
  if (digsLeft(s, t) <= 0 || !freeDiggers(s, t).some((p) => p.uid === uid)) return { ok: false, msg: 'Heute sind keine Ausgrabungen mehr möglich.' };
  s.dig ||= { sites: 0, found: 0 };
  const u = usedToday(s, t);
  s.dig.used = { day: dayKey(t), n: u.n + 1, uids: [...u.uids, uid] };
  return { ok: true };
}
// Fossil aus dem Inventar wiederbeleben
export const fossilOf = (name) => D().fossils[name] || null;
export function revive(s, t, name, rnd = Math.random) {
  const list = fossilOf(name)?.filter((d) => species(d));
  if (!list?.length || !(s.dig?.inventory?.[name] > 0) || s.coins < D().revive.cost) return { ok: false };
  s.coins -= D().revive.cost;
  if (!--s.dig.inventory[name]) delete s.dig.inventory[name];
  const p = addCaught(s, t, list[Math.floor(rnd() * list.length)], D().fossilBall, { fromFossil: true });
  return { ok: true, pokemon: p };
}
// Zwei Fossil-Hälften zusammensetzen
export function combine(s, t, combo) {
  const I = s.dig?.inventory || {};
  if (!(I[combo.a] > 0) || !(I[combo.b] > 0) || s.coins < D().revive.cost) return { ok: false };
  s.coins -= D().revive.cost;
  for (const n of [combo.a, combo.b]) if (!--I[n]) delete I[n];
  return { ok: true, pokemon: addCaught(s, t, combo.dex, D().fossilBall, { fromFossil: true }) };
}
