// Kampfmodus: Echtzeit-Kampf auf dem Spielfeld (Spieler unten, Gegner oben).
// Gekämpft wird ausschließlich mit Kampfversionen ("Fighter"): Sie starten auf Level 5, sammeln EP, steigen auf und
// entwickeln sich – aber nur bis zum Kampfende. Das gespeicherte Pokémon (Art, Level) wird nie verändert;
// einzig die EVs aus besiegten Gegnern werden am Ende übernommen (battle.json stats.evsPersist).
import { CFG, species } from '../config.js';
import { effectiveness } from './types.js';
import { hashString, mulberry32 } from '../rng.js';

const B = () => CFG.battle;
const C = () => CFG.battle.combat;
export const bdata = (dex) => CFG.battleData.pokemon[dex];
export const moveOf = (key) => CFG.battleData.moves[key];
export const stoneName = (key) => CFG.battleData.stones[key]?.name || key;
export const STAT_NAMES = ['KP', 'Ang', 'Vert', 'SpAng', 'SpVert', 'Init'];
export const canBattle = (dex) => !!bdata(dex);

// IVs: 0–31 je Wert, fest an das Pokémon gebunden
export const rollIvs = (seed, range = [0, CFG.battle.stats.ivMax]) =>
  [0, 1, 2, 3, 4, 5].map((i) => range[0] + (hashString(seed + '|iv' + i) % (range[1] - range[0] + 1)));

// Offizielle Wertformel (ohne Wesen)
export function calcStats(dex, level, ivs, evs) {
  return bdata(dex).base.map((b, i) => {
    const core = Math.floor(((2 * b + ivs[i] + Math.floor(evs[i] / 4)) * level) / 100);
    return i === 0 ? core + level + 10 : core + 5;
  });
}
// EP-Bedarf je Level (offizielle Tabelle bis 100; darüber kubisch fortgesetzt – kein Level-Limit)
export const expForLevel = (dex, level) => { const g = CFG.battleData.growth[bdata(dex).growth]; return level <= 100 ? g[level] : Math.round(g[100] * Math.pow(level / 100, 3)); };
// Vergleichswert für Tempo/Angriffspause: ein Pokémon mit Basiswert referenceBaseStat auf demselben Level
const refStat = (level) => Math.floor(((2 * C().referenceBaseStat + 15) * level) / 100) + 5;

// Fähigkeit eines Verteidigers je nach Art
export function towerRole(dex) {
  const ov = B().towerRoleOverrides?.[dex];
  if (ov) return ov;
  const roles = Object.entries(B().towerRoles).filter(([k]) => k[0] !== '_');
  for (const t of species(dex).types) for (const [id, r] of roles) if (r.types?.includes(t)) return id;
  return 'fernkampf';
}

// Attacken eines Kämpfers: die Signatur-Attacke seiner (aktuellen) Art + später im Shop gekaufte
export const movesOf = (f) => [bdata(f.dex).move, ...(f.extraMoves || [])].filter((k, i, a) => moveOf(k) && a.indexOf(k) === i);

let nextId = 1;
// src: { uid?, dex, gender, ivs, evs, moves }
export function makeFighter(src, side) {
  const f = {
    id: nextId++, side, uid: src.uid ?? null, nick: src.nick || null, dex: src.dex, origDex: src.dex, gender: src.gender ?? null,
    ivs: src.ivs, evs: [...src.evs], evGain: [0, 0, 0, 0, 0, 0], extraMoves: src.moves || [],
    level: B().startLevel, tower: !!src.tower, state: 'deck', x: 0, y: 0, dir: side === 'p' ? 4 : 0, cd: 0, anim: null, kos: 0,
  };
  f.exp = expForLevel(f.dex, f.level);
  recalc(f, true);
  return f;
}
function recalc(f, full = false) {
  const oldMax = f.maxHp;
  f.stats = calcStats(f.dex, f.level, f.ivs, f.evs);
  f.maxHp = f.stats[0] * (f.tower ? B().tower.hpMultiplier : 1);
  f.hp = full || oldMax == null ? f.maxHp : Math.max(1, Math.min(f.maxHp, f.hp + (f.maxHp - oldMax)));
}

