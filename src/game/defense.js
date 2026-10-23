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

// Angriffstempo: Faktor auf die Abklingzeit nach Stärke der Attacke (stark = langsamer, schwach = schneller).
// Der Schaden hängt ohnehin von der Attackenstärke ab – so gibt es harte, langsame und schnelle, leichte Angreifer.
export function tempoOf(dex) {
  const T = D().tempo, mv = moveOf(bdata(dex).move);
  if (!T || !mv?.power) return 1;
  return Math.max(T.min, Math.min(T.max, mv.power / T.refPower));
}
export const tempoLabel = (dex) => { const k = tempoOf(dex), T = D().tempo; return !T ? '' : k >= T.slowFrom ? 'langsam, hart' : k <= T.fastBelow ? 'schnell, leicht' : ''; };

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
  return role === 'nahkampf' ? `${mv.name}: starker Hieb, reicht 2 Felder weit${slow}` : `${mv.name}: schießt die Spalte hinauf${slow}`;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Lage eines Gegners aus Sicht des Pokémon: fwd = Abstand in Angriffsrichtung, lat = seitlicher Versatz
// (Mitte: die Spalte hinauf, Seitenfeld: quer über die eigene Reihe)
const aim = (u, e) => (u.dir ? { fwd: (e.x - u.x) * u.dir, lat: Math.abs(e.y - u.y) } : { fwd: u.y - e.y, lat: Math.abs(e.x - u.x) });
// Chaos: Sammler kämpfen normal (es gibt keine Sterne)
function chaosRole(dex) {
  const role = roleOf(dex);
  return role === 'produzent' ? (moveOf(bdata(dex).move)?.range === 'nah' ? 'nahkampf' : 'fernkampf') : role;
}
// true, wenn sich from (direkt oder über Zwischenstufen) zu to entwickelt
export function evolvesInto(from, to) {
  const seen = new Set(), list = [from];
  while (list.length) {
    const d = list.shift();
    for (const e of bdata(d)?.evos || []) { if (e.to === to) return true; if (!seen.has(e.to)) { seen.add(e.to); list.push(e.to); } }
  }
  return false;
}
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
    this.endless = chaos; // Chaos: endlose Wellen, jede große Welle mit eigenem Gegner-Thema
    this.waves = this.endless ? [] : buildWaves(level);
    this.families = pickFamilies(level, mulberry32(chaos ? seed : level.n * 7919));
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
    this.lives = 0; this.livesBought = 0; this.bossWaves = 0; this.nextTrickle = 0;
    this.prepLeft = null;
    if (chaos) {
      this.stars = 0;
      for (let i = 0; i < D().chaos.startCards; i++) this.addChaosCard(randomDex(this.rnd, undefined, D().chaos.cards?.weights));
      this.lives = D().chaos.lives.start;
      this.prepLeft = D().chaos.prepSeconds; // Countdown statt unbegrenzter Vorbereitung
    }
  }
  // Chaos: einmalige Karte mit einem zufälligen Pokémon (kostenlos, verschwindet nach dem Einsetzen)
  addChaosCard(dex) {
    if (this.cards.length >= D().chaos.handMax) return false;
    const src = fromCpu(dex, { id: 'chaos' + this.nextId, ivs: [0, 31], evs: 0 }, this.nextId++);
    this.cards.push({ src, dex, role: chaosRole(dex), cost: 0, recharge: 0, readyAt: 0, once: true, id: this.nextId++ });
    return true;
  }
  // Preis des nächsten Extra-Lebens (steigt mit jedem Kauf)
  lifePrice() {
    const L = D().chaos.lives, i = this.livesBought;
    return i < L.prices.length ? L.prices[i] : Math.round(L.prices[L.prices.length - 1] * Math.pow(L.growth, i - L.prices.length + 1));
  }
  addLife() { this.lives++; this.livesBought++; this.events.push({ type: 'lifeBought' }); }

  // Chaos: Weiterentwicklung auf ein bereits platziertes Pokémon setzen – es entwickelt sich auf seinem Feld
  canUpgrade(card, u) { return this.chaos && !!card?.once && u.hp > 0 && evolvesInto(u.dex, card.dex); }
  upgrade(card, u) {
    if (!this.canUpgrade(card, u) || this.over) return false;
    this.cards.splice(this.cards.indexOf(card), 1);
    const from = u.dex;
    u.dex = card.dex;
    u.exp = Math.max(u.exp, expForLevel(u.dex, u.level)); // Level-Fortschritt bleibt erhalten
    u.role = chaosRole(u.dex);
    u.hpMult = this.hpMultOf(u.dex, u.role);
    this.restat(u);
    const ab = abilityOf(u.dex);
    if (u.role === 'explosiv') u.armAt = this.t + (ab?.type === 'reactive' ? 0 : 0.8);
    if (ab?.type === 'heal') u.nextHeal = this.t + ab.every * 0.5;
    this.events.push({ type: 'evolve', u, from, to: u.dex });
    return true;
  }
  hpMultOf(dex, role) {
    const ab = abilityOf(dex);
    return D().defenderHpMult * (ab?.type === 'shield' ? ab.hpMult : role === 'mauer' ? D().roles.mauer.hpMult : 1);
  }

  // ---- Platzieren ----
  // oberste freie Reihe: anfangs nur die untersten startRows, mit jeder Welle rowsPerWave mehr
  minRow() {
    const G = D().grid;
    const span = G.placeRows[1] - G.placeRows[0] + 1 - (G.startRows || 0);
    const total = this.endless ? 6 : this.waves.length;
    const open = (G.startRows || 99) + Math.min(span, Math.floor(Math.max(0, this.wave + 1) * Math.max(G.rowsPerWave || 0, span / Math.max(1, total * 0.6))));
    return Math.max(G.placeRows[0], G.placeRows[1] - open + 1);
  }
  // Chaos: seitliche Felder links (Spalte -1) und rechts (Spalte cols) neben dem Spielfeld
  isSide(col, row) {
    const G = D().grid, S = G.side;
    return !!S && (col === -1 || col === G.cols) && row >= S.rows[0] && row <= S.rows[1];
  }
  canPlace(col, row) {
    const G = D().grid;
    const inField = col >= 0 && col < G.cols && row >= this.minRow() && row <= G.placeRows[1];
    return (inField || this.isSide(col, row)) && !this.units.some((u) => u.col === col && u.row === row);
  }
  cardReady(card) { return this.t >= card.readyAt && this.stars >= card.cost && !this.over; }
  place(card, col, row) {
    if (!this.cardReady(card) || !this.canPlace(col, row)) return false;
    this.stars -= card.cost;
    card.readyAt = this.t + card.recharge;
    if (card.once) this.cards.splice(this.cards.indexOf(card), 1);
    const src = card.src, R = D().roles;
    const L = this.chaos // Chaos: knapp unter dem Level der aktuellen Gegner
      ? Math.max(D().level, (this.chaosLevel ?? (this.endless ? D().chaos.endless.baseLevel : this.level.enemyLevel)) - (D().chaos.cards?.levelGap ?? 2))
      : Math.max(D().level, (this.level?.enemyLevel || 0) - (D().levelGap ?? 99)); // spätere Level: eigene Pokémon starten stärker
    const keep = card.keep && card.keep.level > L ? card.keep : null; // zurückgenommenes Pokémon behält sein Level
    const stats = calcStats(src.dex, keep ? keep.level : L, src.ivs, src.evs);
    const ab = abilityOf(src.dex);
    const hpMult = this.hpMultOf(src.dex, card.role);
    // dir: 0 = greift die eigene Spalte hinauf an, ±1 = Seitenfeld, greift quer über das Feld an
    const dir = col < 0 ? 1 : col >= D().grid.cols ? -1 : 0;
    const u = { id: this.nextId++, dex: src.dex, gender: src.gender, nick: src.nick, ivs: src.ivs, evs: src.evs, hpMult, level: keep ? keep.level : L, exp: keep ? keep.exp : expForLevel(src.dex, L), role: card.role, col, row, x: col + 0.5, y: row + 0.5, dir, stats, maxHp: stats[0] * hpMult, cd: 0.8, placedAt: this.t };
    u.hp = u.maxHp;
    if (card.role === 'produzent') u.nextStar = this.t + this.between(R.produzent.every) * 0.5;
    if (card.role === 'explosiv') u.armAt = this.t + (ab?.type === 'reactive' ? 0 : evolved(u.dex) ? 0.8 : R.explosiv.armSeconds);
    if (ab?.type === 'heal') u.nextHeal = this.t + ab.every * 0.5;
    this.units.push(u);
    this.events.push({ type: 'place', u });
    return true;
  }
  // eigenes Pokémon auf ein anderes freies Feld verschieben (Drag & Drop)
  moveUnit(u, col, row) {
    if (u.hp <= 0 || this.over || (u.col === col && u.row === row) || !this.canPlace(col, row)) return false;
    u.col = col; u.row = row; u.x = col + 0.5; u.y = row + 0.5;
    u.dir = col < 0 ? 1 : col >= D().grid.cols ? -1 : 0; // Seitenfeld: greift zur Mitte hin an
    u.placedAt = this.t;
    this.events.push({ type: 'place', u });
    return true;
  }
  // eigenes Pokémon zurück auf die Hand nehmen (Platz wird frei). Chaos: es wird wieder eine Karte – mit seiner
  // aktuellen Form und seinem Level; normale Level: die Karte ist ohnehin auf der Hand und lädt wie gewohnt.
  canTakeBack() { return !this.chaos || this.cards.length < D().chaos.handMax; }
  takeBack(u) {
    const i = this.units.indexOf(u);
    if (i < 0 || u.hp <= 0 || !this.canTakeBack()) return false;
    this.units.splice(i, 1);
    if (this.chaos) this.cards.push({ src: { dex: u.dex, gender: u.gender, nick: u.nick, ivs: u.ivs, evs: u.evs }, dex: u.dex, role: chaosRole(u.dex), cost: 0, recharge: 0, readyAt: 0, once: true, id: this.nextId++, keep: { level: u.level, exp: u.exp } });
    this.events.push({ type: 'remove', u });
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
    const dex = this.chaos ? randomDex(this.rnd, undefined, D().chaos.cards?.weights) : null;
    this.drops.push({ id: this.nextId++, x, y, fromY, value, born: this.t, dex });
  }

  // ---- Wellen ----
  startWave() {
    this.wave++;
    let level, p;
    if (this.endless) { // Chaos: nächste Welle erzeugen – jede große Welle mit neuen Gegner-Typen
      const E = D().chaos.endless;
      this.waves.push({ count: Math.round((E.base + this.wave * E.perWave) * (D().chaos.countMult || 1)), spread: 28, final: false });
      this.rollWaveTheme();
      level = Math.round(E.baseLevel + this.wave * E.levelPerWave);
      this.chaosLevel = level;
      p = Math.min(1, this.wave / 10);
    } else {
      level = this.level.enemyLevel + this.wave * D().enemy.levelPerWave;
      // Entwicklungsstufe steigt über die Wellen: erst Grundformen, gelegentlich Zweitentwicklungen, zum Schluss Endentwicklungen
      p = this.waves.length > 1 ? this.wave / (this.waves.length - 1) : 1;
    }
    this.waveLevel = level; this.waveP = p;
    const W = this.waves[this.wave], spread = this.chaos ? D().chaos.flow.bigSpread : W.spread;
    for (let i = 0; i < W.count; i++) {
      const fast = this.endless && this.rnd() < D().chaos.fast.chance;
      this.queue.push({ at: this.t + (W.final && i < 3 ? 0 : (i / W.count) * spread + this.rnd() * 3), dex: this.rollEnemy(), level, col: Math.floor(this.rnd() * D().grid.cols), fast });
    }
    const Bo = D().chaos.boss;
    // Chaos: ab fromWave ein Boss pro Welle (passend zum Thema der Welle), später mit Leibwächtern in den Nachbarspalten
    if (this.chaos && this.wave + 1 >= (Bo.fromWave || 2)) {
      // in den ersten soloWaves Boss-Wellen: höchstens ein Boss gleichzeitig, ohne Leibwächter
      const solo = this.bossWaves < (Bo.soloWaves ?? 0);
      if (!(solo && this.enemies.some((e) => e.boss && e.hp > 0))) {
        this.bossWaves++;
        const at = this.t + spread * (0.35 + this.rnd() * 0.3), col = Math.floor(this.rnd() * D().grid.cols);
        const strong = this.families.map((fm) => fm[fm.length - 1]);
        this.queue.push({ at, dex: strong[Math.floor(this.rnd() * strong.length)], level: level + 3, col, boss: true });
        const n = solo ? 0 : Bo.guards[0] + Math.floor(this.rnd() * (Bo.guards[1] - Bo.guards[0] + 1));
        for (let g = 0; g < n; g++) {
          const gc = Math.max(0, Math.min(D().grid.cols - 1, col + (g % 2 ? 1 : -1) * Math.ceil((g + 1) / 2)));
          const fam = this.families[Math.floor(this.rnd() * this.families.length)];
          this.queue.push({ at: at + 0.3 + g * 0.25, dex: fam[Math.min(1, fam.length - 1)], level, col: gc === col ? (col + 1) % D().grid.cols : gc, guard: true });
        }
      }
    }
    this.queue.sort((a, b) => a.at - b.at);
    this.events.push({ type: 'wave', wave: this.wave, final: !!W.final, minRow: this.minRow(), types: this.endless ? this.theme : null });
  }
  // Chaos: Gegner-Thema für die nächste große Welle – andere Typen als in der Welle davor
  rollWaveTheme() {
    const C = D().chaos.waveTypes, all = D().themes.types, prev = this.wave > 0 ? this.theme || [] : [];
    const n = C.count[0] + Math.floor(this.rnd() * (C.count[1] - C.count[0] + 1));
    let pool = all.filter((t) => !prev.includes(t));
    const types = [];
    while (types.length < n && pool.length) types.push(pool.splice(Math.floor(this.rnd() * pool.length), 1)[0]);
    this.theme = types;
    this.families = pickFamilies({ types }, this.rnd);
    this.otherFamilies = pickFamilies({ types: all.filter((t) => !types.includes(t)) }, this.rnd); // für die Ausnahmen
  }
  // Gegnerart passend zur aktuellen Welle: früh Grundformen, später Entwicklungen
  rollEnemy() {
    const p = this.waveP ?? 0;
    const weights = [Math.max(0.05, 1 - p * 0.9), 0.12 + p * 0.9, this.level.finalStage >= 3 ? Math.max(0, (p - 0.4) * 1.6) : 0];
    let r = this.rnd() * weights.reduce((a, b) => a + b, 0), stage = 1;
    for (let k = 0; k < 3; k++) { if ((r -= weights[k]) < 0) { stage = k + 1; break; } }
    // Chaos: ein Teil der Gegner (exceptionShare) kommt als Ausnahme aus anderen Typen
    const list = this.endless && this.otherFamilies?.length && this.rnd() < D().chaos.waveTypes.exceptionShare ? this.otherFamilies : this.families;
    const fam = list[Math.floor(this.rnd() * list.length)];
    return fam[Math.min(stage, fam.length) - 1];
  }
  // Chaos: kleine Gruppe (1–3 Gegner) auf einer Spalte zwischen den großen Wellen
  trickle() {
    const F = D().chaos.flow, n = F.group[0] + Math.floor(this.rnd() * (F.group[1] - F.group[0] + 1));
    const col = Math.floor(this.rnd() * D().grid.cols);
    let at = this.t;
    for (let i = 0; i < n; i++) {
      this.queue.push({ at, dex: this.rollEnemy(), level: this.waveLevel, col, fast: this.endless && this.rnd() < D().chaos.fast.chance });
      at += this.between(F.groupGap);
    }
    this.queue.sort((a, b) => a.at - b.at);
  }
  spawn(q) {
    const st = calcStats(q.dex, q.level, rollIvs('g' + this.nextId, [0, 31]), [0, 0, 0, 0, 0, 0]);
    const v = D().enemy.speedVariation || [1, 1];
    const e = { id: this.nextId++, dex: q.dex, x: q.col + 0.5, y: -0.4, col: q.col, stats: st, level: q.level, maxHp: st[0] * D().enemy.hpMult, cd: 0, slowUntil: 0, pace: v[0] + this.rnd() * (v[1] - v[0]) };
    if (q.fast) { e.pace *= D().chaos.fast.pace; e.fast = true; }
    if (q.boss) { // sehr stark: viel mehr KP, bessere Verteidigung, etwas langsamer
      const Bo = D().chaos.boss;
      e.boss = true; e.maxHp *= Bo.hpMult; e.pace *= Bo.pace;
      e.stats = e.stats.map((v, i) => (i === 2 || i === 4 ? Math.round(v * Bo.defMult) : v));
      this.events.push({ type: 'boss', e });
    }
    if (q.guard) e.guard = true;
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
    // Gift, Feuer und Elektro hinterlassen einen Statuseffekt, der regelmäßig Schaden macht (je Typ einer, neuer Treffer frischt ihn auf)
    const dot = mv && D().dots?.[mv.type];
    if (dot && from?.dex && e.hp > 0) (e.dots ||= {})[mv.type] = { until: this.t + dot.seconds, dps: e.maxHp * dot.pctPerSecond, from, tick: 0 };
    const ab = from?.dex ? abilityOf(from.dex) : null;
    if (!this.chaos && e.hp > 0 && this.rnd() < (ab?.chance || 0)) this.applyStatus(e, ab); // Chaos: Status wirkt stattdessen als Fläche
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
  // Schlaf/Verwirrung auf einen Gegner anwenden
  applyStatus(e, ab) {
    if (ab?.type === 'confuse') { e.confusedUntil = this.t + ab.seconds; this.events.push({ type: 'confuse', e }); }
    if (ab?.type === 'sleep' && this.t >= (e.sleepUntil || 0)) { e.sleepUntil = this.t + ab.seconds; this.events.push({ type: 'sleep', e }); }
  }
  // Gegner im Quadrat aus (2·a+1)² Feldern um das Pokémon (a = 1: 3×3)
  inArea(u, a) { return this.enemies.filter((e) => e.hp > 0 && e.y > -0.2 && Math.abs(e.x - u.x) <= a + 0.5 && Math.abs(e.y - u.y) <= a + 0.5); }
  explode(u, rad, damage) {
    if (this.chaos) { // Chaos: Explosion trifft alles im 3×3-Bereich, in alle Richtungen
      const a = D().chaos.explosionArea;
      for (const e of this.inArea(u, a)) {
        const eff = effectiveness(moveOf(bdata(u.dex).move).type, species(e.dex).types) || 1;
        this.hurtEnemy(e, Math.round(damage * Math.max(0.5, eff)), eff, u, null);
      }
      u.hp = 0;
      this.events.push({ type: 'explode', u, radius: a + 0.5, square: true });
      return;
    }
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
    if (this.over) return;
    if (!this.started) { // Chaos: Countdown, danach geht der Angriff los
      if (this.prepLeft == null) return;
      this.prepLeft -= dt;
      if (this.prepLeft > 0) return;
      this.prepLeft = 0; this.started = true; this.nextWaveAt = this.t;
      this.events.push({ type: 'go' });
    }
    this.t += dt;
    const G = D().grid, S = D().stars, R = D().roles, L = D().level;
    if (this.t >= this.weatherNext) { this.weather = pickWeather(this.rnd, this.weather); this.weatherNext = this.t + nextWeatherIn(this.rnd); this.events.push({ type: 'weather', weather: this.weather }); }
    // Sternenregen
    if (this.t >= this.nextSky) {
      this.nextSky = this.t + this.between(this.chaos ? D().chaos.dropEvery : S.skyEvery);
      if (this.chaos) { // links oder rechts neben dem Trainer, damit er nicht verdeckt wird; gelegentlich mehrere Bälle auf einmal
        const M = D().chaos.multiDrop, n = M && this.rnd() < M.chance ? M.count[0] + Math.floor(this.rnd() * (M.count[1] - M.count[0] + 1)) : 1;
        for (let i = 0; i < n; i++) {
          const side = this.rnd() < 0.5 ? -1 : 1, x = G.cols / 2 + side * (0.75 + this.rnd() * (G.cols / 2 - 1.1));
          this.dropStar(x, G.rows + 0.5, -0.5 - i * 0.8, S.skyValue); // leicht versetzt nacheinander
        }
      } else this.dropStar(0.5 + this.rnd() * (G.cols - 1), 2 + this.rnd() * (G.rows - 3), -0.5, S.skyValue);
    }
    this.drops = this.drops.filter((d) => this.t - d.born < S.lifetime + 1.5);
    // Wellen
    const moreWaves = this.endless || this.wave < this.waves.length - 1;
    if (this.chaos) { // Chaos: alle bigEvery s eine große Welle, dazwischen kleine Gruppen
      const F = D().chaos.flow;
      if (moreWaves && this.t >= this.nextWaveAt) { this.startWave(); this.nextWaveAt = this.t + F.bigEvery; this.nextTrickle = this.t + F.bigSpread; }
      else if (moreWaves && this.wave >= 0 && this.t >= this.nextTrickle) { this.trickle(); this.nextTrickle = this.t + this.between(F.trickleEvery) * (1 - (1 - (F.trickleLate ?? 1)) * (this.waveP ?? 0)); }
    } else if (moreWaves && this.t >= this.nextWaveAt && !this.queue.length) {
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
      // Chaos: Schlafpuder & Co. wirken auf alle Gegner im 3×3-Bereich um das Pokémon
      if (this.chaos && (ab?.type === 'sleep' || ab?.type === 'confuse') && this.t >= (u.nextStatus || 0)) {
        const SA = D().chaos.statusArea, near = this.inArea(u, SA.area);
        if (near.length) {
          u.nextStatus = this.t + SA.every;
          this.events.push({ type: 'statusArea', u, area: SA.area, kind: ab.type });
          for (const e of near) if (this.rnd() < ab.chance) this.applyStatus(e, ab);
        }
      }
      if (u.role === 'mauer') continue;
      if (u.role === 'explosiv') {
        if (ab?.type === 'reactive') continue; // explodiert erst, wenn es angegriffen wird
        if (this.t < u.armAt) continue;
        const big = evolved(u.dex);
        // Chaos: zündet auch, wenn ein Gegner neben ihm vorbeiläuft (Seitenfelder)
        const trigger = big || this.enemies.some((e) => e.hp > 0 && Math.abs(e.y - u.y) < 0.6 && (this.chaos || u.dir ? Math.abs(e.x - u.x) < 1.5 : e.col === u.col));
        if (!trigger) continue;
        this.explode(u, big ? R.explosiv.radiusBig : R.explosiv.radiusSmall, R.explosiv.damage);
        continue;
      }
      u.cd -= dt;
      if (u.cd > 0) continue;
      const mv = moveOf(bdata(u.dex).move), rule = this.chaos ? D().chaos.moves?.[mv.name] : null; // Chaos: durchdringende Attacken
      const melee = u.role === 'nahkampf', range = ab?.type === 'beam' ? ab.length + 0.3 : ab?.type === 'boomerang' ? ab.range : rule ? rule.range : R[u.role].range;
      // nächster Gegner in Angriffsrichtung (Mitte: die eigene Spalte hinauf, Seitenfeld: quer über die Reihe)
      let target = null, best = Infinity;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.y < -0.2) continue;
        const a = aim(u, e);
        if (a.lat < (rule?.width ? rule.width / 2 : 0.5) && a.fwd >= -0.3 && a.fwd <= range && a.fwd < best) { target = e; best = a.fwd; }
      }
      if (!target) continue;
      const spd = u.stats[5] / refSpeed(u.level);
      u.cd = (R[u.role].cooldown * tempoOf(u.dex)) / Math.max(0.7, Math.min(1.4, Math.pow(spd, 0.3)));
      u.anim = { name: melee ? 'Attack' : 'Shoot', t0: this.t };
      this.events.push({ type: 'shoot', u, moveType: mv.type, melee });
      const [dx, dy] = u.dir ? [u.dir, 0] : [0, -1], x0 = u.x + dx * 0.3, y0 = u.y + dy * 0.3;
      if (ab?.type === 'beam') { // Strahl: trifft alle Gegner in length Feldern
        this.events.push({ type: 'beam', u, length: ab.length, fx: ab.fx });
        for (const e of this.enemies) { const a = aim(u, e); if (e.hp > 0 && a.lat < 0.5 && a.fwd > -0.2 && a.fwd <= ab.length + 0.3) { const r = this.damage(u, u.level, e, ab.mult || 1); this.hurtEnemy(e, r.dmg, r.eff, u, r.mv, r.crit); } }
      } else if (ab?.type === 'boomerang') {
        this.projectiles.push({ x: x0, y: y0, x0, y0, dx, dy, dist: 0, from: u, type: mv.type, boomerang: true, out: true, range: ab.range, hits: new Set(), left: ab.pierce, ab });
      } else if (rule?.width) { // Wolke: trifft alle Gegner in der Fläche vor dem Pokémon
        this.events.push({ type: 'cloud', u, range: rule.range, width: rule.width, moveType: mv.type });
        for (const e of this.enemies) { const a = aim(u, e); if (e.hp > 0 && a.lat < rule.width / 2 && a.fwd > -0.3 && a.fwd <= rule.range) { const r = this.damage(u, u.level, e, R[u.role].damageMult); this.hurtEnemy(e, r.dmg, r.eff, u, r.mv, r.crit); } }
      } else if (melee) { const r = this.damage(u, u.level, target, R.nahkampf.damageMult); this.hurtEnemy(target, r.dmg, r.eff, u, r.mv, r.crit); }
      else this.projectiles.push({ x: x0, y: y0, vx: dx * 6, vy: dy * 6, dist: 0, from: u, type: mv.type, range: rule ? rule.range : 99, left: rule ? rule.pierce : 1, hits: new Set() });
    }
    // Geschosse fliegen in Angriffsrichtung; durchdringende treffen bis zu left Gegner innerhalb ihrer Reichweite
    this.projectiles = this.projectiles.filter((p) => {
      if (p.boomerang) return this.flyBoomerang(p, dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.dist += 6 * dt;
      for (const e of this.enemies) {
        if (p.left <= 0 || e.hp <= 0 || p.hits.has(e.id) || Math.abs(e.x - p.x) > 0.45 || Math.abs(e.y - p.y) > 0.35) continue;
        p.hits.add(e.id); p.left--;
        const r = this.damage(p.from, p.from.level, e, R.fernkampf.damageMult); this.hurtEnemy(e, r.dmg, r.eff, p.from, r.mv, r.crit);
      }
      return p.left > 0 && p.dist <= p.range + 0.3 && p.y > -1 && p.x > -2 && p.x < G.cols + 2;
    });
    // Gegner laufen nach unten, beißen eigene Pokémon, die im Weg stehen
    const E = D().enemy;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      // Statuseffekte (Gift, Verbrennung, Elektroschock): Schaden über Zeit, Anzeige alle 0,5 s
      let died = false;
      for (const [type, st] of Object.entries(e.dots || {})) {
        if (this.t >= st.until) { delete e.dots[type]; continue; }
        const d = st.dps * dt;
        e.hp -= d; st.tick += d;
        if (st.tick >= Math.max(1, st.dps * 0.5)) { this.events.push({ type: 'dot', e, dot: type, dmg: Math.round(st.tick) }); st.tick = 0; }
        if (e.hp <= 0) { e.hurtT = this.t; this.events.push({ type: 'defeat', e }); if (st.from.hp > 0) this.reward(st.from, e); died = true; break; }
      }
      if (died) continue;
      // schläft (Schlafpuder): bleibt stehen und greift nicht an
      if (this.t < (e.sleepUntil || 0)) { e.eating = false; continue; }
      // verwirrt: dreht um, greift Gegner hinter sich an oder trifft sich selbst
      if (this.t < (e.confusedUntil || 0)) {
        e.cd -= dt; e.eating = false;
        const other = this.enemies.find((o) => o !== e && o.hp > 0 && o.col === e.col && e.y - o.y > 0 && e.y - o.y < 0.8);
        if (e.cd <= 0) {
          e.cd = E.biteCooldown * tempoOf(e.dex); e.anim = { name: 'Attack', t0: this.t };
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
          e.cd = E.biteCooldown * tempoOf(e.dex); e.anim = { name: 'Attack', t0: this.t };
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
      if (e.y >= G.rows) {
        if (this.lives > 0) { this.lives--; e.hp = 0; e.hurtT = this.t; this.events.push({ type: 'lifeLost', e }); continue; } // Chaos: ein Leben verloren
        this.over = { won: false, t: this.t, by: e }; return;
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0 || this.t - (e.hurtT || 0) < 0.5);
    this.units = this.units.filter((u) => u.hp > 0 || this.t - (u.hurtT || u.placedAt) < 0.5);
    // Sieg: alle Wellen vorbei, nichts mehr unterwegs
    if (!this.endless && this.wave === this.waves.length - 1 && !this.queue.length && !this.enemies.some((e) => e.hp > 0)) this.over = { won: true, t: this.t };
  }
  // Knochenbumerang: hin bis range, dann zurück; durchschlägt je Richtung pierce Gegner (zurück schwächer)
  flyBoomerang(p, dt) {
    p.spin = (p.spin || 0) + dt * 18;
    p.dist += (p.out ? 5 : -5) * dt;
    if (p.out && p.dist >= p.range) { p.out = false; p.hits = new Set(); p.left = p.ab.pierce; }
    p.x = p.x0 + p.dx * p.dist; p.y = p.y0 + p.dy * p.dist;
    for (const e of this.enemies) {
      if (p.left <= 0 || e.hp <= 0 || p.hits.has(e.id) || Math.abs(e.x - p.x) > 0.45 || Math.abs(e.y - p.y) > 0.35) continue;
      p.hits.add(e.id); p.left--;
      const r = this.damage(p.from, p.from.level, e, p.out ? 1 : p.ab.backMult);
      this.hurtEnemy(e, r.dmg, r.eff, p.from, r.mv, r.crit);
    }
    return p.out || p.dist > 0;
  }
  waveProgress() { return { wave: Math.max(0, this.wave + 1), total: this.endless ? null : this.waves.length }; }

  // ---- Pause & Speichern (Chaos) ----
  // Kompletter Kampfzustand als JSON: Verweise (Gift-Verursacher, Geschoss-Schütze) werden als Pokémon-Nummer abgelegt
  snapshot() {
    const data = {};
    for (const [k, v] of Object.entries(this)) if (k !== 'rnd' && k !== 'events') data[k] = v;
    data.enemies = this.enemies.map((e) => (e.dots ? { ...e, dots: Object.fromEntries(Object.entries(e.dots).map(([k, v]) => [k, { ...v, from: v.from?.id ?? null }])) } : e));
    data.projectiles = this.projectiles.map((p) => ({ ...p, from: p.from.id, hits: [...p.hits] }));
    return JSON.parse(JSON.stringify(data));
  }
  static restore(data) {
    const g = Object.create(Defense.prototype);
    Object.assign(g, JSON.parse(JSON.stringify(data)));
    g.rnd = mulberry32((Date.now() ^ (g.nextId * 7919)) >>> 0);
    g.events = [];
    const byId = new Map(g.units.map((u) => [u.id, u]));
    for (const e of g.enemies) {
      if (e.poison) { (e.dots ||= {}).Gift = e.poison; delete e.poison; } // ältere Spielstände
      for (const st of Object.values(e.dots || {})) st.from = byId.get(st.from) || { hp: 0 };
    }
    g.projectiles = g.projectiles.filter((p) => byId.has(p.from)).map((p) => ({ ...p, from: byId.get(p.from), hits: new Set(p.hits) }));
    return g;
  }
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
export function randomDex(rnd = Math.random, filter = () => true, weights = null) {
  const balls = weights ? Object.entries(weights).map(([rarity, weight]) => ({ rarity, weight })) : CFG.balance.gacha.balls;
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

// Empfohlenes, ausgewogenes Team: 2 Sternensammler, 1 Mauer, 1 Mine (falls vorhanden), dazu die stärksten Kämpfer
// gegen die Gegner-Typen – gemischt aus Nah- und Fernkampf. mons: eigene Pokémon, theme: Gegner-Typen.
export function recommendTeam(mons, theme, N = D().teamSize) {
  const R = D().teamRecommend || { producers: 2, walls: 1, mines: 1 };
  const power = (p) => { const mv = moveOf(bdata(p.dex).move); const eff = Math.max(...theme.map((t) => effectiveness(mv.type, [t]))); return eff * (mv.power || 40) * (1 + (p.level || 1) / 50) * Math.sqrt(bst(p.dex)); };
  const by = (role) => mons.filter((p) => roleOf(p.dex) === role).sort((a, b) => bst(b.dex) - bst(a.dex));
  const out = [], seen = new Set();
  const add = (p) => { if (p && out.length < N && !seen.has(p.dex)) { out.push(p); seen.add(p.dex); } }; // keine doppelte Art
  by('produzent').slice(0, R.producers).forEach(add);
  by('mauer').slice(0, R.walls).forEach(add);
  by('explosiv').slice(0, R.mines).forEach(add);
  const fighters = mons.filter((p) => ['nahkampf', 'fernkampf'].includes(roleOf(p.dex))).sort((a, b) => power(b) - power(a));
  // abwechselnd Fern- und Nahkampf, solange beide da sind
  const ranged = fighters.filter((p) => roleOf(p.dex) === 'fernkampf'), melee = fighters.filter((p) => roleOf(p.dex) === 'nahkampf');
  while (out.length < N && (ranged.length || melee.length)) { add(ranged.shift()); add(melee.shift()); }
  for (const p of [...mons].sort((a, b) => power(b) - power(a))) add(p); // auffüllen
  return out.map((p) => p.uid);
}

// Angekündigte Gegner-Typen einer Runde
export function rollTheme(rnd = Math.random) {
  const th = D().themes, list = [...th.types], out = [];
  while (out.length < th.count && list.length) out.push(list.splice(Math.floor(rnd() * list.length), 1)[0]);
  return out;
}
