// Spaziergang (wie bei Nintendogs): Zufallskarte, eingezeichnete Route (Zuhause → … → Zuhause), umherwandernde wilde Pokémon
// und klassische Rundenkämpfe mit 4 Attacken, die Münzen kosten. Werte in walk.json.
import { CFG, species } from '../config.js';
import { bdata, moveOf, calcStats, damageOf } from './battle.js';
import { effectiveness } from './types.js';
import { speedOf } from './rocks.js';
import { dayKey } from '../time.js';

const W = () => CFG.walk;
const between = (rnd, [a, b]) => a + rnd() * (b - a);
const ibetween = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1));

export const maxSteps = (p) => W().stepsByStamina[(p.stamina || 1) - 1];
export const walkSpeed = (p) => W().speedBySpeed[speedOf(p).level - 1];
export const walkedToday = (s, uid, t) => (s.walk?.done?.[uid] || []).filter((d) => d === dayKey(t)).length >= W().walksPerDay;

// ---- Karte: 'F' Wiese, 'W' Bäume, 'A' Wasser ----
export function makeMap(rnd) {
  const { cols, rows } = W().grid, M = W().map;
  const g = Array.from({ length: rows }, () => Array(cols).fill('F'));
  const home = [Math.floor(cols / 2), rows - 2];
  const nearHome = (x, y) => Math.abs(x - home[0]) <= 1 && Math.abs(y - home[1]) <= 1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) g[y][x] = 'W';
  const blob = (kind, size) => {
    let x = 2 + Math.floor(rnd() * (cols - 4)), y = 2 + Math.floor(rnd() * (rows - 5));
    for (let i = 0; i < size; i++) {
      for (const [dx, dy] of kind === 'A' ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx > 0 && ny > 0 && nx < cols - 1 && ny < rows - 1 && !nearHome(nx, ny)) g[ny][nx] = kind;
      }
      const d = Math.floor(rnd() * 4); x += [1, -1, 0, 0][d]; y += [0, 0, 1, -1][d];
      x = Math.max(1, Math.min(cols - 2, x)); y = Math.max(1, Math.min(rows - 3, y));
    }
  };
  for (let i = ibetween(rnd, M.ponds); i > 0; i--) blob('A', ibetween(rnd, [2, 4]));
  for (let i = ibetween(rnd, M.treeBlobs); i > 0; i--) blob('W', ibetween(rnd, M.blobSize));
  // nicht erreichbare Wiese wird zu Wald
  const seen = new Set([home.join()]), q = [home];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (g[ny]?.[nx] === 'F' && !seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (g[y][x] === 'F' && !seen.has(x + ',' + y)) g[y][x] = 'W';
  return { cols, rows, g, home, theme: M.themes[Math.floor(rnd() * M.themes.length)], free: [...seen].map((k) => k.split(',').map(Number)) };
}
export const walkable = (map, x, y) => map.g[y]?.[x] === 'F';

// ---- Attacken: Signatur-Attacke + passende weitere, je nach stärkerem Angriffswert physisch oder speziell ----
export function walkMoves(dex) {
  const b = bdata(dex), sp = species(dex), phys = b.base[1] >= b.base[3];
  const all = Object.entries(CFG.battleData.moves).filter(([, m]) => m.power > 0);
  const out = [b.move];
  const pick = (type, target) => {
    const c = all.filter(([k, m]) => m.type === type && !out.includes(k)).sort((x, y) => (x[1].cat === (phys ? 'phys' : 'spez') ? 0 : 30) + Math.abs(x[1].power - target) - ((y[1].cat === (phys ? 'phys' : 'spez') ? 0 : 30) + Math.abs(y[1].power - target)));
    if (c[0]) out.push(c[0][0]);
  };
  pick('Normal', 40); // günstige Grundattacke
  for (const t of sp.types) if (out.length < 4) pick(t, out.length === 2 ? 65 : 95);
  while (out.length < 4) pick(out.length === 3 ? sp.types[0] : 'Normal', out.length === 3 ? 110 : 70);
  return out.slice(0, 4).sort((x, y) => moveOf(x).power - moveOf(y).power);
}
export const moveCost = (key) => Math.max(W().battle.minCost, Math.round(moveOf(key).power ** 2 / W().battle.coinDiv));

// Kämpfer für den Rundenkampf
export function makeFighter(src, level) {
  const stats = calcStats(src.dex, level, src.ivs || [15, 15, 15, 15, 15, 15], src.evs || [0, 0, 0, 0, 0, 0]);
  return { uid: src.uid ?? null, dex: src.dex, gender: src.gender ?? null, nick: src.nick || null, level, stats, hp: stats[0], maxHp: stats[0], moves: walkMoves(src.dex), pbuff: src.pbuff || 1 };
}

