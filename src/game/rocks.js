// Felsbrecher: Wettbewerb angelehnt an Piano Tiles. In jeder Reihe liegt ein Fels in einer zufälligen Spalte;
// die Reihen rollen nach unten. Ein Fels braucht je nach Kraft 5…1 Tipper, Tempo legt den Mindestabstand zwischen Tippern fest.
// Erreicht ein Fels den unteren Rand, kostet das ein Leben. Werte in rocks.json.
import { CFG } from '../config.js';
import { bdata } from './battle.js';
import { dayKey } from '../time.js';

const R = () => CFG.rocks;

// Rohwert ohne Level (2 × Basiswert + DV + EV × evWeight) und daraus Stufe 1–5 samt Fortschritt zur nächsten Stufe
function rate(p, cfg) {
  const i = cfg.stat, v = 2 * bdata(p.dex).base[i] + (p.ivs?.[i] || 0) + (p.evs?.[i] || 0) * cfg.evWeight;
  const T = cfg.thresholds, level = 1 + T.filter((x) => v >= x).length;
  const lo = level === 1 ? 0 : T[level - 2], hi = T[level - 1];
  return { value: v, level, next: hi == null ? 1 : Math.max(0, Math.min(1, (v - lo) / (hi - lo))) };
}
export const powerOf = (p) => rate(p, R().power);
export const speedOf = (p) => rate(p, R().speed);
export const tapsFor = (power) => R().tapsByPower[power - 1];
export const gapFor = (speed) => R().tapGapBySpeed[speed - 1];

// ---- Item-Shop (Vitamine wie in HGSS): dauerhaft EV auf einen Statuswert ----
export const shopItems = () => R().shop.items;
export function itemRoom(p, item) {
  const S = CFG.battle.stats, ev = p.evs || [0, 0, 0, 0, 0, 0], total = ev.reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(item.ev, R().shop.vitaminCap - ev[item.stat], S.evMaxStat - ev[item.stat], S.evMaxTotal - total));
}
// im Spielstand: Item kaufen und sofort dem Pokémon geben
export function buyItem(s, uid, itemId) {
  const item = shopItems().find((x) => x.id === itemId), p = s.pokemon.find((x) => x.uid === uid);
  if (!item || !p) return { ok: false };
  const add = itemRoom(p, item);
  if (add <= 0) return { ok: false, msg: `${item.name} wirkt bei diesem Pokémon nicht mehr.` };
  if (s.coins < item.price) return { ok: false, msg: 'Nicht genug Glücksmünzen.' };
  s.coins -= item.price;
  p.evs ||= [0, 0, 0, 0, 0, 0];
  p.evs[item.stat] += add;
  return { ok: true, add };
}
// Belohnung nach einer Runde: Münzen je Fels (Tagesgrenze) und Bestwert
export function rockReward(s, uid, rocks, t) {
  const d = dayKey(t);
  s.rocks ||= { best: 0, day: '', coinsToday: 0 };
  if (s.rocks.day !== d) { s.rocks.day = d; s.rocks.coinsToday = 0; }
  const coins = Math.max(0, Math.min(rocks * R().coinsPerRock, R().dailyCoinCap - s.rocks.coinsToday));
  s.rocks.coinsToday += coins; s.coins += coins;
  if (coins) { s.stats.coinsEarned = (s.stats.coinsEarned || 0) + coins; }
  const record = rocks > (s.rocks.best || 0);
  if (record) { s.rocks.best = rocks; s.rocks.bestUid = uid; }
  return { ok: true, coins, record };
}

// ---- eine Runde ----
export class RockRun {
  constructor(p, rnd = Math.random) {
    this.rnd = rnd;
    this.power = powerOf(p).level; this.speed = speedOf(p).level;
    this.taps = tapsFor(this.power); this.gap = gapFor(this.speed);
    this.lanes = R().lanes; this.lives = R().lives;
    this.t = 0; this.pos = 0; // pos: wie weit das Band schon gerollt ist (in Reihen)
    this.vel = R().scroll.start;
    this.rows = []; this.nextRow = 0; this.lastTap = -1e9;
    this.smashed = 0; this.over = false; this.events = [];
    this.lastLane = -1;
    while (this.nextRow < R().rowsVisible + 2) this.addRow();
  }
  // Reihe n liegt bei y = pos - n (0 = unterer Rand, rowsVisible = oberer Rand); neue Reihen beginnen oberhalb des Bildes
  addRow() {
    let lane = Math.floor(this.rnd() * this.lanes);
    if (lane === this.lastLane && this.rnd() < 0.5) lane = (lane + 1 + Math.floor(this.rnd() * (this.lanes - 1))) % this.lanes;
    this.lastLane = lane;
    this.rows.push({ n: this.nextRow++ + R().rowsVisible - 1, lane, hp: this.taps, dead: false });
  }
  yOf(row) { return row.n - this.pos; } // Unterkante der Reihe in Reihen über dem unteren Rand
  update(dt) {
    if (this.over) return;
    this.t += dt;
    this.pos += this.vel * dt;
    for (const r of this.rows) if (!r.dead && this.yOf(r) < 0) {
      r.dead = true; this.lives--;
      this.events.push({ type: 'miss', row: r });
      if (this.lives <= 0) { this.over = true; this.events.push({ type: 'over' }); }
    }
    this.rows = this.rows.filter((r) => this.yOf(r) > -1.2);
    while (this.rows.length && this.rows[this.rows.length - 1].n - this.pos < R().rowsVisible + 1) this.addRow();
  }
  // Tipp in Spalte lane auf Höhe y (Reihen über dem unteren Rand)
  tap(lane, y) {
    if (this.over) return null;
    const row = this.rows.find((r) => !r.dead && r.lane === lane && y >= this.yOf(r) && y < this.yOf(r) + 1);
    if (!row) return null;
    if (this.t - this.lastTap < this.gap) { this.events.push({ type: 'tooFast', row }); return 'fast'; }
    this.lastTap = this.t;
    row.hp--;
    if (row.hp > 0) { this.events.push({ type: 'hit', row }); return 'hit'; }
    row.dead = true; this.smashed++;
    this.vel = Math.min(R().scroll.max, this.vel + R().scroll.perRock);
    this.events.push({ type: 'smash', row });
    return 'smash';
  }
}