export function damageOf(att, def, mv, rnd, atkMult = 1, defMult = 1) {
  const phys = mv.cat === 'phys';
  const A = att.stats[phys ? 1 : 3] * atkMult, D = def.stats[phys ? 2 : 4] * defMult;
  // Offizielle Formel, aber das ganze Ergebnis (inkl. Grundschaden +2) skaliert mit (Ang/Vert)^defenseExponent,
  // damit Verteidigung schon auf niedrigen Leveln spürbar zählt
  const ratio = Math.pow(A / D, C().defenseExponent ?? 1);
  const base = (Math.floor((2 * att.level) / 5 + 2) * mv.power / 50 + 2) * ratio * (att.tower ? B().tower.damageMultiplier ?? 1 : 1);
  const stab = species(att.dex).types.includes(mv.type) ? C().stab : 1;
  const eff = effectiveness(mv.type, species(def.dex).types);
  const [r0, r1] = C().damageRandom;
  return { dmg: eff ? Math.max(1, Math.floor(base * stab * eff * (r0 + rnd() * (r1 - r0)))) : 0, eff };
}

// Offizielle EP-Formel (5. Generation), beschleunigt durch xp.multiplier
export function expYield(winner, loser) {
  const b = bdata(loser.dex).exp, Ld = loser.level, Lp = winner.level;
  const e = Math.floor(((b * Ld) / 5) * Math.pow((2 * Ld + 10) / (Ld + Lp + 10), 2.5)) + 1;
  return Math.floor(e * B().xp.multiplier * (loser.tower ? B().xp.towerMultiplier : 1));
}

function addEvs(f, yieldArr) {
  const S = B().stats;
  for (let i = 0; i < 6; i++) {
    const total = f.evs.reduce((a, b) => a + b, 0);
    const add = Math.min(yieldArr[i], S.evMaxStat - f.evs[i], S.evMaxTotal - total);
    if (add > 0) { f.evs[i] += add; f.evGain[i] += add; }
  }
}

