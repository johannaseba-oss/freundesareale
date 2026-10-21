// Stimmung & Sympathie.
// Stimmung = Zufriedenheit + vorübergehender Betüdel-Bonus (hält einen Tag).
// Sympathie zweier Pokémon ergibt sich aus Art, Familie, Typen, Entwicklungsstufe und besonderen Beziehungen.
import { CFG, species } from '../config.js';

export function petBoost(p, t) {
  return p.petBoost && p.petBoost.until > t ? p.petBoost.value : 0;
}
export function mood(p, t) {
  return Math.min(100, p.satisfaction + petBoost(p, t));
}

const cache = new Map();
export function affinity(dexA, dexB) {
  const key = dexA < dexB ? dexA + '|' + dexB : dexB + '|' + dexA;
  if (cache.has(key)) return cache.get(key);
  const S = CFG.social, w = S.affinity, a = species(dexA), b = species(dexB);
  let v = 0;
  if (dexA === dexB) v += w.sameSpecies;
  if (a.family === b.family) v += w.sameFamily;
  const shared = a.types.some((t) => b.types.includes(t));
  if (shared) v += w.sharedType;
  // Typ-Streit nur ohne gemeinsamen Typ
  if (!shared) for (const [x, y] of S.typeConflicts) {
    if ((a.types.includes(x) && b.types.includes(y)) || (a.types.includes(y) && b.types.includes(x))) { v += w.typeConflict; break; }
  }
  if (Math.abs(a.stage - b.stage) >= 2) v += w.bigStageGap;
  for (const r of S.relations) {
    if ((r.a.includes(dexA) && r.b.includes(dexB)) || (r.a.includes(dexB) && r.b.includes(dexA))) { v = r.value; break; }
  }
  v = Math.max(-1, Math.min(1, v));
  cache.set(key, v);
  return v;
}
export const relationName = (dexA, dexB) =>
  CFG.social.relations.find((r) => (r.a.includes(dexA) && r.b.includes(dexB)) || (r.a.includes(dexB) && r.b.includes(dexA)))?.name || null;

// mittlere Sympathie zu den Mitbewohnern (-1..1), 0 wenn allein
export function socialClimate(p, mates) {
  const others = mates.filter((q) => q.uid !== p.uid);
  if (!others.length) return 0;
  return others.reduce((s, q) => s + affinity(p.dex, q.dex), 0) / others.length;
}
