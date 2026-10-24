// Felsbrecher: Wettbewerb angelehnt an Piano Tiles. In jeder Reihe liegt ein Fels in einer zufälligen Spalte;
// die Reihen rollen nach unten. Ein Fels braucht je nach Kraft 5…1 Tipper, Tempo legt den Mindestabstand zwischen Tippern fest.
// Lange Felsen werden gedrückt gehalten (zerbröseln von unten), Bomben explodieren beim Antippen und bremsen das Band.
// Erreicht ein Fels den unteren Rand, kostet das ein Leben. Jede Runde ist ein Training (1× pro Pokémon und Tag). Werte in rocks.json.
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

// ---- Training: 1× pro Pokémon und Tag; danach EP und ein Angriffs-Buff für physische Treffer in allen Kampf-Minispielen ----
export const trainedToday = (s, uid, t) => s.rocks?.trained?.[uid] === dayKey(t);
const T = () => R().training;
export const buffPct = (rocks) => Math.min(T().buffMaxPct, Math.round(rocks * T().buffPctPerRock));
export const trainEp = (rocks) => Math.min(T().epMax, Math.round(rocks * T().epPerRock));
// aktiver Buff (Multiplikator) für ein eigenes Pokémon (uid) – oder, ohne uid (Chaos-Bälle), für die Art (bester Buff dieser Art)
export function physBuff(s, { uid = null, dex }, t) {
  const B = s?.buffs, d = dayKey(t);
  if (!B) return 1;
  const live = (b) => b && b.until >= d;
  if (uid != null) return live(B[uid]) ? B[uid].mult : 1;
  let best = 1;
  for (const b of Object.values(B)) if (live(b) && b.dex === dex) best = Math.max(best, b.mult);
  return best;
}
// Belohnung nach einer Runde: Münzen je Fels (Tagesgrenze), Bestwert, Training (EP + Buff)
export function rockReward(s, uid, rocks, t) {
  const d = dayKey(t), p = s.pokemon.find((x) => x.uid === uid);
  s.rocks ||= { best: 0, day: '', coinsToday: 0 };
  s.rocks.trained ||= {};
  if (s.rocks.trained[uid] === d) return { ok: false, msg: 'Dieses Pokémon hat heute schon trainiert.' };
  s.rocks.trained[uid] = d;
  for (const [k, v] of Object.entries(s.rocks.trained)) if (v !== d) delete s.rocks.trained[k]; // alte Tage aufräumen
  if (s.rocks.day !== d) { s.rocks.day = d; s.rocks.coinsToday = 0; }
  const coins = Math.max(0, Math.min(rocks * R().coinsPerRock, R().dailyCoinCap - s.rocks.coinsToday));
  s.rocks.coinsToday += coins; s.coins += coins;
  if (coins) s.stats.coinsEarned = (s.stats.coinsEarned || 0) + coins;
  const record = rocks > (s.rocks.best || 0);
  if (record) { s.rocks.best = rocks; s.rocks.bestUid = uid; }
  const ep = trainEp(rocks), pct = buffPct(rocks);
  s.route ||= { ep: 0, cleared: 0 };
  s.route.ep += ep;
  s.buffs ||= {};
  for (const [k, b] of Object.entries(s.buffs)) if (b.until < d) delete s.buffs[k];
  if (pct > 0 && p) {
    const until = dayKey(t + (T().buffDays - 1) * 864e5);
    if (!s.buffs[uid] || s.buffs[uid].mult < 1 + pct / 100 || s.buffs[uid].until < until) s.buffs[uid] = { mult: 1 + pct / 100, dex: p.dex, until };
  }
  return { ok: true, coins, record, ep, pct };
}

