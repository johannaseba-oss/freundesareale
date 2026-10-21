// PokeDefense: Tower Defense wie Plants vs. Zombies, vertikal.
// Eigene Pokémon werden mit Sternen auf das untere Feld gesetzt, Gegner laufen in ihren Spalten von oben nach unten.
// Erreicht ein Gegner die untere Linie (Trainer), ist die Runde verloren; nach fünf abgewehrten Wellen gewonnen.
import { CFG, species } from '../config.js';
import { effectiveness } from './types.js';
import { calcStats, bdata, moveOf, rollIvs, expForLevel, levelEvolution, fromCpu } from './battle.js';
import { mulberry32 } from '../rng.js';
import { pickWeather, nextWeatherIn, weatherBoost } from './weather.js';

const D = () => CFG.defense;
const bst = (dex) => bdata(dex).base.reduce((a, b) => a + b, 0);

// Sonderfähigkeit einer Art (defense.json abilities)
export const abilityOf = (dex) => D().abilities?.[dex] || null;

// Rolle einer Art (siehe defense.json roles); Panzer = Mauer, Explosion bei Angriff = Explosiv
export function roleOf(dex) {
  const R = D().roles, ab = abilityOf(dex);
  if (ab?.type === 'shield') return 'mauer';
  if (ab?.type === 'reactive') return 'explosiv';
  for (const r of ['produzent', 'explosiv', 'mauer']) if (R[r].dex.includes(dex)) return r;
  return moveOf(bdata(dex).move)?.range === 'nah' ? 'nahkampf' : 'fernkampf';
}
const evolved = (dex) => species(dex).stage > 1;

// Sternenkosten und Aufladezeit
export function costOf(dex) {
  const R = D().roles, role = roleOf(dex), sp = species(dex);
  if (role === 'produzent') return evolved(dex) ? R.produzent.costEvolved : R.produzent.cost;
  if (role === 'explosiv') return evolved(dex) ? R.explosiv.costBig : R.explosiv.cost;
  if (role === 'mauer') return R.mauer.cost + R.mauer.costPerStage * (Math.min(3, sp.stage) - 1);
  let c = 25 * Math.max(1, Math.round((bst(dex) - 180) / 70));
  if (sp.rarity === 'legendaer') c += D().cost.legendaryExtra;
  return c;
}
export function rechargeOf(dex) {
  const R = D().roles, role = roleOf(dex);
  if (role === 'produzent') return R.produzent.recharge;
  if (role === 'explosiv') return evolved(dex) ? R.explosiv.rechargeBig : R.explosiv.recharge;
  if (role === 'mauer') return R.mauer.recharge;
  const c = costOf(dex);
  return D().cost.recharge.find(([max]) => c <= max)[1];
}
export const roleInfo = (dex) => D().roles[roleOf(dex)];

