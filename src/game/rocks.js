// Kraft und Tempo eines Pokémon, Item-Shop und noch laufende Angriffs-Buffs aus dem früheren Felsbrecher. Werte in rocks.json.
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
