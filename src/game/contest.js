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

// Startverteilung je Art: Typ-Neigung + passende Basiswerte, quadriert (Spezialisierung), Summe nach Entwicklungsstufe.
// Feste Mindestwerte für bekannte Fälle (z. B. Milotic: Schönheit). seed = individuelle Schwankung je Exemplar.
export function contestStart(dex, seed = 0) {
  const S = K().start, sp = CFG.dexById.get(dex), b = CFG.battleData?.pokemon[dex]?.base;
  if (!S || !sp || !b) return emptyContest();
  const w = { cool: b[5] / 50 + b[1] / 80, beauty: b[4] / 70, cute: sp.stage === 1 ? 1.5 : 0.3, smart: b[3] / 60, tough: (b[0] + b[2]) / 120 };
  for (const t of sp.types) for (const [k, v] of Object.entries(S.typeAffinity[t] || {})) w[k] += v * 1.2;
  const total = S.total[sp.rarity === 'legendaer' ? 'legendaer' : String(Math.min(3, sp.stage))] || 50;
  const sq = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v * v]));
  const sum = Object.values(sq).reduce((a, x) => a + x, 0) || 1;
  let r = (seed * 9301 + 49297) % 233280;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  const out = {};
  for (const k of Object.keys(sq)) out[k] = Math.round(Math.min(K().maxPerStat, (sq[k] / sum) * total * (1 + (rnd() * 2 - 1) * S.variation)));
  for (const [k, v] of Object.entries(S.species?.[dex] || {})) out[k] = Math.max(out[k], v);
  // Gesamtgrenze einhalten: ggf. die nicht festgelegten Werte kürzen
  let over = Object.values(out).reduce((a, x) => a + x, 0) - K().totalCap;
  for (const k of Object.keys(out).sort((a, c) => out[a] - out[c])) {
    if (over <= 0) break;
    if (S.species?.[dex]?.[k]) continue;
    const cut = Math.min(out[k], over);
    out[k] -= cut; over -= cut;
  }
  return out;
}