// Kurzbeschreibung der Fähigkeit (für Karten und Teamwahl)
export function abilityText(dex) {
  const role = roleOf(dex), mv = moveOf(bdata(dex).move), R = D().roles, ab = abilityOf(dex);
  if (ab) return `${ab.name}: ${ab.text}`;
  if (role === 'produzent') return `erzeugt alle ${R.produzent.every[0]}–${R.produzent.every[1]} s ${evolved(dex) ? R.produzent.valueEvolved : R.produzent.value} Sterne`;
  if (role === 'explosiv') return evolved(dex) ? 'explodiert sofort und trifft alles in der Nähe' : `Mine: explodiert, sobald ein Gegner sie erreicht (${R.explosiv.armSeconds} s scharf machen)`;
  if (role === 'mauer') return 'sehr robust – hält Gegner auf';
  const slow = mv.type === 'Eis' ? ', verlangsamt' : mv.type === 'Elektro' ? ', bremst etwas' : '';
  return role === 'nahkampf' ? `${mv.name}: starker Hieb aufs Feld davor${slow}` : `${mv.name}: schießt die Spalte hinauf${slow}`;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Vergleichswert für Tempo: Initiative eines Pokémon mit Basiswert 80 auf demselben Level
const refSpeed = (level) => Math.floor(((2 * 80 + 15) * level) / 100) + 5;

export class Defense {
  // team: [{uid, dex, gender, ivs, evs, nick}], level: Eintrag aus defense_levels.json
  // chaos = Chaos-Modus: keine Sterne, herabfallende Pokébälle bringen einmalige Zufalls-Pokémon
  constructor({ team, level, seed = Date.now(), chaos = false }) {
    this.rnd = mulberry32(seed >>> 0);
    this.chaos = chaos;
    this.t = 0;
    this.level = level;
    this.theme = level.types;
    this.waves = buildWaves(level);
    this.families = pickFamilies(level, mulberry32(level.n * 7919));
    this.stars = D().stars.start;
    this.cards = team.map((src) => ({ src, dex: src.dex, role: roleOf(src.dex), cost: costOf(src.dex), recharge: rechargeOf(src.dex), readyAt: 0 }));
    this.units = [];
    this.enemies = [];
    this.projectiles = [];
    this.drops = [];
    this.events = [];
    this.over = null;
    this.started = false;
    this.wave = -1;
    this.queue = [];
    this.nextSky = 4;
    this.nextWaveAt = D().firstWaveDelay;
    this.nextId = 1;
    this.weather = pickWeather(this.rnd);
    this.weatherNext = nextWeatherIn(this.rnd);
    if (chaos) { this.stars = 0; for (let i = 0; i < D().chaos.startCards; i++) this.addChaosCard(randomDex(this.rnd)); }
  }
  // Chaos: einmalige Karte mit einem zufälligen Pokémon (kostenlos, verschwindet nach dem Einsetzen)
  addChaosCard(dex) {
    if (this.cards.length >= D().chaos.handMax) return false;
    const src = fromCpu(dex, { id: 'chaos' + this.nextId, ivs: [0, 31], evs: 0 }, this.nextId++);
    this.cards.push({ src, dex, role: roleOf(dex), cost: 0, recharge: 0, readyAt: 0, once: true, id: this.nextId++ });
    return true;
  }

  // ---- Platzieren ----
  // oberste freie Reihe: anfangs nur die untersten startRows, mit jeder Welle rowsPerWave mehr
  minRow() {
    const G = D().grid;
    const span = G.placeRows[1] - G.placeRows[0] + 1 - (G.startRows || 0);
    const open = (G.startRows || 99) + Math.min(span, Math.floor(Math.max(0, this.wave + 1) * Math.max(G.rowsPerWave || 0, span / Math.max(1, this.waves.length * 0.6))));
    return Math.max(G.placeRows[0], G.placeRows[1] - open + 1);
  }
  canPlace(col, row) {
    const G = D().grid;
    return col >= 0 && col < G.cols && row >= this.minRow() && row <= G.placeRows[1] && !this.units.some((u) => u.col === col && u.row === row);
  }
  cardReady(card) { return this.t >= card.readyAt && this.stars >= card.cost && !this.over; }
  place(card, col, row) {
    if (!this.cardReady(card) || !this.canPlace(col, row)) return false;
    this.stars -= card.cost;
    card.readyAt = this.t + card.recharge;
    if (card.once) this.cards.splice(this.cards.indexOf(card), 1);
    const src = card.src, R = D().roles;
    const L = Math.max(D().level, (this.level?.enemyLevel || 0) - (D().levelGap ?? 99)); // spätere Level: eigene Pokémon starten stärker
    const stats = calcStats(src.dex, L, src.ivs, src.evs);
    const ab = abilityOf(src.dex);
    const hpMult = D().defenderHpMult * (ab?.type === 'shield' ? ab.hpMult : card.role === 'mauer' ? R.mauer.hpMult : 1);
    const u = { id: this.nextId++, dex: src.dex, gender: src.gender, nick: src.nick, ivs: src.ivs, evs: src.evs, hpMult, level: L, exp: expForLevel(src.dex, L), role: card.role, col, row, x: col + 0.5, y: row + 0.5, stats, maxHp: stats[0] * hpMult, cd: 0.8, placedAt: this.t };
    u.hp = u.maxHp;
    if (card.role === 'produzent') u.nextStar = this.t + this.between(R.produzent.every) * 0.5;
    if (card.role === 'explosiv') u.armAt = this.t + (ab?.type === 'reactive' ? 0 : evolved(u.dex) ? 0.8 : R.explosiv.armSeconds);
    if (ab?.type === 'heal') u.nextHeal = this.t + ab.every * 0.5;
    this.units.push(u);
    this.events.push({ type: 'place', u });
    return true;
  }
  between([a, b]) { return a + this.rnd() * (b - a); }

  // ---- Sterne ----
  collect(drop) {
    if (!this.drops.includes(drop)) return 0;
    if (drop.dex) { // Chaos: Pokéball öffnen
      if (!this.addChaosCard(drop.dex)) { this.events.push({ type: 'handFull' }); return 0; }
      this.drops.splice(this.drops.indexOf(drop), 1);
      this.events.push({ type: 'collect', drop });
      return 1;
    }
    this.drops.splice(this.drops.indexOf(drop), 1);
    this.stars += drop.value;
    this.events.push({ type: 'collect', drop });
    return drop.value;
  }
  dropStar(x, y, fromY, value) {
    // im Chaos-Modus fällt statt eines Sterns ein Pokéball mit einem zufälligen Pokémon
    const dex = this.chaos ? randomDex(this.rnd) : null;
    this.drops.push({ id: this.nextId++, x, y, fromY, value, born: this.t, dex });
  }

  // ---- Wellen ----
  startWave() {
    this.wave++;
    const W = this.waves[this.wave];
    const level = this.level.enemyLevel + this.wave * D().enemy.levelPerWave;
    // Entwicklungsstufe steigt über die Wellen: erst Grundformen, gelegentlich Zweitentwicklungen, zum Schluss Endentwicklungen
    const p = this.waves.length > 1 ? this.wave / (this.waves.length - 1) : 1;
    const weights = [Math.max(0.05, 1 - p * 0.9), 0.12 + p * 0.9, this.level.finalStage >= 3 ? Math.max(0, (p - 0.4) * 1.6) : 0];
    for (let i = 0; i < W.count; i++) {
      let r = this.rnd() * weights.reduce((a, b) => a + b, 0), stage = 1;
      for (let k = 0; k < 3; k++) { if ((r -= weights[k]) < 0) { stage = k + 1; break; } }
      const fam = this.families[Math.floor(this.rnd() * this.families.length)];
      const dex = fam[Math.min(stage, fam.length) - 1];
      this.queue.push({ at: this.t + (W.final && i < 3 ? 0 : (i / W.count) * W.spread + this.rnd() * 3), dex, level, col: Math.floor(this.rnd() * D().grid.cols) });
    }
    this.queue.sort((a, b) => a.at - b.at);
    this.events.push({ type: 'wave', wave: this.wave, final: !!W.final, minRow: this.minRow() });
  }
  spawn(q) {
    const st = calcStats(q.dex, q.level, rollIvs('g' + this.nextId, [0, 31]), [0, 0, 0, 0, 0, 0]);
    const v = D().enemy.speedVariation || [1, 1];
    const e = { id: this.nextId++, dex: q.dex, x: q.col + 0.5, y: -0.4, col: q.col, stats: st, level: q.level, maxHp: st[0] * D().enemy.hpMult, cd: 0, slowUntil: 0, pace: v[0] + this.rnd() * (v[1] - v[0]) };
    e.hp = e.maxHp;
    this.enemies.push(e);
  }

  // ---- Schaden (offizielle Formel mit Typ-Effektivität und gleichem Typ) ----
  damage(att, attLevel, def, mult = 1) {
    const mv = moveOf(bdata(att.dex).move), phys = mv.cat === 'phys';
    const A = att.stats[phys ? 1 : 3], Dv = def.stats[phys ? 2 : 4];
    const stab = species(att.dex).types.includes(mv.type) ? 1.5 : 1;
    const eff = effectiveness(mv.type, species(def.dex).types);
    const base = (Math.floor((2 * attLevel) / 5 + 2) * mv.power * A / Dv) / 50 + 2;
    const crit = eff > 0 && this.rnd() < D().crit.chance; // Volltreffer
    const w = weatherBoost(att.dex, this.weather);
    return { dmg: eff ? Math.max(1, Math.round(base * stab * eff * mult * w * (crit ? D().crit.mult : 1) * (0.9 + this.rnd() * 0.1))) : 0, eff, mv, crit };
  }
  hurtEnemy(e, dmg, eff, from, mv, crit = false) {
    if (e.hp <= 0) return;
    e.hp -= dmg; e.hurtT = this.t;
    if (mv?.type === 'Eis') { e.slowUntil = this.t + D().iceSlow.seconds; e.slowFactor = D().iceSlow.factor; }
    else if (mv?.type === 'Elektro' && !(this.t < e.slowUntil && e.slowFactor < D().elecSlow.factor)) { e.slowUntil = this.t + D().elecSlow.seconds; e.slowFactor = D().elecSlow.factor; }
    if (mv?.type === 'Gift' && from?.dex && e.hp > 0) e.poison = { until: this.t + D().poison.seconds, dps: e.maxHp * D().poison.pctPerSecond, from, tick: 0 };
    const ab = from?.dex ? abilityOf(from.dex) : null;
    if (ab?.type === 'confuse' && e.hp > 0 && this.rnd() < ab.chance) { e.confusedUntil = this.t + ab.seconds; this.events.push({ type: 'confuse', e }); }
    this.events.push({ type: 'hit', target: e, dmg, eff, move: mv, crit, melee: from?.role === 'nahkampf' });
    if (e.hp <= 0) { this.events.push({ type: 'defeat', e }); if (from?.role && from.hp > 0) this.reward(from, e); }
  }

  // EP für den Angreifer (offizielle Formel × xp.multiplier), Levelaufstieg und Entwicklung – nur für diese Runde
  reward(u, e) {
    const b = bdata(e.dex).exp, Ld = e.level, Lp = u.level;
    u.exp += Math.floor((Math.floor(((b * Ld) / 5) * Math.pow((2 * Ld + 10) / (Ld + Lp + 10), 2.5)) + 1) * (D().xp?.multiplier || 1));
    let up = false;
    while (u.level < 100 && u.exp >= expForLevel(u.dex, u.level + 1)) { u.level++; up = true; }
    if (!up) return;
    this.restat(u);
    this.events.push({ type: 'level', u, level: u.level });
    const evo = levelEvolution(u);
    if (evo) { const from = u.dex; u.dex = evo.to; this.restat(u); this.events.push({ type: 'evolve', u, from, to: evo.to }); }
  }
  explode(u, rad, damage) {
    for (const e of this.enemies) if (e.hp > 0 && dist(e, u) <= rad + 0.3) {
      const eff = effectiveness(moveOf(bdata(u.dex).move).type, species(e.dex).types) || 1;
      this.hurtEnemy(e, Math.round(damage * Math.max(0.5, eff)), eff, u, null);
    }
    u.hp = 0;
    this.events.push({ type: 'explode', u, radius: rad });
  }
  restat(u) {
    const old = u.maxHp;
    u.stats = calcStats(u.dex, u.level, u.ivs, u.evs);
    u.maxHp = u.stats[0] * u.hpMult;
    u.hp = Math.min(u.maxHp, u.hp + Math.max(0, u.maxHp - old));
  }

  // ---- Simulation ----
  update(dt) {
    if (!this.started || this.over) return;
    this.t += dt;
    const G = D().grid, S = D().stars, R = D().roles, L = D().level;
    if (this.t >= this.weatherNext) { this.weather = pickWeather(this.rnd, this.weather); this.weatherNext = this.t + nextWeatherIn(this.rnd); this.events.push({ type: 'weather', weather: this.weather }); }
    // Sternenregen
    if (this.t >= this.nextSky) {
      this.nextSky = this.t + this.between(this.chaos ? D().chaos.dropEvery : S.skyEvery);
      this.dropStar(0.5 + this.rnd() * (G.cols - 1), 2 + this.rnd() * (G.rows - 3), -0.5, S.skyValue);
    }
    this.drops = this.drops.filter((d) => this.t - d.born < S.lifetime + 1.5);
    // Wellen
    if (this.wave < this.waves.length - 1 && this.t >= this.nextWaveAt && !this.queue.length) {
      this.startWave();
      const W = this.waves[this.wave];
      this.nextWaveAt = this.t + W.spread + D().waveGap;
    }
    while (this.queue.length && this.queue[0].at <= this.t) this.spawn(this.queue.shift());
    // eigene Pokémon
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      if (u.role === 'produzent') {
        if (this.t >= u.nextStar) { u.nextStar = this.t + this.between(R.produzent.every); this.dropStar(u.x, u.y - 0.3, u.y, evolved(u.dex) ? R.produzent.valueEvolved : R.produzent.value); u.anim = { name: 'Hop', t0: this.t }; }
        continue;
      }
      const ab = abilityOf(u.dex);
      // Heilende Aura: heilt eigene Pokémon in der Nähe (zusätzlich zum normalen Angriff)
      if (ab?.type === 'heal' && this.t >= u.nextHeal) {
        u.nextHeal = this.t + ab.every;
        const healed = [];
        for (const o of this.units) if (o.hp > 0 && o.hp < o.maxHp && dist(o, u) <= ab.radius) { const amt = Math.max(1, Math.round(o.maxHp * ab.pct)); o.hp = Math.min(o.maxHp, o.hp + amt); healed.push({ o, amt }); }
        this.events.push({ type: 'heal', u, radius: ab.radius, healed });
      }
      if (u.role === 'mauer') continue;
      if (u.role === 'explosiv') {
        if (ab?.type === 'reactive') continue; // explodiert erst, wenn es angegriffen wird
        if (this.t < u.armAt) continue;
        const big = evolved(u.dex);
        const trigger = big || this.enemies.some((e) => e.hp > 0 && e.col === u.col && Math.abs(e.y - u.y) < 0.6);
        if (!trigger) continue;
        this.explode(u, big ? R.explosiv.radiusBig : R.explosiv.radiusSmall, R.explosiv.damage);
        continue;
      }
      u.cd -= dt;
      if (u.cd > 0) continue;
      const melee = u.role === 'nahkampf', range = ab?.type === 'beam' ? ab.length + 0.3 : ab?.type === 'boomerang' ? ab.range : R[u.role].range;
      // nächster Gegner in der eigenen Spalte oberhalb (Nahkampf: direkt davor)
      let target = null;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.col !== u.col || e.y > u.y + 0.3 || e.y < -0.2) continue;
        const d = u.y - e.y;
        if (d <= range && (!target || e.y > target.y)) target = e;
      }
      if (!target) continue;
      const spd = u.stats[5] / refSpeed(u.level);
      u.cd = R[u.role].cooldown / Math.max(0.7, Math.min(1.4, Math.pow(spd, 0.3)));
      u.anim = { name: melee ? 'Attack' : 'Shoot', t0: this.t };
      this.events.push({ type: 'shoot', u, moveType: moveOf(bdata(u.dex).move).type, melee });
      if (ab?.type === 'beam') { // Strahl: trifft alle Gegner in length Feldern
        this.events.push({ type: 'beam', u, length: ab.length, fx: ab.fx });
        for (const e of this.enemies) if (e.hp > 0 && e.col === u.col && u.y - e.y > -0.2 && u.y - e.y <= ab.length + 0.3) { const r = this.damage(u, u.level, e, ab.mult || 1); this.hurtEnemy(e, r.dmg, r.eff, u, r.mv, r.crit); }
      } else if (ab?.type === 'boomerang') {
        this.projectiles.push({ x: u.x, y: u.y - 0.3, col: u.col, from: u, type: moveOf(bdata(u.dex).move).type, boomerang: true, out: true, startY: u.y - 0.3, range: ab.range, hits: new Set(), left: ab.pierce, ab });
      } else if (melee) { const r = this.damage(u, u.level, target, R.nahkampf.damageMult); this.hurtEnemy(target, r.dmg, r.eff, u, r.mv, r.crit); }
      else this.projectiles.push({ x: u.x, y: u.y - 0.3, col: u.col, from: u, type: moveOf(bdata(u.dex).move).type });
    }
    // Geschosse fliegen die Spalte hinauf und treffen den ersten Gegner
    this.projectiles = this.projectiles.filter((p) => {
      if (p.boomerang) return this.flyBoomerang(p, dt);
      p.y -= 6 * dt;
      const hit = this.enemies.find((e) => e.hp > 0 && e.col === p.col && Math.abs(e.y - p.y) < 0.35);
      if (hit) { const r = this.damage(p.from, p.from.level, hit, R.fernkampf.damageMult); this.hurtEnemy(hit, r.dmg, r.eff, p.from, r.mv, r.crit); return false; }
      return p.y > -1;
    });
    // Gegner laufen nach unten, beißen eigene Pokémon, die im Weg stehen
    const E = D().enemy;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      // Gift: Schaden über Zeit, Anzeige alle 0,5 s
      if (e.poison && this.t < e.poison.until) {
        const d = e.poison.dps * dt;
        e.hp -= d; e.poison.tick += d;
        if (e.poison.tick >= Math.max(1, e.poison.dps * 0.5)) { this.events.push({ type: 'poison', e, dmg: Math.round(e.poison.tick) }); e.poison.tick = 0; }
        if (e.hp <= 0) { e.hurtT = this.t; this.events.push({ type: 'defeat', e }); if (e.poison.from.hp > 0) this.reward(e.poison.from, e); continue; }
      }
      // verwirrt: dreht um, greift Gegner hinter sich an oder trifft sich selbst
      if (this.t < (e.confusedUntil || 0)) {
        e.cd -= dt; e.eating = false;
        const other = this.enemies.find((o) => o !== e && o.hp > 0 && o.col === e.col && e.y - o.y > 0 && e.y - o.y < 0.8);
        if (e.cd <= 0) {
          e.cd = E.biteCooldown; e.anim = { name: 'Attack', t0: this.t };
          const victim = other || e, r = this.damage(e, e.level, victim, other ? 1 : 0.5);
          this.hurtEnemy(victim, r.dmg, r.eff, null, r.mv, r.crit);
        }
        if (!other) e.y = Math.max(-0.3, e.y - E.tilesPerSecond * 0.5 * dt);
        continue;
      }
      const block = this.units.find((u) => u.hp > 0 && u.col === e.col && u.y - e.y > 0 && u.y - e.y < 0.75 && (u.role !== 'explosiv' || abilityOf(u.dex)?.type === 'reactive'));
      if (block && abilityOf(block.dex)?.type === 'reactive') { const ab = abilityOf(block.dex); this.explode(block, ab.radius, ab.damage); continue; }
      if (block) {
        e.cd -= dt; e.eating = true;
        if (e.cd <= 0) {
          e.cd = E.biteCooldown; e.anim = { name: 'Attack', t0: this.t };
          const r = this.damage(e, e.level, block);
          block.hp -= r.dmg; block.hurtT = this.t;
          this.events.push({ type: 'hit', target: block, dmg: r.dmg, eff: r.eff, move: r.mv, mine: true, crit: r.crit });
          if (block.hp <= 0) this.events.push({ type: 'lost', u: block });
        }
        continue;
      }
      e.eating = false;
      const sp = E.tilesPerSecond * (e.pace || 1) * Math.pow(e.stats[5] / refSpeed(e.level), E.speedExp) * (this.t < e.slowUntil ? e.slowFactor || D().iceSlow.factor : 1);
      e.y += sp * dt;
      if (e.y >= G.rows) { this.over = { won: false, t: this.t, by: e }; return; }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0 || this.t - (e.hurtT || 0) < 0.5);
    this.units = this.units.filter((u) => u.hp > 0 || this.t - (u.hurtT || u.placedAt) < 0.5);
    // Sieg: alle Wellen vorbei, nichts mehr unterwegs
    if (this.wave === this.waves.length - 1 && !this.queue.length && !this.enemies.some((e) => e.hp > 0)) this.over = { won: true, t: this.t };
  }
  // Knochenbumerang: hin bis range, dann zurück; durchschlägt je Richtung pierce Gegner (zurück schwächer)
  flyBoomerang(p, dt) {
    p.spin = (p.spin || 0) + dt * 18;
    p.y += (p.out ? -5 : 5) * dt;
    if (p.out && p.startY - p.y >= p.range) { p.out = false; p.hits = new Set(); p.left = p.ab.pierce; }
    for (const e of this.enemies) {
      if (p.left <= 0 || e.hp <= 0 || e.col !== p.col || p.hits.has(e.id) || Math.abs(e.y - p.y) > 0.35) continue;
      p.hits.add(e.id); p.left--;
      const r = this.damage(p.from, p.from.level, e, p.out ? 1 : p.ab.backMult);
      this.hurtEnemy(e, r.dmg, r.eff, p.from, r.mv, r.crit);
    }
    return p.out || p.y < p.startY;
  }
  waveProgress() { return { wave: Math.max(0, this.wave + 1), total: this.waves.length }; }
}

