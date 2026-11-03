// Ausgrabung (public/config/dig.json): zufällige Erdschichten, darunter Fundstücke und Eisen. Jeder Schlag trägt Erde ab und schwächt die Stelle.
import { CFG, species } from '../config.js';
import { addCaught } from './actions.js';
import { staminaOf } from './contest.js';
import { dayKey } from '../time.js';

const D = () => CFG.dig;
const IRON = [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]]];
const between = ([a, b], rnd) => a + Math.floor(rnd() * (b - a + 1));
function pickItem(rnd) {
  const G = Object.entries(D().groups), tot = G.reduce((n, [, g]) => n + g.weight, 0);
  let r = rnd() * tot, group = G[0][0];
  for (const [k, g] of G) { if (r < g.weight) { group = k; break; } r -= g.weight; }
  // erst der Name, dann eine der Bildvarianten: mehrere Lagen desselben Fundstücks machen es nicht häufiger
  const list = D().items.filter((i) => i.group === group), names = [...new Set(list.map((i) => i.name))];
  const name = names[Math.floor(rnd() * names.length)], same = list.filter((i) => i.name === name);
  return same[Math.floor(rnd() * same.length)];
}

export function newSite(rnd = Math.random) {
  const { cols, rows, depth: [lo, hi] } = D(), mid = Math.round((lo + hi) / 2) - 1;
  const cell = Array.from({ length: rows }, () => Array(cols).fill(mid));
  // Flecken aus höheren und tieferen Schichten
  for (let n = 0; n < D().patches; n++) {
    const cx = rnd() * cols, cy = rnd() * rows, rad = 1.5 + rnd() * 2.5, add = rnd() < 0.5 ? -1 - Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 3);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.hypot(x - cx, y - cy) <= rad) cell[y][x] = Math.max(lo, Math.min(hi, cell[y][x] + add));
  }
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
    if (at) items.push({ it, ...at, got: false });
  }
  const iron = new Set();
  for (let n = between(D().ironCount, rnd); n > 0; n--) {
    const shape = IRON[Math.floor(rnd() * IRON.length)], w = Math.max(...shape.map((c) => c[0])) + 1, h = Math.max(...shape.map((c) => c[1])) + 1, at = place(w, h, shape);
    if (at) shape.forEach(([a, b]) => iron.add(key(at.x + a, at.y + b)));
  }
  return { cell, items, iron, health: D().health, over: false };
}

export const isIron = (site, x, y) => site.iron.has(y * D().cols + x);
const revealed = (site, e) => e.it.cells.filter(([a, b]) => site.cell[e.y + b][e.x + a] === 0).length / e.it.cells.length;

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
    const take = Math.min(site.cell[ny][nx], center ? T.hit : T.side);
    site.cell[ny][nx] -= take; removed += take;
  }
  const iron = !removed && isIron(site, x, y);
  if (!removed && !iron) return { noop: true };
  site.health = Math.max(0, site.health - T.damage);
  const found = site.items.filter((e) => !e.got && revealed(site, e) >= D().revealShare);
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

// Ausgrabungen pro Tag: je zufriedenem Pokémon der passenden Typen eine
export function digsMax(s) {
  const P = D().perDay;
  return s.pokemon.filter((p) => (p.satisfaction ?? 0) >= P.minSatisfaction && species(p.dex)?.types.some((t) => P.types.includes(t))).length;
}
export const digsLeft = (s, t) => Math.max(0, digsMax(s) - (s.dig?.used?.day === dayKey(t) ? s.dig.used.n : 0));
export function useDig(s, t) {
  if (digsLeft(s, t) <= 0) return { ok: false, msg: 'Heute sind keine Ausgrabungen mehr möglich.' };
  s.dig ||= { sites: 0, found: 0 };
  const d = dayKey(t);
  s.dig.used = { day: d, n: (s.dig.used?.day === d ? s.dig.used.n : 0) + 1 };
  return { ok: true };
}
// Fossil aus dem Inventar wiederbeleben
export const fossilOf = (name) => D().fossils[name] || null;
export function revive(s, t, name, rnd = Math.random) {
  const list = fossilOf(name)?.filter((d) => species(d));
  if (!list?.length || !(s.dig?.inventory?.[name] > 0)) return { ok: false };
  if (!--s.dig.inventory[name]) delete s.dig.inventory[name];
  const p = addCaught(s, t, list[Math.floor(rnd() * list.length)], D().fossilBall, { fromFossil: true });
  return { ok: true, pokemon: p };
}

// Fossil-Pokémon entwickeln sich dauerhaft beim Erreichen ihres Levels; liefert die Entwicklungen zum Anzeigen
export function levelEvolutions(s) {
  const out = [];
  for (const p of s.pokemon) {
    const e = D().levelEvolutions[p.dex];
    if (!e || p.level < e.level || !species(e.to)) continue;
    out.push({ p, from: p.dex, to: e.to });
    p.dex = e.to;
    p.stamina = staminaOf(p.dex);
    if (!s.dexOwned.includes(p.dex)) s.dexOwned.push(p.dex);
  }
  return out;
}
