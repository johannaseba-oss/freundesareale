// Getragene Items (config/items.json): ein Pokémon trägt höchstens ein Item (p.held = Item-ID). Der Effekt gilt für genau dieses
// Pokémon (gleiche Pokédex-Nummer, nicht gleicher Typ): alle EIGENEN Pokémon dieser Nummer, die man in einem Minispiel einsetzt
// (auch gezogene im Chaos-Modus), haben ihn – Gegner nie. Items gibt es nur im Spielautomaten.
import { CFG } from '../config.js';

const I = () => CFG.items;
export const heldItems = () => I().held;
export const itemById = (id) => I().held.find((x) => x.id === id) || null;
export const itemSprite = (it) => `${import.meta.env.BASE_URL}art/items/${it.sprite}.png`;

// Item für ein eigenes Pokémon: eigenes Item zuerst, sonst das Item eines anderen eigenen Pokémon mit derselben Pokédex-Nummer
export function heldOf(s, { uid = null, dex }) {
  if (!s?.pokemon) return null;
  const own = uid != null ? s.pokemon.find((p) => p.uid === uid) : null;
  if (own?.held) return itemById(own.held);
  const other = s.pokemon.find((p) => p.dex === dex && p.held);
  return other ? itemById(other.held) : null;
}
// nur die Effekte (für die Kampf-Engines, im Spielstand speicherbar)
export const fxOf = (s, who) => heldOf(s, who)?.fx || null;

// Schadens-Multiplikator eines Angreifers mit Item-Effekten fx
export function itemDamageMult(fx, mv, eff = 1) {
  if (!fx || !mv) return 1;
  let m = fx.dmgMult || 1;
  if (fx.physMult && mv.cat === 'phys') m *= fx.physMult;
  if (fx.spezMult && mv.cat === 'spez') m *= fx.spezMult;
  if (fx.type && fx.type === mv.type) m *= fx.typeMult || 1;
  if (fx.superMult && eff > 1) m *= fx.superMult;
  return m;
}
export const itemCritChance = (fx, base) => (fx?.critAdd ? Math.min(1, base + 0.1 * fx.critAdd) : base);

// ---- Spielstand ----
// Item aus dem Beutel geben (ein vorher getragenes kommt zurück in den Beutel)
export function giveItem(s, uid, id) {
  const p = s.pokemon.find((x) => x.uid === uid), it = itemById(id);
  if (!p || !it || !(s.items?.held?.[id] > 0)) return { ok: false, msg: 'Item nicht im Beutel.' };
  s.items.held[id]--; if (!s.items.held[id]) delete s.items.held[id];
  if (p.held) s.items.held[p.held] = (s.items.held[p.held] || 0) + 1;
  p.held = id;
  return { ok: true };
}
export function takeItem(s, uid) {
  const p = s.pokemon.find((x) => x.uid === uid);
  if (!p?.held) return { ok: false };
  s.items ||= {}; s.items.held ||= {};
  s.items.held[p.held] = (s.items.held[p.held] || 0) + 1;
  delete p.held;
  return { ok: true };
}
// Gewinn im Spielautomaten: zufälliges Item nach Gewicht
export function winItem(s, rnd = Math.random) {
  const list = heldItems(), tot = list.reduce((a, x) => a + (x.weight || 1), 0);
  let r = rnd() * tot, it = list[0];
  for (const x of list) { if (r < (x.weight || 1)) { it = x; break; } r -= x.weight || 1; }
  s.items ||= {}; s.items.held ||= {};
  s.items.held[it.id] = (s.items.held[it.id] || 0) + 1;
  return it;
}
