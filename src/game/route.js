// Route: klassisches Tower Defense mit fester Strecke. Wilde Pokémon laufen die Route eines Levels ab,
// eigene Pokémon stehen auf festen Bauplätzen und greifen je nach Angriffsform an:
// adjacent (direkt angrenzend), line (ganze gerade Strecke in Blickrichtung), circle (Radius), cross (Kreuz).
// Besiegte Gegner bringen EP; damit steigen die eigenen Pokémon dauerhaft im Level (siehe actions.trainLevel).
import { CFG, species } from '../config.js';
import { effectiveness } from './types.js';
import { calcStats, bdata, moveOf, rollIvs } from './battle.js';
import { mulberry32 } from '../rng.js';
import { pickFamilies } from './defense.js';

const R = () => CFG.route;
const refSpeed = (level) => Math.floor(((2 * 80 + 15) * level) / 100) + 5;
export const routeLevels = () => CFG.routeLevels.levels;

export const isWaterMon = (dex) => species(dex).types.includes('Wasser');
// Angriffsform einer Art: Wasser-Pokémon = Ring, Körperkontakt = adjacent, sonst nach Attacken-Typ, sonst circle
export function shapeOf(dex) {
  if (isWaterMon(dex)) return 'ring';
  const mv = moveOf(bdata(dex).move);
  if (mv?.range === 'nah') return 'adjacent';
  return R().shapes.byType[mv?.type] || 'circle';
}
export const shapeInfo = (dex) => R().shapes[shapeOf(dex)];
// Radius (nur kreisrunde Reichweite wächst mit dem Level)
export function radiusOf(level) {
  const C = R().shapes.circle;
  return Math.min(C.radiusMax, C.radius + C.radiusPerLevel * (level - 1));
}
// äußerer Rand der Ring-Welle (wächst mit dem Level wie der Radius)
export function ringOuter(level) {
  const C = R().shapes.ring;
  return Math.min(C.outerMax, C.outer + C.outerPerLevel * (level - 1));
}
// Tempo-Faktor durch das Level
export const levelSpeed = (level) => Math.min(R().levelEffect.speedMax, 1 + R().levelEffect.speedPerLevel * (level - 1));
// so viele Pokémon dürfen gleichzeitig aufs Feld
export const maxUnits = (cleared) => Math.min(R().maxUnits.max, R().maxUnits.start + Math.floor(cleared / R().maxUnits.perCleared));
// Kosten für das nächste Level
export const upgradeCost = (level) => Math.round(R().upgrade.base * Math.pow(level, R().upgrade.exp));

// Zellen der Route (ohne Eingang/Ausgang außerhalb des Rasters)
export function pathCells(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    for (let x = x0, y = y0; x !== x1 || y !== y1; x += dx, y += dy) out.push([x, y]);
  }
  out.push(pts[pts.length - 1]);
  const G = R().grid;
  return out.filter(([x, y]) => x >= 0 && x < G.cols && y >= 0 && y < G.rows);
}

