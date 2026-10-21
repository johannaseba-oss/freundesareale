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
// Mindestens ein gemeinsamer Typ = typkompatibel (dann keine typbedingten Konflikte, egal was die übrigen Typen sagen)
export function sharesType(dexA, dexB) {
  const a = species(dexA), b = species(dexB);
  return !!a && !!b && a.types.some((t) => b.types.includes(t));
}
// A ist B deutlich überlegen: trifft sehr effektiv, wird selbst aber nicht so gut getroffen (nur ohne gemeinsamen Typ)
export function dominates(dexA, dexB) {
  if (sharesType(dexA, dexB)) return false;
  const ab = bestAgainst(dexA, dexB), ba = bestAgainst(dexB, dexA);
  return ab >= 2 && ab > ba;
}
export const typeColor = (t) => CFG.types?.colors[t] || '#999';

// Typ-Kärtchen (DOM) – für Areal-Anzeige, Shop und Einzelansicht
export function typeChip(t, extraClass = '') {
  const el = document.createElement('span');
  el.className = 'type-chip' + (extraClass ? ' ' + extraClass : '');
  el.style.background = typeColor(t);
  el.textContent = t;
  return el;
}
export function allTypesChip() {
  const el = document.createElement('span');
  el.className = 'type-chip all';
  el.textContent = 'Alle Typen';
  return el;
}
// Kärtchen der Wohlfühl-Typen eines Areals
export const areaTypeChips = (area) => (area.allTypes ? [allTypesChip()] : (area.likes || []).map((t) => typeChip(t)));