// Wellen eines Levels: Gegneranzahl steigt, die letzte Welle ist besonders groß
export function buildWaves(level) {
  const S = D().waveShape;
  return Array.from({ length: level.waves }, (_, i) => {
    const final = i === level.waves - 1;
    return { count: Math.round((S.base + i * S.perWave) * level.countMult * (final ? S.finalMult : 1)), spread: S.spread + i, final };
  });
}
// Gegner-Familien eines Levels: Entwicklungsreihen (Grundform, Zweit-, Endentwicklung), deren Arten zu den Level-Typen passen
export function pickFamilies(level, rnd) {
  const byFam = new Map();
  for (const p of CFG.dex) if (bdata(p.dex) && p.rarity !== 'legendaer') (byFam.get(p.family) || byFam.set(p.family, []).get(p.family)).push(p);
  const fams = [...byFam.values()].map((l) => l.sort((a, b) => a.stage - b.stage || a.dex - b.dex))
    .filter((l) => l.some((p) => p.types.some((t) => level.types.includes(t))))
    .map((l) => l.filter((p, i, a) => a.findIndex((q) => q.stage === p.stage) === i).map((p) => p.dex)); // je Stufe eine Art
  const withEvo = fams.filter((l) => l.length > 1), pool = withEvo.length >= 4 ? withEvo : fams;
  const out = [];
  while (out.length < Math.min(D().families.count, pool.length)) { const f = pool.splice(Math.floor(rnd() * pool.length), 1)[0]; out.push(f); }
  return out;
}
export const levelsList = () => CFG.defenseLevels.levels;