export class Route {
  // level: Eintrag aus route_levels.json; team: [{uid, dex, ivs, evs, level, nick, gender}]
  constructor({ level, team, cleared = 0, seed = Date.now() }) {
    this.rnd = mulberry32(seed >>> 0);
    this.level = level;
    this.team = team;
    this.max = maxUnits(cleared);
    this.t = 0;
    this.started = false;
    this.lives = R().lives;
    this.ep = 0;
    this.units = [];
    this.enemies = [];
    this.shots = [];
    this.queue = [];
    this.events = [];
    this.over = null;
    this.wave = -1;
    this.nextWaveAt = R().waves.firstDelay;
    this.nextId = 1;
    this.families = pickFamilies(level, mulberry32(level.n * 7919));
    // Route als Polylinie durch die Zellmitten
    this.pts = level.path.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
    this.seg = [];
    let L = 0;
    for (let i = 0; i < this.pts.length - 1; i++) { const a = this.pts[i], b = this.pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y); this.seg.push({ a, b, len, from: L }); L += len; }
    this.length = L;
    this.onPath = new Set(pathCells(level.path).map(([x, y]) => x + ',' + y));
  }
  // Position und Laufrichtung bei Strecke s
  posAt(s) {
    const sg = this.seg.find((q) => s <= q.from + q.len) || this.seg[this.seg.length - 1];
    const k = Math.max(0, Math.min(1, (s - sg.from) / sg.len));
    return { x: sg.a.x + (sg.b.x - sg.a.x) * k, y: sg.a.y + (sg.b.y - sg.a.y) * k, dx: Math.sign(sg.b.x - sg.a.x), dy: Math.sign(sg.b.y - sg.a.y) };
  }

  // ---- Platzieren ----
  slotFree(i) { return !this.units.some((u) => u.slot === i); }
  isWaterSlot(i) { return this.level.slots[i]?.[2] === 'w'; }
  // Seerosen im Teich nur für Wasser-Pokémon
  slotAllows(i, dex) { return !this.isWaterSlot(i) || isWaterMon(dex); }
  placed(uid) { return this.units.find((u) => u.uid === uid) || null; }
  place(uid, slot) {
    const m = this.team.find((x) => x.uid === uid);
    if (!m || this.over || !this.slotFree(slot) || !this.slotAllows(slot, m.dex) || this.placed(uid) || this.units.length >= this.max) return false;
    const [c, r] = this.level.slots[slot];
    const u = { id: this.nextId++, uid, dex: m.dex, gender: m.gender, nick: m.nick, ivs: m.ivs, evs: m.evs, level: m.level, slot, x: c + 0.5, y: r + 0.5, shape: shapeOf(m.dex), cd: 0.6, placedAt: this.t };
    u.face = this.bestFacing(u);
    this.restat(u);
    this.units.push(u);
    this.events.push({ type: 'place', u });
    return true;
  }
  unplace(u) {
    const i = this.units.indexOf(u);
    if (i < 0 || this.over) return false;
    this.units.splice(i, 1);
    this.events.push({ type: 'remove', u });
    return true;
  }
  restat(u) { u.stats = calcStats(u.dex, u.level, u.ivs, u.evs); }
  // Level-Aufstieg mitten in der Runde (dauerhaft im Spielstand, siehe UI)
  levelUp(u) { u.level++; this.restat(u); const m = this.team.find((x) => x.uid === u.uid); if (m) m.level = u.level; this.events.push({ type: 'level', u }); }
  // Gerade: Blickrichtung mit den meisten Routenfeldern bis zum Rand
  bestFacing(u) {
    const G = R().grid, c = Math.floor(u.x), r = Math.floor(u.y);
    let best = [0, -1], bn = -1;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      let n = 0;
      for (let x = c + dx, y = r + dy; x >= 0 && x < G.cols && y >= 0 && y < G.rows; x += dx, y += dy) if (this.onPath.has(x + ',' + y)) n++;
      if (n > bn) { bn = n; best = [dx, dy]; }
    }
    return best;
  }
  // Felder, die ein Pokémon trifft (für Vorschau und Zielwahl)
  inReach(u, e) {
    const dx = e.x - u.x, dy = e.y - u.y;
    switch (u.shape) {
      case 'adjacent': return Math.max(Math.abs(dx), Math.abs(dy)) <= 1.5;
      case 'line': { const fwd = dx * u.face[0] + dy * u.face[1], lat = Math.abs(dx * u.face[1] - dy * u.face[0]); return fwd > 0.3 && lat < 0.55; }
      case 'ring': { const d = Math.hypot(dx, dy); return d >= R().shapes.ring.inner && d <= ringOuter(u.level); }
      case 'cross': { const a = R().shapes.cross.arm + 0.5; return (Math.abs(dx) < 0.55 && Math.abs(dy) <= a) || (Math.abs(dy) < 0.55 && Math.abs(dx) <= a); }
      default: return Math.hypot(dx, dy) <= radiusOf(u.level);
    }
  }

  // ---- Wellen ----
  startWave() {
    this.wave++;
    const W = R().waves, last = this.wave === this.level.waves - 1;
    const level = this.level.enemyLevel + this.wave * R().enemy.levelPerWave;
    const p = this.level.waves > 1 ? this.wave / (this.level.waves - 1) : 1;
    const count = Math.round((W.base + this.wave * W.perWave) * this.level.countMult);
    for (let i = 0; i < count; i++) this.queue.push({ at: this.t + (i / count) * W.spread + this.rnd() * 1.2, dex: this.rollEnemy(p), level });
    if (last) { // Boss: Endform einer Familie, deutlich stärker
      const strong = this.families.map((f) => f[f.length - 1]);
      this.queue.push({ at: this.t + W.spread * 0.6, dex: strong[Math.floor(this.rnd() * strong.length)], level: level + W.boss.levelPlus, boss: true });
    }
    this.queue.sort((a, b) => a.at - b.at);
    this.events.push({ type: 'wave', wave: this.wave, last });
  }
  rollEnemy(p) {
    const weights = [Math.max(0.05, 1 - p * 0.9), 0.12 + p * 0.9, this.level.finalStage >= 3 ? Math.max(0, (p - 0.4) * 1.6) : 0];
    let r = this.rnd() * weights.reduce((a, b) => a + b, 0), stage = 1;
    for (let k = 0; k < 3; k++) { if ((r -= weights[k]) < 0) { stage = k + 1; break; } }
    const fam = this.families[Math.floor(this.rnd() * this.families.length)];
    return fam[Math.min(stage, fam.length) - 1];
  }
  spawn(q) {
    const E = R().enemy, st = calcStats(q.dex, q.level, rollIvs('r' + this.nextId, [0, 31]), [0, 0, 0, 0, 0, 0]);
    const v = E.speedVariation;
    const e = { id: this.nextId++, dex: q.dex, level: q.level, stats: st, maxHp: st[0] * E.hpMult * (q.boss ? R().waves.boss.hpMult : 1), s: -0.6, boss: !!q.boss, pace: v[0] + this.rnd() * (v[1] - v[0]) };
    e.hp = e.maxHp;
    Object.assign(e, this.posAt(0));
    this.enemies.push(e);
    if (q.boss) this.events.push({ type: 'boss', e });
  }

  // ---- Schaden (offizielle Formel: physisch gegen Verteidigung, speziell gegen Spezial-Verteidigung) ----
  damage(u, e, mult) {
    const mv = moveOf(bdata(u.dex).move), phys = mv.cat === 'phys';
    const A = u.stats[phys ? 1 : 3], Dv = e.stats[phys ? 2 : 4];
    const stab = species(u.dex).types.includes(mv.type) ? 1.5 : 1, eff = effectiveness(mv.type, species(e.dex).types);
    const base = (Math.floor((2 * u.level) / 5 + 2) * (mv.power || 40) * A / Dv) / 50 + 2;
    const crit = eff > 0 && this.rnd() < R().crit.chance;
    return { dmg: eff ? Math.max(1, Math.round(base * stab * eff * mult * (crit ? R().crit.mult : 1) * (0.9 + this.rnd() * 0.1))) : 0, eff, mv, crit };
  }
  hit(u, e, mult) {
    if (e.hp <= 0) return;
    const r = this.damage(u, e, mult);
    e.hp -= r.dmg; e.hurtT = this.t;
    this.events.push({ type: 'hit', e, dmg: r.dmg, eff: r.eff, crit: r.crit, move: r.mv });
    const S = R().status?.byType?.[r.mv.type];
    if (S && r.dmg > 0 && e.hp > 0 && this.rnd() < S.chance) this.applyStatus(e, S, u);
    if (e.hp <= 0) this.defeat(e);
  }

  // Statuseffekte: Verbrennung/Gift (Schaden über Zeit), Paralyse und Schlaf (steht still), Verlangsamung
  applyStatus(e, S, u) {
    const until = this.t + S.seconds;
    if (S.kind === 'burn' || S.kind === 'poison') (e.dots ||= {})[S.kind] = { until, dps: e.maxHp * S.pctPerSecond, from: u, tick: 0 };
    else if (S.kind === 'paralysis') e.stunUntil = Math.max(e.stunUntil || 0, until);
    else if (S.kind === 'sleep') e.sleepUntil = Math.max(e.sleepUntil || 0, until);
    else if (S.kind === 'slow') { e.slowUntil = until; e.slowFactor = Math.min(e.slowUntil > this.t ? e.slowFactor || 1 : 1, S.factor); }
    this.events.push({ type: 'status', e, kind: S.kind, name: S.name });
  }
  defeat(e) {
    const P = R().ep, lucky = P.bonus?.[e.dex] || 1; // EP-Glückspokémon (z. B. Chaneira) geben ein Vielfaches
    const ep = Math.round((P.perEnemy + e.level * P.perEnemyLevel) * lucky) + (e.boss ? P.boss : 0);
    this.ep += ep;
    this.events.push({ type: 'defeat', e, ep, lucky: lucky > 1 });
  }

  // ---- Simulation ----
  update(dt) {
    if (!this.started || this.over) return;
    this.t += dt;
    const W = R().waves, E = R().enemy;
    if (this.wave < this.level.waves - 1 && this.t >= this.nextWaveAt && !this.queue.length) {
      this.startWave();
      this.nextWaveAt = this.t + W.spread + W.gap;
    }
    while (this.queue.length && this.queue[0].at <= this.t) this.spawn(this.queue.shift());
    // Gegner laufen die Route entlang
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      for (const [kind, d] of Object.entries(e.dots || {})) { // Verbrennung, Gift
        if (this.t >= d.until) { delete e.dots[kind]; continue; }
        const dmg = d.dps * dt; e.hp -= dmg; d.tick += dmg;
        if (d.tick >= Math.max(1, d.dps * 0.5)) { this.events.push({ type: 'dot', e, kind, dmg: Math.round(d.tick) }); d.tick = 0; }
        if (e.hp <= 0) { e.hurtT = this.t; this.defeat(e); break; }
      }
      if (e.hp <= 0) continue;
      if (this.t < (e.stunUntil || 0) || this.t < (e.sleepUntil || 0)) continue; // Paralyse/Schlaf: steht still
      const slow = this.t < (e.slowUntil || 0) ? e.slowFactor || 1 : 1;
      e.s += E.tilesPerSecond * e.pace * slow * Math.pow(e.stats[5] / refSpeed(e.level), E.speedExp) * (e.boss ? 0.75 : 1) * dt;
      Object.assign(e, this.posAt(Math.max(0, e.s)));
      if (e.s >= this.length) { e.hp = 0; e.leaked = true; this.lives--; this.events.push({ type: 'leak', e }); if (this.lives <= 0) { this.over = { won: false }; return; } }
    }
    // eigene Pokémon greifen an: Ziel = der Gegner, der am weitesten gekommen ist
    for (const u of this.units) {
      u.cd -= dt;
      if (u.cd > 0) continue;
      const inRange = this.enemies.filter((e) => e.hp > 0 && e.s >= 0 && this.inReach(u, e));
      if (!inRange.length) continue;
      const S = R().shapes[u.shape], spd = Math.max(0.75, Math.min(1.3, Math.pow(u.stats[5] / refSpeed(u.level), 0.3)));
      u.cd = S.cooldown / (levelSpeed(u.level) * spd);
      u.anim = { name: u.shape === 'adjacent' ? 'Attack' : 'Shoot', t0: this.t };
      const lead = inRange.reduce((a, b) => (b.s > a.s ? b : a));
      if (u.shape === 'line' || u.shape === 'cross' || u.shape === 'circle' || u.shape === 'ring') {
        // Gerade: ganze Strecke; Kreuz: alle vier Arme gleichzeitig; Radius: Welle, die alle im Kreis trifft
        for (const e of inRange) this.hit(u, e, S.mult);
        this.events.push({ type: 'attack', u, shape: u.shape, target: lead });
      } else { this.hit(u, lead, S.mult); this.events.push({ type: 'attack', u, shape: u.shape, target: lead }); }
    }
    this.shots = this.shots.filter((p) => {
      const e = p.target, d = Math.hypot(e.x - p.x, e.y - p.y);
      if (e.hp <= 0) return false;
      if (d < 0.3) { this.hit(p.u, e, R().shapes.circle.mult); return false; }
      p.x += ((e.x - p.x) / d) * 9 * dt; p.y += ((e.y - p.y) / d) * 9 * dt;
      return true;
    });
    this.enemies = this.enemies.filter((e) => e.hp > 0 || this.t - (e.hurtT || 0) < 0.5);
    if (this.wave === this.level.waves - 1 && !this.queue.length && !this.enemies.some((e) => e.hp > 0)) this.over = { won: true };
  }
  progress() { return { wave: Math.max(0, this.wave + 1), total: this.level.waves }; }
}

// Empfohlenes Team: verschiedene Angriffsformen, dann die stärksten gegen die Gegner-Typen
export function recommendRouteTeam(mons, theme, N) {
  const power = (p) => { const mv = moveOf(bdata(p.dex).move); const eff = Math.max(...theme.map((t) => effectiveness(mv.type, [t]))); return eff * (mv.power || 40) * (1 + (p.level || 1) / 30); };
  const sorted = [...mons].sort((a, b) => power(b) - power(a));
  const out = [], shapes = new Set(), seen = new Set();
  for (const p of sorted) if (out.length < N && !shapes.has(shapeOf(p.dex)) && !seen.has(p.dex)) { out.push(p); shapes.add(shapeOf(p.dex)); seen.add(p.dex); }
  for (const p of sorted) if (out.length < N && !seen.has(p.dex)) { out.push(p); seen.add(p.dex); }
  return out.map((p) => p.uid);
}
