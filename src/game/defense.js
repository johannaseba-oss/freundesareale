// Sternenverteidigung: Tower Defense wie Plants vs. Zombies, vertikal.
// Eigene Pokémon werden mit Sternen auf das untere Feld gesetzt, Gegner laufen in ihren Spalten von oben nach unten.
// Erreicht ein Gegner die untere Linie (Trainer), ist die Runde verloren; nach fünf abgewehrten Wellen gewonnen.
import { CFG, species } from '../config.js';
import { effectiveness } from './types.js';
import { calcStats, bdata, moveOf, rollIvs } from './battle.js';
import { mulberry32 } from '../rng.js';

const D = () => CFG.defense;
const bst = (dex) => bdata(dex).base.reduce((a, b) => a + b, 0);

// Rolle einer Art (siehe defense.json roles)
export function roleOf(dex) {
  const R = D().roles;
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
  const role = roleOf(dex), mv = moveOf(bdata(dex).move), R = D().roles;
  if (role === 'produzent') return `erzeugt alle ${R.produzent.every[0]}–${R.produzent.every[1]} s ${evolved(dex) ? R.produzent.valueEvolved : R.produzent.value} Sterne`;
  if (role === 'explosiv') return evolved(dex) ? 'explodiert sofort und trifft alles in der Nähe' : `Mine: explodiert, sobald ein Gegner sie erreicht (${R.explosiv.armSeconds} s scharf machen)`;
  if (role === 'mauer') return 'sehr robust – hält Gegner auf';
  const slow = mv.type === 'Eis' ? ', verlangsamt' : '';
  return role === 'nahkampf' ? `${mv.name}: starker Hieb aufs Feld davor${slow}` : `${mv.name}: schießt die Spalte hinauf${slow}`;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Vergleichswert für Tempo: Initiative eines Pokémon mit Basiswert 80 auf demselben Level
const refSpeed = (level) => Math.floor(((2 * 80 + 15) * level) / 100) + 5;

export class Defense {
  // team: [{uid, dex, gender, ivs, evs, nick}], theme: [Typen]
  constructor({ team, theme, seed = Date.now() }) {
    this.rnd = mulberry32(seed >>> 0);
    this.t = 0;
    this.theme = theme;
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
  }

  // ---- Platzieren ----
  canPlace(col, row) {
    const G = D().grid;
    return col >= 0 && col < G.cols && row >= G.placeRows[0] && row <= G.placeRows[1] && !this.units.some((u) => u.col === col && u.row === row);
  }
  cardReady(card) { return this.t >= card.readyAt && this.stars >= card.cost && !this.over; }
  place(card, col, row) {
    if (!this.cardReady(card) || !this.canPlace(col, row)) return false;
    this.stars -= card.cost;
    card.readyAt = this.t + card.recharge;
    const src = card.src, L = D().level, R = D().roles;
    const stats = calcStats(src.dex, L, src.ivs, src.evs);
    const hpMult = D().defenderHpMult * (card.role === 'mauer' ? R.mauer.hpMult : 1);
    const u = { id: this.nextId++, dex: src.dex, gender: src.gender, nick: src.nick, role: card.role, col, row, x: col + 0.5, y: row + 0.5, stats, maxHp: stats[0] * hpMult, cd: 0.8, placedAt: this.t };
    u.hp = u.maxHp;
    if (card.role === 'produzent') u.nextStar = this.t + this.between(R.produzent.every) * 0.5;
    if (card.role === 'explosiv') u.armAt = this.t + (evolved(u.dex) ? 0.8 : R.explosiv.armSeconds);
    this.units.push(u);
    this.events.push({ type: 'place', u });
    return true;
  }
  between([a, b]) { return a + this.rnd() * (b - a); }

  // ---- Sterne ----
  collect(drop) {
    if (!this.drops.includes(drop)) return 0;
    this.drops.splice(this.drops.indexOf(drop), 1);
    this.stars += drop.value;
    this.events.push({ type: 'collect', drop });
    return drop.value;
  }
  dropStar(x, y, fromY, value) { this.drops.push({ id: this.nextId++, x, y, fromY, value, born: this.t }); }

  // ---- Wellen ----
  startWave() {
    this.wave++;
    const W = D().waves[this.wave], th = D().themes;
    const level = D().level + this.wave * D().enemy.levelPerWave;
    for (let i = 0; i < W.count; i++) {
      const stage = W.stages[Math.floor(this.rnd() * W.stages.length)];
      const useTheme = this.rnd() < th.share;
      let pool = CFG.dex.filter((p) => bdata(p.dex) && p.rarity !== 'legendaer' && Math.min(3, p.stage) === stage && (!useTheme || p.types.some((t) => this.theme.includes(t))));
      if (!pool.length) pool = CFG.dex.filter((p) => bdata(p.dex) && p.rarity !== 'legendaer' && p.stage <= stage);
      const dex = pool[Math.floor(this.rnd() * pool.length)].dex;
      this.queue.push({ at: this.t + (W.final && i < 3 ? 0 : (i / W.count) * W.spread + this.rnd() * 3), dex, level, col: Math.floor(this.rnd() * D().grid.cols) });
    }
    this.queue.sort((a, b) => a.at - b.at);
    this.events.push({ type: 'wave', wave: this.wave, final: !!W.final });
  }
  spawn(q) {
    const st = calcStats(q.dex, q.level, rollIvs('g' + this.nextId, [0, 31]), [0, 0, 0, 0, 0, 0]);
    const e = { id: this.nextId++, dex: q.dex, x: q.col + 0.5, y: -0.4, col: q.col, stats: st, level: q.level, maxHp: st[0] * D().enemy.hpMult, cd: 0, slowUntil: 0 };
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
    return { dmg: eff ? Math.max(1, Math.round(base * stab * eff * mult * (0.9 + this.rnd() * 0.1))) : 0, eff, mv };
  }
  hurtEnemy(e, dmg, eff, from, mv) {
    if (e.hp <= 0) return;
    e.hp -= dmg; e.hurtT = this.t;
    if (mv?.type === 'Eis') e.slowUntil = this.t + D().iceSlow.seconds;
    this.events.push({ type: 'hit', target: e, dmg, eff, move: mv });
    if (e.hp <= 0) this.events.push({ type: 'defeat', e });
  }

  // ---- Simulation ----
  update(dt) {
    if (!this.started || this.over) return;
    this.t += dt;
    const G = D().grid, S = D().stars, R = D().roles, L = D().level;
    // Sternenregen
    if (this.t >= this.nextSky) {
      this.nextSky = this.t + this.between(S.skyEvery);
      this.dropStar(0.5 + this.rnd() * (G.cols - 1), 2 + this.rnd() * (G.rows - 3), -0.5, S.skyValue);
    }
    this.drops = this.drops.filter((d) => this.t - d.born < S.lifetime + 1.5);
    // Wellen
    if (this.wave < D().waves.length - 1 && this.t >= this.nextWaveAt && !this.queue.length) {
      this.startWave();
      const W = D().waves[this.wave];
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
      if (u.role === 'mauer') continue;
      if (u.role === 'explosiv') {
        if (this.t < u.armAt) continue;
        const big = evolved(u.dex);
        const trigger = big || this.enemies.some((e) => e.hp > 0 && e.col === u.col && Math.abs(e.y - u.y) < 0.6);
        if (!trigger) continue;
        const rad = big ? R.explosiv.radiusBig : R.explosiv.radiusSmall;
        for (const e of this.enemies) if (e.hp > 0 && dist(e, u) <= rad + 0.3) {
          const eff = effectiveness(moveOf(bdata(u.dex).move).type, species(e.dex).types) || 1;
          this.hurtEnemy(e, Math.round(R.explosiv.damage * Math.max(0.5, eff)), eff, u, null);
        }
        u.hp = 0;
        this.events.push({ type: 'explode', u, radius: rad });
        continue;
      }
      u.cd -= dt;
      if (u.cd > 0) continue;
      const melee = u.role === 'nahkampf', range = R[u.role].range;
      // nächster Gegner in der eigenen Spalte oberhalb (Nahkampf: direkt davor)
      let target = null;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.col !== u.col || e.y > u.y + 0.3 || e.y < -0.2) continue;
        const d = u.y - e.y;
        if (d <= range && (!target || e.y > target.y)) target = e;
      }
      if (!target) continue;
      const spd = u.stats[5] / refSpeed(L);
      u.cd = R[u.role].cooldown / Math.max(0.7, Math.min(1.4, Math.pow(spd, 0.3)));
      u.anim = { name: melee ? 'Attack' : 'Shoot', t0: this.t };
      if (melee) { const r = this.damage(u, L, target, R.nahkampf.damageMult); this.hurtEnemy(target, r.dmg, r.eff, u, r.mv); }
      else this.projectiles.push({ x: u.x, y: u.y - 0.3, col: u.col, from: u, type: moveOf(bdata(u.dex).move).type });
    }
    // Geschosse fliegen die Spalte hinauf und treffen den ersten Gegner
    this.projectiles = this.projectiles.filter((p) => {
      p.y -= 6 * dt;
      const hit = this.enemies.find((e) => e.hp > 0 && e.col === p.col && Math.abs(e.y - p.y) < 0.35);
      if (hit) { const r = this.damage(p.from, L, hit, R.fernkampf.damageMult); this.hurtEnemy(hit, r.dmg, r.eff, p.from, r.mv); return false; }
      return p.y > -1;
    });
    // Gegner laufen nach unten, beißen eigene Pokémon, die im Weg stehen
    const E = D().enemy;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const block = this.units.find((u) => u.hp > 0 && u.col === e.col && u.y - e.y > 0 && u.y - e.y < 0.75 && u.role !== 'explosiv');
      if (block) {
        e.cd -= dt; e.eating = true;
        if (e.cd <= 0) {
          e.cd = E.biteCooldown; e.anim = { name: 'Attack', t0: this.t };
          const r = this.damage(e, e.level, block);
          block.hp -= r.dmg; block.hurtT = this.t;
          this.events.push({ type: 'hit', target: block, dmg: r.dmg, eff: r.eff, move: r.mv, mine: true });
          if (block.hp <= 0) this.events.push({ type: 'lost', u: block });
        }
        continue;
      }
      e.eating = false;
      const sp = E.tilesPerSecond * Math.pow(e.stats[5] / refSpeed(e.level), E.speedExp) * (this.t < e.slowUntil ? D().iceSlow.factor : 1);
      e.y += sp * dt;
      if (e.y >= G.rows) { this.over = { won: false, t: this.t, by: e }; return; }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0 || this.t - (e.hurtT || 0) < 0.5);
    this.units = this.units.filter((u) => u.hp > 0 || this.t - (u.hurtT || u.placedAt) < 0.5);
    // Sieg: alle Wellen vorbei, nichts mehr unterwegs
    if (this.wave === D().waves.length - 1 && !this.queue.length && !this.enemies.some((e) => e.hp > 0)) this.over = { won: true, t: this.t };
  }
  waveProgress() { return { wave: Math.max(0, this.wave + 1), total: D().waves.length }; }
}

// Angekündigte Gegner-Typen einer Runde
export function rollTheme(rnd = Math.random) {
  const th = D().themes, list = [...th.types], out = [];
  while (out.length < th.count && list.length) out.push(list.splice(Math.floor(rnd() * list.length), 1)[0]);
  return out;
}
