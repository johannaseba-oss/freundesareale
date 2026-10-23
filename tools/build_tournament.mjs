// Erzeugt public/config/tournament.json: 100 Level für den Tournament Run im Chaos-Modus.
// Jedes Level hat ein Gegner-Thema (ein Typ oder gemischt), später kommen legendäre Pokémon als Boss dazu.
// Schwierigkeit (Wellen, Gegnerlevel, Anzahl) steigt über die 100 Level. Danach frei von Hand anpassbar.
// Aufruf: node tools/build_tournament.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = ['Feuer', 'Wasser', 'Pflanze', 'Elektro', 'Eis', 'Kampf', 'Gift', 'Boden', 'Flug', 'Psycho', 'Käfer', 'Gestein', 'Geist', 'Drache', 'Unlicht', 'Stahl', 'Fee', 'Normal'];
let seed = 20261023;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list, n) => { const l = [...list], out = []; while (out.length < n) out.push(l.splice(Math.floor(rnd() * l.length), 1)[0]); return out; };
// Einstieg mit gut bekannten Typen, danach alle Typen in gemischter Reihenfolge
const start = ['Normal', 'Käfer', 'Pflanze', 'Wasser'];
let bag = [];
const nextType = (last) => {
  if (!bag.length) bag = pick(TYPES, TYPES.length);
  const i = bag.findIndex((t) => t !== last);
  return bag.splice(Math.max(0, i), 1)[0];
};

const levels = [];
let last = null;
for (let n = 1; n <= 100; n++) {
  const mixed = n % 5 === 0;
  const types = n <= start.length ? [start[n - 1]] : mixed ? pick(TYPES, n < 50 ? 2 : 3) : [nextType(last)];
  if (!mixed) last = types[0];
  levels.push({
    n,
    types,
    mixed,
    waves: 4 + Math.floor(n / 12),
    enemyLevel: Math.round(8 + n * 0.65),
    countMult: +(0.6 + n * 0.01).toFixed(2),
    finalStage: n < 15 ? 2 : 3,
    legendary: (n >= 30 && n % 10 === 0) || (n >= 70 && n % 5 === 0), // legendärer Boss in der letzten Welle
  });
}
fs.writeFileSync(path.join(ROOT, 'public/config/tournament.json'), JSON.stringify({
  _hinweis: 'Tournament Run (Chaos-Modus): 100 Level. types = Gegner-Typen, mixed = gemischtes Team, waves = Anzahl großer Wellen, enemyLevel = Gegnerlevel in Welle 1 (+enemy.levelPerWave je Welle), countMult = Gegneranzahl-Faktor, finalStage = höchste Entwicklungsstufe, legendary = ein legendäres Pokémon als Boss in der letzten Welle. Eigene Pokémon kommen wie im Chaos-Modus zufällig aus Pokébällen. Neu erzeugen: node tools/build_tournament.mjs',
  levels,
}, null, 1));
console.log('Level:', levels.length, 'mit Legendären:', levels.filter((l) => l.legendary).map((l) => l.n).join(', '));