// Passende Entwicklung prüfen (Level oder Stein; Geschlecht / Ang-Vert-Verhältnis wie im Original)
function evoMatches(f, e) {
  if (e.gender && e.gender !== f.gender) return false;
  if (e.relPhys != null) {
    const d = f.stats[1] - f.stats[2];
    if (Math.sign(d) !== e.relPhys) return false;
  }
  return !!bdata(e.to);
}
const pickOne = (f, list) => list[hashString('evo' + (f.uid ?? f.id) + f.dex) % list.length];
export function levelEvolution(f) {
  const list = bdata(f.dex).evos.filter((e) => e.level && f.level >= e.level && evoMatches(f, e));
  return list.length ? pickOne(f, list) : null;
}
export function stoneEvolution(f, stone) {
  const list = bdata(f.dex).evos.filter((e) => e.stone === stone && evoMatches(f, e));
  return list.length ? pickOne(f, list) : null;
}
export const stonesFor = (f) => [...new Set(bdata(f.dex).evos.filter((e) => e.stone && evoMatches(f, e)).map((e) => e.stone))];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Battle {
  // player/cpu: { towers: [src×3], team: [src…] }, opponent: Eintrag aus battle.json
  // playerAi = Profil wie bei Gegnern: dann spielt auch die Spielerseite automatisch (Balancetests)
  constructor({ player, cpu, opponent, seed = Date.now(), playerAi = null }) {
    this.rnd = mulberry32(seed >>> 0);
    this.opponent = opponent;
    this.t = 0;
    this.units = [];
    this.projectiles = [];
    this.pending = [];
    this.events = [];
    this.over = null;
    this.paused = false;
    this.weather = this.pickWeather(null);
    this.weatherNext = this.nextWeatherTime();
    const G = B().grid;
    this.sides = {};
    for (const [side, def] of [['p', player], ['c', cpu]]) {
      const towers = def.towers.map((src, i) => {
        const f = makeFighter({ ...src, tower: true }, side);
        const [cx, cy] = G.towerCells[i];
        f.x = cx + 0.5; f.y = (side === 'p' ? cy : G.rows - 1 - cy) + 0.5;
        f.state = 'field'; f.lane = i; f.role = towerRole(f.dex); f.healT = 0;
        return f;
      });
      const bench = def.team.map((src) => { const f = makeFighter(src, side); f.state = 'bench'; f.readyAt = 0; return f; });
      this.sides[side] = { towers, bench, ai: side === 'c' ? { t: 1.5, o: opponent } : playerAi ? { t: 1.5, o: playerAi } : null };
      this.units.push(...towers);
    }
  }

  // ---- Wetter (nach Jahreszeit gewichtet, wechselt während des Kampfs) ----
  pickWeather(current) {
    const W = B().weather, month = new Date().getMonth() + 1;
    const season = Object.values(W.seasons).find((x) => x.months.includes(month)) || Object.values(W.seasons)[0];
    const ids = Object.keys(W.kinds).filter((k) => k !== current && (season.weights[k] || 0) > 0);
    let r = this.rnd() * ids.reduce((a, k) => a + season.weights[k], 0);
    return ids.find((k) => (r -= season.weights[k]) < 0) || ids[0];
  }
  nextWeatherTime() { const [a, b] = B().weather.changeEverySeconds; return this.t + a + this.rnd() * (b - a); }
  weatherInfo() { return B().weather.kinds[this.weather]; }
  // Schaden-Faktor durch das Wetter für den Angreifer
  weatherBoost(f) { const w = this.weatherInfo(); return w.types.some((t) => species(f.dex).types.includes(t)) ? B().weather.boost : 1; }

  // ---- Kartenleiste ----
  activeCount(side) { return this.units.filter((u) => u.side === side && !u.tower).length; }
  isReady(f) { return f.state === 'bench' && this.t >= (f.readyAt || 0); }
  available(side) { return this.activeCount(side) < B().maxActive ? this.sides[side].bench.filter((f) => this.isReady(f)) : []; }
  // Feld (Spalte, Reihe) erlaubt? Nur die hinterste Reihe der eigenen Seite, keine Verteidiger-Felder
  canPlace(side, col, row) {
    const G = B().grid;
    if (col < 0 || col >= G.cols) return false;
    const r = side === 'p' ? row : G.rows - 1 - row;
    if (r !== G.spawnRow) return false;
    return !G.towerCells.some(([x, y]) => x === col && y === r);
  }
  place(side, f, col, row) {
    if (!f || f.side !== side || this.over || !this.isReady(f) || this.activeCount(side) >= B().maxActive || !this.canPlace(side, col, row)) return false;
    f.state = 'field'; f.alive = true; f.deployed = true; f.x = col + 0.5; f.y = row + 0.5;
    f.lane = this.laneOf(col); f.cd = 0.6; f.spawnT = this.t; f.dir = side === 'p' ? 4 : 0;
    this.units.push(f);
    this.events.push({ type: 'place', f });
    return true;
  }
  laneOf(col) {
    const L = B().grid.lanes;
    let best = 0;
    L.forEach((x, i) => { if (Math.abs(x - col) < Math.abs(L[best] - col)) best = i; });
    return best;
  }

  // ---- Hilfen ----
  enemyOf(side) { return side === 'p' ? 'c' : 'p'; }
  aliveTowers(side) { return this.sides[side].towers.filter((t) => t.hp > 0); }
  rangeOf(f) {
    const mv = moveOf(movesOf(f)[0]);
    let r = mv.range === 'nah' ? C().rangeNah : C().rangeFern; // Nahkampf = Attacke mit Körperkontakt
    if (f.tower) r += B().tower.extraRange + (B().towerRoles[f.role]?.extraRange || 0);
    return r;
  }
  // Abstand bis zum Rand des Ziels (Verteidiger sind größer)
  reach(a, b) { return dist(a, b) - (b.tower ? 0.45 : 0); }
  // Aura-Boni der eigenen Verteidiger
  auraOf(f) {
    let atk = 1, def = 1;
    for (const t of this.aliveTowers(f.side)) {
      if (t === f) continue;
      const R = B().towerRoles[t.role];
      if (!R?.radius || dist(t, f) > R.radius) continue;
      if (R.attackMult) atk = Math.max(atk, R.attackMult);
      if (R.defenseMult) def = Math.max(def, R.defenseMult);
    }
    return { atk, def };
  }
  // Beste Attacke gegen ein Ziel (erwarteter Schaden)
  bestMove(f, target) {
    let best = null;
    for (const k of movesOf(f)) {
      const m = moveOf(k);
      const s = m.power * (m.acc / 100) * effectiveness(m.type, species(target.dex).types) * (species(f.dex).types.includes(m.type) ? C().stab : 1);
      if (!best || s > best.s) best = { k, m, s };
    }
    return best;
  }

  // ---- Wegfindung: über eine Brücke, wenn das Ziel auf der anderen Flussseite liegt ----
  bankOf(y) { const R = B().grid.riverRow; return y < R ? 'top' : y >= R + 1 ? 'bottom' : 'river'; }
  nearestLaneX(x) { return B().grid.lanes.map((l) => l + 0.5).reduce((b, l) => (Math.abs(x - l) < Math.abs(x - b) ? l : b)); }
  // Bereich rund um eine Brücke: dort stellen sich Pokémon hintereinander an statt sich seitlich wegzuschieben
  onBridge(u) { const R = B().grid.riverRow; return u.y > R - 1.2 && u.y < R + 2.2 && Math.abs(u.x - this.nearestLaneX(u.x)) < 0.6; }
  waypoint(f, tx, ty) {
    const R = B().grid.riverRow;
    const fb = this.bankOf(f.y), tb = this.bankOf(ty);
    if (fb === tb || tb === 'river') return { x: tx, y: ty };
    const lanes = B().grid.lanes.map((x) => x + 0.5);
    if (fb === 'river') return { x: this.nearestLaneX(f.x), y: tb === 'top' ? R - 0.4 : R + 1.4 }; // auf der Brücke mittig bleiben
    const bx = lanes.reduce((b, x) => (Math.abs(f.x - x) + Math.abs(tx - x) < Math.abs(f.x - b) + Math.abs(tx - b) ? x : b), lanes[0]);
    const entryY = fb === 'bottom' ? R + 1.2 : R - 0.2;
    // grob ausgerichtet reicht – die Bewegung zum Brückenende zieht das Pokémon von selbst in die Mitte
    if (Math.abs(f.x - bx) > 0.35) return { x: bx, y: entryY };
    return { x: bx, y: tb === 'top' ? R - 0.4 : R + 1.4 };
  }

  // ---- Simulation ----
  update(dt) {
    if (this.over || this.paused) return;
    this.t += dt;
    if (this.t >= this.weatherNext) { this.weather = this.pickWeather(this.weather); this.weatherNext = this.nextWeatherTime(); this.events.push({ type: 'weather', weather: this.weather }); }
    const G = B().grid;
    // Heiler-Verteidiger
    for (const t of this.units) {
      if (!t.tower || t.hp <= 0) continue;
      const R = B().towerRoles[t.role];
      if (!R?.radius) continue;
      t.healT += dt;
      if (t.healT < (R.every || 3)) continue;
      t.healT = 0;
      this.events.push({ type: 'pulse', f: t, role: t.role, radius: R.radius }); // sichtbarer Impuls der Fähigkeit
      if (!R.healPct) continue;
      for (const u of this.units) {
        if (u.side !== t.side || u.tower || u.hp <= 0 || u.state !== 'field' || dist(u, t) > R.radius || u.hp >= u.maxHp) continue;
        const amt = Math.max(1, Math.round(u.maxHp * R.healPct));
        u.hp = Math.min(u.maxHp, u.hp + amt);
        this.events.push({ type: 'heal', f: u, amt, from: t });
      }
    }
    // Reihenfolge jede Runde mischen, damit keine Seite durch die Rechenreihenfolge im Vorteil ist
    const fighters = this.units.filter((u) => u.state === 'field' && u.hp > 0);
    for (let i = fighters.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [fighters[i], fighters[j]] = [fighters[j], fighters[i]]; }
    for (const f of fighters) this.think(f, dt, fighters);
    // Gleichseitige Pokémon nicht übereinander stapeln
    for (const a of fighters) {
      if (a.tower) continue;
      for (const b of fighters) {
        if (a === b || b.tower || a.side !== b.side) continue;
        const d = dist(a, b);
        if (d > 0.001 && d < 0.55) {
          const k = ((0.55 - d) / d) * 0.5 * Math.min(1, dt * 8);
          if (this.onBridge(a) && this.onBridge(b)) a.y += (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.id < b.id ? 0.05 : -0.05) * k; // auf der Brücke nur hintereinander
          else { a.x += (a.x - b.x) * k; a.y += (a.y - b.y) * k; }
        }
      }
      a.x = Math.max(0.3, Math.min(G.cols - 0.3, a.x));
      a.y = Math.max(0.3, Math.min(G.rows - 0.3, a.y));
    }
    // Treffer von Nahkampf-Attacken (kurz verzögert, passend zur Animation)
    this.pending = this.pending.filter((h) => { if (h.at > this.t) return true; this.hit(h.from, h.to, h.move); return false; });
    // Geschosse
    this.projectiles = this.projectiles.filter((p) => {
      const tgt = p.to;
      const d = Math.hypot(tgt.x - p.x, tgt.y - p.y);
      const step = C().projectileSpeed * dt;
      if (d <= step || tgt.hp <= 0) { if (tgt.hp > 0) this.hit(p.from, tgt, p.move); return false; }
      p.x += ((tgt.x - p.x) / d) * step; p.y += ((tgt.y - p.y) / d) * step;
      return true;
    });
    // Besiegte verlassen das Feld (nach kurzer Ohnmachts-Animation) und sind für koCooldown Sekunden gesperrt
    this.units = this.units.filter((u) => {
      if (u.tower || u.hp > 0 || this.t - u.faintT < 0.7) return true;
      u.state = 'bench'; u.hp = u.maxHp; u.anim = null; u.readyAt = u.faintT + B().koCooldown;
      return false;
    });
    for (const side of this.rnd() < 0.5 ? ['p', 'c'] : ['c', 'p']) if (this.sides[side].ai) this.cpu(side, dt);
    for (const side of ['p', 'c']) if (!this.aliveTowers(side).length && !this.over) this.over = { winner: this.enemyOf(side), t: this.t };
  }

  think(f, dt, fighters) {
    f.cd -= dt;
    if (f.spawnT != null && this.t - f.spawnT < 0.6) return; // kurz "landen" nach dem Ausspielen
    const range = this.rangeOf(f);
    const foes = fighters.filter((u) => u.side !== f.side);
    let target = null, best = Infinity;
    if (f.tower) {
      // Verteidiger greifen nur Gegner auf ihrer eigenen Spur an
      for (const u of foes) { const d = this.reach(f, u); if (!u.tower && this.laneOf(Math.floor(u.x)) === f.lane && d <= range && d < best) { best = d; target = u; } }
    } else {
      // Gegner in der Nähe zuerst bekämpfen, sonst zum Verteidiger der eigenen Spur
      for (const u of foes) { const d = this.reach(f, u); if (d <= Math.max(C().aggroRange, range) && d < best) { best = d; target = u; } }
      if (!target) {
        const towers = this.aliveTowers(this.enemyOf(f.side));
        target = towers.find((t) => t.lane === f.lane) || towers.sort((a, b) => dist(f, a) - dist(f, b))[0];
      }
    }
    if (!target) { f.moving = false; return; }
    if (this.reach(f, target) <= range) {
      f.moving = false;
      f.dir = dirTo(target.x - f.x, target.y - f.y);
      if (f.cd <= 0) this.attack(f, target);
    } else if (!f.tower) {
      const w = this.waypoint(f, target.x, target.y);
      const dx = w.x - f.x, dy = w.y - f.y, d = Math.hypot(dx, dy) || 1;
      const sp = C().moveTilesPerSecond * Math.pow(f.stats[5] / refStat(f.level), C().moveSpeedExp);
      const step = Math.min(d, sp * dt);
      f.x += (dx / d) * step; f.y += (dy / d) * step;
      f.dir = dirTo(dx, dy);
      f.moving = true;
    }
  }

  attack(f, target) {
    const choice = this.bestMove(f, target);
    if (!choice) return;
    const [c0, c1] = C().cooldownClamp;
    f.cd = C().attackCooldown * Math.max(c0, Math.min(c1, Math.pow(refStat(f.level) / f.stats[5], C().cooldownSpeedExp)));
    const melee = choice.m.range === 'nah';
    f.anim = { name: melee ? 'Attack' : 'Shoot', t0: this.t };
    f.lastMove = choice.k;
    if (melee) this.pending.push({ at: this.t + 0.25, from: f, to: target, move: choice.k });
    else this.projectiles.push({ x: f.x, y: f.y, from: f, to: target, move: choice.k, type: choice.m.type });
    this.events.push({ type: 'attack', f, target, move: choice.k });
  }

  hit(from, to, moveKey) {
    if (to.hp <= 0) return;
    const mv = moveOf(moveKey);
    if (C().useAccuracy && this.rnd() * 100 >= mv.acc) { this.events.push({ type: 'miss', f: to }); return; }
    const a = this.auraOf(from), d = this.auraOf(to);
    const { dmg, eff } = damageOf(from, to, mv, this.rnd, a.atk * this.weatherBoost(from), d.def);
    to.hp = Math.max(0, to.hp - dmg);
    to.hurtT = this.t;
    this.events.push({ type: 'hit', f: to, from, dmg, eff, move: moveKey });
    if (to.hp <= 0) this.faint(to, from);
  }

  faint(f, killer) {
    f.faintT = this.t;
    f.anim = null;
    this.events.push({ type: 'faint', f, killer });
    if (f.tower) f.state = 'down';
    if (killer.hp <= 0) return;
    killer.kos++;
    addEvs(killer, bdata(f.dex).ev);
    this.gainExp(killer, Math.floor(expYield(killer, f) * (killer.tower ? B().tower.expMultiplier ?? 1 : 1)));
  }

  gainExp(f, amount) {
    if (f.level >= B().maxLevel) return;
    f.exp += amount;
    let up = false;
    while (f.level < B().maxLevel && f.exp >= expForLevel(f.dex, f.level + 1)) { f.level++; up = true; }
    if (!up) return;
    recalc(f);
    this.events.push({ type: 'level', f, level: f.level });
    let evo, guard = 0;
    while ((evo = levelEvolution(f)) && guard++ < 3) this.evolve(f, evo.to);
  }

  evolve(f, to) {
    const from = f.dex;
    f.dex = to;
    recalc(f);
    this.events.push({ type: 'evolve', f, from, to });
  }

  // Kämpfer einer Seite, die (noch) mitspielen – Verteidiger, auf dem Feld oder in der Kartenleiste
  roster(side) {
    const S = this.sides[side];
    return [...S.towers.filter((t) => t.hp > 0), ...S.bench.filter((f) => f.state === 'bench' || f.hp > 0)];
  }
  // Entwicklungsstein einsetzen (Bezahlung erledigt die Oberfläche)
  useStone(f, stone) {
    const evo = stoneEvolution(f, stone);
    if (!evo || this.over) return false;
    this.evolve(f, evo.to);
    return true;
  }

  // ---- Computergegner ----
  cpu(side, dt) {
    const S = this.sides[side], ai = S.ai, o = ai.o, foeSide = this.enemyOf(side);
    ai.t -= dt;
    if (ai.t > 0) return;
    ai.t = o.think * (0.7 + this.rnd() * 0.6);
    const ready = this.available(side);
    if (!ready.length) return;
    const G = B().grid, R = G.riverRow;
    const mine = this.aliveTowers(side);
    // Bedrohung: Spieler-Pokémon auf der eigenen Hälfte oder kurz davor
    const onMyHalf = (u) => (side === 'c' ? u.y < R + 2.5 : u.y > R - 1.5);
    const threats = this.units.filter((u) => u.side === foeSide && !u.tower && u.hp > 0 && u.state === 'field' && onMyHalf(u))
      .sort((a, b) => Math.min(...mine.map((t) => dist(a, t))) - Math.min(...mine.map((t) => dist(b, t))));
    const score = (f, foe) => {
      const m = moveOf(movesOf(f)[0]), fm = moveOf(movesOf(foe)[0]);
      const atk = m.power * effectiveness(m.type, species(foe.dex).types) * (species(f.dex).types.includes(m.type) ? 1.5 : 1);
      const taken = fm.power * effectiveness(fm.type, species(f.dex).types);
      return atk / (taken + 20) + (f.level - B().startLevel) * 0.2;
    };
    const pickFor = (foe) => ready.reduce((b, f) => (score(f, foe) > score(b, foe) ? f : b), ready[0]);
    if (threats.length) {
      const foe = threats[0];
      const tower = mine.sort((a, b) => dist(a, foe) - dist(b, foe))[0] || foe;
      // Verteidigen: in der hinteren Reihe hinter dem bedrohten Verteidiger einsetzen
      const f = pickFor(foe);
      const cell = this.nearestFree(side, (foe.x + tower.x) / 2, 0);
      if (cell) this.place(side, f, cell[0], cell[1]);
      return;
    }
    if (this.rnd() > o.aggression) return; // abwarten
    // Angriffswellen: erst losschicken, wenn genug Pokémon bereit sind (wave), dann gemeinsam auf eine Spur
    const wave = Math.min(o.wave || 1, B().maxActive - this.activeCount(side));
    if (ready.length < wave) return;
    // Angriff: auf den schwächsten Verteidiger des Spielers
    const targets = this.aliveTowers(foeSide).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    if (!targets.length) return;
    const tgt = targets[0];
    for (let k = 0; k < Math.max(1, wave); k++) {
      const pool = this.available(side);
      if (!pool.length) break;
      const f = pool.reduce((b, x) => (score(x, tgt) > score(b, tgt) ? x : b), pool[0]);
      const cell = this.nearestFree(side, G.lanes[tgt.lane] + 0.5 + (k - (wave - 1) / 2), 0);
      if (cell) this.place(side, f, cell[0], cell[1]);
    }
  }
  nearestFree(side, x, y) {
    const G = B().grid;
    let best = null, bd = Infinity;
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
      if (!this.canPlace(side, c, r)) continue;
      const d = Math.hypot(c + 0.5 - x, r + 0.5 - y);
      if (d < bd) { bd = d; best = [c, r]; }
    }
    return best;
  }
}

// Blickrichtung (Zeile im PMD-Sheet) aus einem Vektor
function dirTo(dx, dy) {
  const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return { 0: 2, 1: 1, 2: 0, 3: 7, 4: 6, '-4': 6, '-3': 5, '-2': 4, '-1': 3 }[oct];
}

// Kampfquelle aus einem gespeicherten Pokémon (keine Kopie des Fortschritts im Freundesareal)
export const fromPokemon = (p) => ({ uid: p.uid, dex: p.dex, gender: p.gender, ivs: p.ivs, evs: p.evs, moves: p.moves, nick: p.nick });
// Kampfquelle für einen Computergegner
export function fromCpu(dex, o, i) {
  const S = CFG.battle.stats;
  const ev = Math.min(o.evs || 0, S.evMaxStat, Math.floor(S.evMaxTotal / 6));
  return { dex, gender: null, ivs: rollIvs(`${o.id}|${dex}|${i}`, o.ivs), evs: [ev, ev, ev, ev, ev, ev] };
}