// zufällige Art, gewichtet wie am Automaten (häufige öfter, Legendäre sehr selten)
export function randomDex(rnd = Math.random, filter = () => true) {
  const balls = CFG.balance.gacha.balls;
  for (let k = 0; k < 20; k++) {
    let r = rnd() * balls.reduce((a, b) => a + b.weight, 0);
    const ball = balls.find((b) => (r -= b.weight) < 0) || balls[0];
    const list = CFG.dex.filter((p) => p.rarity === ball.rarity && bdata(p.dex) && filter(p));
    if (list.length) return list[Math.floor(rnd() * list.length)].dex;
  }
  const any = CFG.dex.filter((p) => bdata(p.dex) && filter(p));
  return any[Math.floor(rnd() * any.length)].dex;
}
// Leihteam für Spieler mit zu wenigen Pokémon: schwache, Sammler, mittlere und starke gemischt
export function loanerTeam(rnd = Math.random) {
  const L = D().loaner, out = [];
  const take = (n, test) => {
    const pool = CFG.dex.filter((p) => bdata(p.dex) && p.rarity !== 'legendaer' && !out.includes(p.dex) && test(p));
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0].dex);
  };
  const fighter = (p) => ['nahkampf', 'fernkampf'].includes(roleOf(p.dex));
  take(L.producers, (p) => roleOf(p.dex) === 'produzent');
  take(L.weak, (p) => fighter(p) && p.stage === 1 && costOf(p.dex) <= 50);
  take(L.medium, (p) => fighter(p) && p.stage === 2);
  take(L.strong, (p) => fighter(p) && p.stage >= 3);
  return out.map((dex, i) => fromCpu(dex, { id: 'leih' + Math.floor(rnd() * 1e9), ivs: [5, 25], evs: 0 }, i));
}

// Angekündigte Gegner-Typen einer Runde
export function rollTheme(rnd = Math.random) {
  const th = D().themes, list = [...th.types], out = [];
  while (out.length < th.count && list.length) out.push(list.splice(Math.floor(rnd() * list.length), 1)[0]);
  return out;
}
