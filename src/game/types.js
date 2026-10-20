// Typen-Effektivität: Wer ist wem im Kampf deutlich überlegen? (inkl. Doppeltypen)
import { CFG, species } from '../config.js';

// Multiplikator eines Angriffstyps gegen ein Pokémon mit 1–2 Typen
export function effectiveness(attackType, defTypes) {
  const row = CFG.types.chart[attackType];
  if (!row) return 1;
  return defTypes.reduce((m, t) => m * (row.ne.includes(t) ? 0 : row.se.includes(t) ? 2 : row.nve.includes(t) ? 0.5 : 1), 1);
}
// bester Multiplikator, den A mit einem seiner Typen gegen B erreicht
export function bestAgainst(dexA, dexB) {
  const a = species(dexA), b = species(dexB);
  if (!a?.types.length || !b?.types.length) return 1;
  return Math.max(...a.types.map((t) => effectiveness(t, b.types)));
}
// A ist B deutlich überlegen: trifft sehr effektiv, wird selbst aber nicht so gut getroffen
export function dominates(dexA, dexB) {
  const ab = bestAgainst(dexA, dexB), ba = bestAgainst(dexB, dexA);
  return ab >= 2 && ab > ba;
}
export const typeColor = (t) => CFG.types?.colors[t] || '#999';
