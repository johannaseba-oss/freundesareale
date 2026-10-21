// Wettbewerbswerte (Coolness, Schönheit, Anmut, Klugheit, Stärke) und Ausdauer.
// Punkte je Eigenschaft steigen durch passende Aktivitäten (contest.json activities); die Summe ist begrenzt (totalCap),
// damit sich Pokémon spezialisieren. Stufe 1–4 ergibt sich aus den Punkten.
// Ausdauer (1–5, je Art) wird ausschließlich von Minispielen genutzt, die sie ausdrücklich berücksichtigen.
import { CFG } from '../config.js';
import { dayKey } from '../time.js';

const K = () => CFG.contest;
export const contestStats = () => K().stats;
export const emptyContest = () => Object.fromEntries(K().stats.map((s) => [s.id, 0]));
export const contestTotal = (p) => Object.values(p.contest || {}).reduce((a, b) => a + b, 0);
export function contestLevel(points) {
  const L = K().levels;
  let lv = 1;
  for (let i = 0; i < L.length; i++) if (points >= L[i]) lv = i + 1;
  return lv;
}
// Für den späteren Wettbewerbsmodus: Spezialisierung zählt überproportional
export const contestAppeal = (p, stat) => Math.pow((p.contest?.[stat] || 0) / K().maxPerStat, K().appealExponent);

// Aktivität ausführen -> tatsächlich gewonnene Punkte {stat: n} (leer, wenn nichts mehr geht)
export function trainContest(p, activity, t, rnd = Math.random) {
  const a = K().activities[activity];
  if (!a) return {};
  p.contest ||= emptyContest();
  if (a.perDay) {
    p.contestDay ||= {};
    const d = dayKey(t);
    if (p.contestDay[activity] === d) return {};
    p.contestDay[activity] = d;
  }
  const out = {};
  for (const [stat, [lo, hi]] of Object.entries(a.gains)) {
    const want = lo + Math.floor(rnd() * (hi - lo + 1));
    const room = Math.min(K().maxPerStat - (p.contest[stat] || 0), K().totalCap - contestTotal(p));
    const add = Math.max(0, Math.min(want, room));
    if (add) { p.contest[stat] = (p.contest[stat] || 0) + add; out[stat] = add; }
  }
  return out;
}
export const statName = (id) => K().stats.find((s) => s.id === id)?.name || id;
export const gainLines = (gains) => Object.entries(gains).map(([k, v]) => `${statName(k)} +${v}`);

// Ausdauer je Art: Rang von KP + Vert + SpVert unter allen Arten
let staminaCache = null;
export function staminaOf(dex) {
  if (!staminaCache) {
    const P = CFG.battleData?.pokemon || {};
    const score = (d) => { const b = P[d]?.base; return b ? b[0] + b[2] + b[4] : 0; };
    const all = Object.keys(P).map((d) => score(d)).sort((a, b) => a - b);
    const cuts = K().stamina.percentiles.map((q) => all[Math.floor(q * (all.length - 1))]);
    staminaCache = (d) => 1 + cuts.filter((c) => score(d) > c).length;
  }
  return staminaCache(dex);
}
