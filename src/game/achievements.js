// Erfolge: werden aus den Spieldaten berechnet und beim Erreichen dauerhaft freigeschaltet (s.achievements[id] = Zeitpunkt).
// Neue Erfolge: einfach in public/config/achievements.json ergänzen.
import { CFG } from '../config.js';
import { contestLevel } from './contest.js';

// Arten, die man je besessen hat (zählt jede Art nur einmal)
export const ownedSpecies = (s) => new Set([...(s.dexOwned || []), ...s.pokemon.map((p) => p.dex)]);

let families = null;
function fullFamilies(owned) {
  if (!families) {
    families = new Map();
    for (const p of CFG.dex) (families.get(p.family) || families.set(p.family, []).get(p.family)).push(p.dex);
    for (const [k, v] of families) if (v.length < 2) families.delete(k); // nur echte Entwicklungsreihen
  }
  let n = 0;
  for (const list of families.values()) if (list.every((d) => owned.has(d))) n++;
  return n;
}

// -> { value, target } für die Fortschrittsanzeige
export function progressOf(s, a, owned = ownedSpecies(s)) {
  switch (a.type) {
    case 'speciesCount': return { value: owned.size, target: a.n };
    case 'dexRange': {
      const want = CFG.dex.filter((p) => p.dex >= a.from && p.dex <= a.to).map((p) => p.dex);
      return { value: want.filter((d) => owned.has(d)).length, target: want.length };
    }
    case 'set': { const want = a.dex.filter((d) => CFG.dexById.has(d)); return { value: want.filter((d) => owned.has(d)).length, target: want.length }; }
    case 'fullFamilies': return { value: fullFamilies(owned), target: a.n };
    case 'stat': return { value: s.stats?.[a.stat] || 0, target: a.n };
    case 'areasUnlocked': return { value: Object.values(s.areas).filter((x) => x.unlocked).length, target: a.n === 'alle' ? CFG.areas.length : a.n };
    case 'beat': return { value: s.stats?.beaten?.[a.opponent] ? 1 : 0, target: 1 };
    case 'contestLevel': return { value: Math.max(1, ...s.pokemon.map((p) => Math.max(1, ...Object.values(p.contest || {}).map(contestLevel)))), target: a.n };
    default: return { value: 0, target: 1 };
  }
}

// neu erreichte Erfolge freischalten -> Liste der neuen
export function checkAchievements(s, t) {
  s.achievements ||= {};
  const owned = ownedSpecies(s), fresh = [];
  for (const a of CFG.achievements.list) {
    if (s.achievements[a.id]) continue;
    const { value, target } = progressOf(s, a, owned);
    if (target > 0 && value >= target) { s.achievements[a.id] = t; fresh.push(a); }
  }
  return fresh;
}
