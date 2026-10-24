// Spielautomat: Einsatz (mind. 100 Münzen, nie Münzen zurück) → Ergebnis wird beim Start ausgelost, die Walzen
// zeigen es nur an. Gewinne: Pokémon (Spielautomat-exklusive Mysteriöse/Trio-Legendäre/Jirachi oder seltene),
// EP, Entwicklungssteine (dauerhafte Entwicklung) oder ein Freispiel. Werte in slots.json.
import { CFG, species } from '../config.js';
import { bdata, calcStats, stonesFor, stoneEvolution, stoneName } from './battle.js';
import { addCaught } from './actions.js';
import { staminaOf } from './contest.js';

const S = () => CFG.slots;
export const SYMBOLS = ['seven', 'g', 'replay', 'cherry', 'pika', 'gem'];
export const isExclusive = (dex) => S().exclusive.includes(dex);

// Gewinnchancen je Einsatzstufe (Freispiel bleibt gleich), gesamt höchstens maxWinChance
export function chances(betIdx) {
  const m = S().betMult[betIdx] || 1;
  let list = S().outcomes.map((o) => ({ o, p: (o.weight / 100) * (o.prize.type === 'replay' ? 1 : m) }));
  const tot = list.reduce((a, x) => a + x.p, 0);
  if (tot > S().maxWinChance) list = list.map((x) => ({ ...x, p: (x.p * S().maxWinChance) / tot }));
  return list;
}
export function rollOutcome(betIdx, rnd = Math.random) {
  let r = rnd();
  for (const { o, p } of chances(betIdx)) { if (r < p) return o; r -= p; }
  return null; // Niete
}

// Pokémon wie für den Kampf vergleichbar machen (für Stein-Entwicklungen mit Ang/Vert-Bedingung)
const asFighter = (p) => ({ ...p, stats: calcStats(p.dex, p.level || 1, p.ivs || [0, 0, 0, 0, 0, 0], p.evs || [0, 0, 0, 0, 0, 0]) });
export const stoneTargets = (s, stone) => s.pokemon.filter((p) => bdata(p.dex) && stoneEvolution(asFighter(p), stone));

// Spiel bezahlen (Freispiel kostet nichts) und Ergebnis auslosen
export function spin(s, betIdx, free, rnd = Math.random) {
  const bet = S().bets[betIdx];
  if (!free && s.coins < bet) return { ok: false, msg: `Ein Spiel kostet mindestens ${bet} Münzen.` };
  if (!free) s.coins -= bet;
  s.slots ||= { spins: 0, wins: {} };
  s.slots.spins++;
  return { ok: true, outcome: rollOutcome(betIdx, rnd) };
}

// Gewinn gutschreiben → Beschreibung für die Anzeige
export function claim(s, t, outcome, rnd = Math.random) {
  const pr = outcome.prize;
  s.slots ||= { spins: 0, wins: {} };
  s.slots.wins[outcome.id] = (s.slots.wins[outcome.id] || 0) + 1;
  if (pr.type === 'ep') { s.route ||= { ep: 0, cleared: 0 }; s.route.ep += pr.amount; return { ok: true, kind: 'ep', amount: pr.amount }; }
  if (pr.type === 'replay') return { ok: true, kind: 'replay' };
  if (pr.type === 'stone') {
    const all = Object.keys(CFG.battleData.stones);
    const useful = all.filter((st) => stoneTargets(s, st).length);
    const pool = useful.length && rnd() < S().stoneUsefulChance ? useful : all;
    const stone = pool[Math.floor(rnd() * pool.length)];
    s.items ||= {}; s.items.stones ||= {};
    s.items.stones[stone] = (s.items.stones[stone] || 0) + 1;
    return { ok: true, kind: 'stone', stone, name: stoneName(stone) };
  }
  // Pokémon
  let list, ball;
  if (pr.type === 'exclusive') {
    const missing = S().exclusive.filter((d) => species(d) && !s.dexOwned.includes(d)); // bevorzugt noch nicht gefangene
    list = (missing.length && rnd() < 0.7 ? missing : S().exclusive).filter((d) => species(d));
    ball = 'meisterball';
  } else {
    const entries = Object.entries(pr.pool), tot = entries.reduce((a, [, w]) => a + w, 0);
    let r = rnd() * tot, rar = entries[0][0];
    for (const [k, w] of entries) { if (r < w) { rar = k; break; } r -= w; }
    list = CFG.dex.filter((sp) => sp.rarity === rar && !isExclusive(sp.dex)).map((sp) => sp.dex);
    ball = rar === 'legendaer' ? 'meisterball' : 'hyperball';
  }
  const dex = list[Math.floor(rnd() * list.length)];
  const p = addCaught(s, t, dex, ball, { fromSlots: true });
  return { ok: true, kind: 'pokemon', pokemon: p, ball };
}

// Entwicklungsstein benutzen: dauerhafte Entwicklung
export function useStone(s, uid, stone) {
  const p = s.pokemon.find((x) => x.uid === uid);
  if (!p || !(s.items?.stones?.[stone] > 0)) return { ok: false, msg: 'Kein Stein vorhanden.' };
  const evo = stoneEvolution(asFighter(p), stone);
  if (!evo) return { ok: false, msg: `${species(p.dex).name} kann sich damit nicht entwickeln.` };
  const from = p.dex;
  p.dex = evo.to;
  p.stamina = staminaOf(p.dex);
  if (!s.dexOwned.includes(p.dex)) s.dexOwned.push(p.dex);
  if (!--s.items.stones[stone]) delete s.items.stones[stone];
  return { ok: true, from, to: p.dex };
}
export { stonesFor };