// ---- wilde Pokémon ----
export function wildPool(theme, level = 1) {
  const types = W().wild.themeTypes[theme] || [], MS = W().wild.maxStage || {};
  const stage = Math.max(1, ...Object.entries(MS).filter(([k]) => k[0] !== '_' && level >= +k).map(([, v]) => v));
  const ok = CFG.dex.filter((s) => s.rarity !== 'legendaer' && bdata(s.dex) && (s.stage || 1) <= stage);
  const fit = ok.filter((s) => s.types.some((t) => types.includes(t)));
  return (fit.length ? fit : ok).map((s) => s.dex);
}
export function spawnWild(map, rnd, playerLevel, avoid = []) {
  const out = [], n = ibetween(rnd, W().wild.count);
  const far = map.free.filter(([x, y]) => Math.abs(x - map.home[0]) + Math.abs(y - map.home[1]) > 5);
  for (let i = 0; i < n && far.length; i++) {
    const [x, y] = far.splice(Math.floor(rnd() * far.length), 1)[0];
    const level = Math.max(W().wild.minLevel, playerLevel + ibetween(rnd, W().wild.levelOffset));
    const pool = wildPool(map.theme, level), dex = pool[Math.floor(rnd() * pool.length)];
    out.push({ id: i + 1, dex, level, cx: x, cy: y, x, y, fx: x, fy: y, k: 1, next: between(rnd, W().wild.stepEvery), dir: 0, ignore: 0, gone: false });
  }
  return out;
}
// ein Schritt der wilden Pokémon: zufälliges freies Nachbarfeld, weich überblendet
export function moveWild(map, wild, dt, rnd) {
  for (const w of wild) {
    if (w.gone) continue;
    w.next -= dt;
    if (w.k < 1) { w.k = Math.min(1, w.k + dt * 2.2); w.x = w.fx + (w.cx - w.fx) * w.k; w.y = w.fy + (w.cy - w.fy) * w.k; }
    if (w.next > 0 || w.k < 1) continue;
    w.next = between(rnd, W().wild.stepEvery);
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => walkable(map, w.cx + dx, w.cy + dy) && !(w.cx + dx === map.home[0] && w.cy + dy === map.home[1]));
    if (!opts.length) continue;
    const [dx, dy] = opts[Math.floor(rnd() * opts.length)];
    w.fx = w.cx; w.fy = w.cy; w.cx += dx; w.cy += dy; w.k = 0;
    w.dir = dx > 0 ? 2 : dx < 0 ? 6 : dy > 0 ? 0 : 4;
  }
}

// ---- Rundenkampf ----
// eine Runde: Spieler wählt Attacke (Index) oder 'flee'; liefert die Schritte für die Anzeige
export function battleTurn(me, foe, choice, rnd) {
  const steps = [];
  const attack = (a, d, key, who) => {
    const mv = moveOf(key);
    steps.push({ who, text: `${nameOf(a, who)} setzt ${mv.name} ein!`, key });
    if (rnd() * 100 >= (mv.acc || 100)) { steps.push({ who, text: 'Daneben!' }); return; }
    const r = damageOf(a, d, mv, rnd);
    d.hp = Math.max(0, d.hp - r.dmg);
    steps.push({ who, hit: who === 'p' ? 'w' : 'p', dmg: r.dmg, eff: r.eff, hp: d.hp, text: r.eff === 0 ? 'Das hat keine Wirkung …' : r.eff > 1 ? 'Das ist sehr effektiv!' : r.eff < 1 ? 'Das ist nicht sehr effektiv …' : null });
    if (d.hp <= 0) steps.push({ who, faint: who === 'p' ? 'w' : 'p', text: `${nameOf(d, who === 'p' ? 'w' : 'p')} wurde besiegt!` });
  };
  const foeMove = foe.moves[Math.floor(rnd() * foe.moves.length)];
  if (choice === 'flee') {
    const B = W().battle, ch = Math.max(B.fleeMin, Math.min(B.fleeMax, B.fleeBase + (me.stats[5] / foe.stats[5] - 1) * B.fleeSpeed));
    if (rnd() < ch) { steps.push({ fled: true, text: 'Du bist entkommen!' }); return steps; }
    steps.push({ text: 'Flucht gescheitert!' });
    attack(foe, me, foeMove, 'w');
    return steps;
  }
  const key = me.moves[choice];
  const meFirst = me.stats[5] > foe.stats[5] || (me.stats[5] === foe.stats[5] && rnd() < 0.5);
  const order = meFirst ? [[me, foe, key, 'p'], [foe, me, foeMove, 'w']] : [[foe, me, foeMove, 'w'], [me, foe, key, 'p']];
  for (const [a, d, k, who] of order) { if (a.hp <= 0 || d.hp <= 0) break; attack(a, d, k, who); }
  return steps;
}
const nameOf = (f, who) => (who === 'w' ? 'Das wilde ' : '') + (f.nick || species(f.dex).name);
export { effectiveness };

// ---- Belohnungen im Spielstand ----
export function walkWin(s, uid, foe) {
  const R = W().rewards, p = s.pokemon.find((x) => x.uid === uid);
  const ep = Math.round(R.epPerWin + foe.level * R.epPerLevel);
  s.route ||= { ep: 0, cleared: 0 }; s.route.ep += ep;
  const gained = [0, 0, 0, 0, 0, 0];
  if (p) {
    const S = CFG.battle.stats; p.evs ||= [0, 0, 0, 0, 0, 0];
    bdata(foe.dex).ev.forEach((v, i) => {
      const total = p.evs.reduce((a, b) => a + b, 0);
      const add = Math.max(0, Math.min(Math.round(v * R.evMult), S.evMaxStat - p.evs[i], S.evMaxTotal - total));
      p.evs[i] += add; gained[i] = add;
    });
  }
  return { ok: true, ep, gained };
}
export function walkDone(s, uid, steps, home, t) {
  const d = dayKey(t);
  s.walk ||= { done: {} };
  s.walk.done[uid] = [...(s.walk.done[uid] || []).filter((x) => x === d), d];
  for (const [k, v] of Object.entries(s.walk.done)) if (!v.includes(d)) delete s.walk.done[k];
  const ep = home ? Math.round(steps * W().rewards.epPerStep) : 0;
  s.route ||= { ep: 0, cleared: 0 }; s.route.ep += ep;
  return { ok: true, ep };
}
export function payMove(s, key) {
  const c = moveCost(key);
  if (s.coins < c) return { ok: false, msg: `Zu wenig Münzen (${c} nötig).` };
  s.coins -= c;
  return { ok: true, cost: c };
}
