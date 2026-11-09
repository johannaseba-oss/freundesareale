// Zucht (public/config/breed.json): Paare (♂ + ♀) in Boxen legen Eier in den Brutkasten, Eier schlüpfen von selbst.
// Zeitbasiert – läuft auch bei geschlossener App weiter; tick() holt verpasste Eier und Schlüpfe nach.
import { CFG, species } from '../config.js';
import { HOUR } from '../time.js';
import { hashString } from '../rng.js';
import { baseOf } from './eggs.js';
import { hatchFrom } from './actions.js';

const B = () => CFG.breed;
const fail = (msg) => ({ ok: false, msg });

export const boxMons = (s, i) => s.pokemon.filter((p) => p.breed === i);
export const canBreed = (p) => !!p.gender && !p.stall && p.breed == null;
const female = (pair) => pair.find((p) => p.gender === 'w');

// Paar in eine leere Box setzen (zieht aus Areal aus)
export function setPair(s, i, m, f, t) {
  if (boxMons(s, i).length) return fail('Diese Box ist schon belegt.');
  if (m.gender !== 'm' || f.gender !== 'w') return fail('Ein Paar braucht ein Männchen und ein Weibchen.');
  for (const p of [m, f]) { p.area = null; p.breed = i; }
  s.breed ||= { boxes: {}, eggs: [] };
  s.breed.boxes[i] = { nextEggAt: t + B().eggEveryHours * HOUR };
  return { ok: true };
}
export function clearBox(s, i) {
  for (const p of boxMons(s, i)) p.breed = undefined;
  if (s.breed) delete s.breed.boxes[i];
  return { ok: true };
}
// beim Einziehen in ein Areal oder den Stall: aus der Box nehmen
export function leaveBox(s, p) { if (p.breed != null) clearBox(s, p.breed); }

// Eier legen und schlüpfen lassen; liefert die frisch geschlüpften Pokémon
export function tick(s, t) {
  s.breed ||= { boxes: {}, eggs: [] };
  const C = B(), hatched = [];
  const hatchDue = (at) => {
    for (const egg of [...s.breed.eggs]) {
      if (egg.hatchAt > at) continue;
      s.breed.eggs.splice(s.breed.eggs.indexOf(egg), 1);
      const p = hatchFrom(s, egg, egg.hatchAt, C.shinyChance);
      p.hatchedNew = true; // erscheint im Schlupf-Fenster
      hatched.push(p);
    }
  };
  for (let i = 0; i < C.boxes.length; i++) {
    const pair = boxMons(s, i), box = s.breed.boxes[i];
    if (pair.length !== 2 || !box) continue;
    while (box.nextEggAt <= t) {
      hatchDue(box.nextEggAt); // was bis dahin geschlüpft ist, macht im Brutkasten Platz
      if (s.breed.eggs.length >= C.incubator) { box.nextEggAt = t + C.eggEveryHours * HOUR; break; } // Brutkasten voll: neu warten
      const at = box.nextEggAt, mom = female(pair) || pair[0];
      s.breed.eggs.push({ id: hashString(`zucht|${i}|${at}|${pair.map((p) => p.uid).join('-')}`), dex: baseOf(mom.dex), parents: pair.map((p) => p.uid), laidAt: at, hatchAt: at + C.hatchHours * HOUR });
      box.nextEggAt = at + C.eggEveryHours * HOUR;
    }
  }
  hatchDue(t);
  return hatched;
}
export const newHatches = (s) => s.pokemon.filter((p) => p.hatchedNew);
export function keepHatches(s, uids) { for (const p of s.pokemon) if (uids.includes(p.uid)) p.hatchedNew = undefined; return { ok: true }; }
export const eggName = (egg) => species(egg.dex)?.name || '';