// ---- eine Runde ----
// Reihe: { n, lane, kind: 'rock'|'hold'|'bomb', len (Reihen), hp, hp0, dead }
export class RockRun {
  constructor(p, rnd = Math.random) {
    this.rnd = rnd;
    this.power = powerOf(p).level; this.speed = speedOf(p).level;
    this.taps = tapsFor(this.power); this.gap = gapFor(this.speed);
    this.holdTime = R().hold.secPerRowByPower[this.power - 1];
    this.lanes = R().lanes; this.lives = R().lives;
    this.t = 0; this.pos = 0; // pos: wie weit das Band schon gerollt ist (in Reihen)
    this.vel = R().scroll.start;
    this.rows = []; this.nextRow = R().rowsVisible - 1; this.count = 0; this.lastTap = -1e9;
    this.smashed = 0; this.bombs = 0; this.over = false; this.events = [];
    this.lastLane = -1;
    while (this.nextRow < R().rowsVisible * 2 + 2) this.addRow();
  }
  addRow() {
    let lane = Math.floor(this.rnd() * this.lanes);
    if (lane === this.lastLane && this.rnd() < 0.5) lane = (lane + 1 + Math.floor(this.rnd() * (this.lanes - 1))) % this.lanes;
    this.lastLane = lane;
    const S = R().special, late = this.count >= S.fromRow, x = this.rnd();
    let row;
    if (late && x < S.holdChance) {
      const [a, b] = R().hold.len, len = a + Math.floor(this.rnd() * (b - a + 1));
      row = { kind: 'hold', len, hp: len * this.holdTime, hp0: len * this.holdTime };
    } else if (late && x < S.holdChance + S.bombChance) row = { kind: 'bomb', len: 1, hp: 1, hp0: 1 };
    else row = { kind: 'rock', len: 1, hp: this.taps, hp0: this.taps };
    Object.assign(row, { n: this.nextRow, lane, dead: false, held: 0 });
    this.nextRow += row.len; this.count++;
    this.rows.push(row);
  }
  yOf(row) { return row.n - this.pos; } // Unterkante (unzerstört) in Reihen über dem unteren Rand
  // lange Felsen bröseln von unten weg
  bottomOf(row) { return row.kind === 'hold' ? this.yOf(row) + row.len * (1 - row.hp / row.hp0) : this.yOf(row); }
  topOf(row) { return this.yOf(row) + row.len; }
  update(dt) {
    if (this.over) return;
    this.t += dt;
    this.pos += this.vel * dt;
    for (const r of this.rows) {
      if (r.dead) continue;
      if (r.kind === 'hold' && r.held > 0) {
        r.hp -= dt;
        if (r.hp <= 0) { this.kill(r); continue; }
      }
      if (this.bottomOf(r) < 0) {
        r.dead = true;
        if (r.kind === 'bomb') { this.events.push({ type: 'bombGone', row: r }); continue; } // Bomben dürfen durchrollen
        this.lives--;
        this.events.push({ type: 'miss', row: r });
        if (this.lives <= 0) { this.over = true; this.events.push({ type: 'over' }); }
      }
    }
    this.rows = this.rows.filter((r) => this.topOf(r) > -1.2);
    while (this.nextRow - this.pos < R().rowsVisible * 2 + 1) this.addRow();
  }
  kill(row) {
    row.dead = true; row.held = 0;
    if (row.kind === 'bomb') {
      this.bombs++;
      this.vel = Math.max(R().scroll.start, this.vel - R().bomb.slowBy);
      this.events.push({ type: 'bomb', row });
      return;
    }
    this.smashed++;
    this.vel = Math.min(R().scroll.max, this.vel + R().scroll.perRock * (row.kind === 'hold' ? row.len : 1));
    this.events.push({ type: 'smash', row });
  }
  // Tipp in Spalte lane auf Höhe y (Reihen über dem unteren Rand) → 'hit' | 'smash' | 'fast' | 'hold' (dann row) | null
  tap(lane, y) {
    if (this.over) return null;
    const row = this.rows.find((r) => !r.dead && r.lane === lane && y >= this.bottomOf(r) - 0.15 && y < this.topOf(r) + 0.1);
    if (!row) return null;
    if (row.kind === 'hold') { row.held++; this.events.push({ type: 'grab', row }); return { res: 'hold', row }; }
    if (this.t - this.lastTap < this.gap) { this.events.push({ type: 'tooFast', row }); return { res: 'fast', row }; }
    this.lastTap = this.t;
    row.hp--;
    if (row.hp > 0) { this.events.push({ type: 'hit', row }); return { res: 'hit', row }; }
    this.kill(row);
    return { res: 'smash', row };
  }
  release(row) { if (row && row.held > 0) row.held--; }
}
