// Erzeugt public/config/defense_levels.json: 50 PokeDefense-Level mit wechselnden Typen (einzeln, Paare, später Trios),
// steigender Wellenzahl, Gegnerstärke und Anzahl. Danach frei von Hand anpassbar.
// Aufruf: node tools/build_defense_levels.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = ['Feuer', 'Wasser', 'Pflanze', 'Elektro', 'Eis', 'Kampf', 'Gift', 'Boden', 'Flug', 'Psycho', 'Käfer', 'Gestein', 'Geist', 'Drache', 'Unlicht', 'Stahl', 'Fee', 'Normal'];
let seed = 20261021;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list, n) => { const l = [...list], out = []; while (out.length < n) out.push(l.splice(Math.floor(rnd() * l.length), 1)[0]); return out; };
// Einstieg mit gut bekannten Typen
const start = [['Normal', 'Käfer'], ['Pflanze'], ['Wasser', 'Normal'], ['Feuer', 'Pflanze'], ['Elektro']];

const levels = [];
let lastTypes = [];
for (let n = 1; n <= 50; n++) {
  let types;
  if (n <= start.length) types = start[n - 1];
  else {
    const size = n % 5 === 0 ? 1 : n > 30 && n % 3 === 0 ? 3 : 2; // jedes 5. Level ein reiner Typ, ab 30 manchmal drei
    do types = pick(TYPES, size); while (types.some((t) => lastTypes.includes(t)) && rnd() < 0.7);
  }
  lastTypes = types;
  const waves = Math.max(10, Math.min(15, 6 + Math.floor(n / 5) + (n % 10 === 0 ? 1 : 0))); // mindestens 10 Wellen
  levels.push({
    n,
    types,
    waves,
    enemyLevel: Math.round(6 + n * 0.56),
    countMult: +(0.62 + n * 0.017 + Math.max(0, n - 20) * 0.014).toFixed(2),
    finalStage: n < 8 ? 2 : 3, // ab Level 8 kommen auch Endentwicklungen
  });
}
fs.writeFileSync(path.join(ROOT, 'public/config/defense_levels.json'), JSON.stringify({
  _hinweis: 'PokeDefense-Level. types = Gegner-Typen, waves = Anzahl Wellen, enemyLevel = Level der Gegner in Welle 1 (+levelPerWave je Welle), countMult = Gegneranzahl-Faktor, finalStage = höchste Entwicklungsstufe in späten Wellen. Neu erzeugen: node tools/build_defense_levels.mjs',
  levels,
}, null, 1));
console.log('Level:', levels.length);
