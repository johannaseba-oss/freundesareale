// Pokéball-Automat: Im Automaten liegen immer machineCapacity Bälle (mit gespeicherten Positionen). Jeder Ball bekommt
// seinen Inhalt rein zufällig, wenn er in den Automaten fällt (Seltenheit nach Gewichten, Art gleichverteilt) – nach jeder
// Ziehung fällt sofort ein neuer, frisch ausgeloster Ball von oben nach.
// Welcher Ball herauskommt, entscheidet die Physik im Automaten (siehe ui/gacha.js) – nie ein Würfelwurf beim Ziehen.
import { CFG, species } from '../config.js';
import { hashString, mulberry32, weightedPick } from '../rng.js';
import { mood } from './mood.js';

const pad = (n) => String(n).padStart(2, '0');
function weekStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Montag
  return d;
}
export const weekKey = (ms) => { const d = weekStart(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const nextWeekStart = (ms) => { const d = weekStart(ms); d.setDate(d.getDate() + 7); return d.getTime(); };

// nur über den Spielautomaten erhältlich (slots.json exclusive)
const slotOnly = (dex) => !!CFG.slots?.exclusive?.includes(dex);
// ältere Wochen-Pools: Spielautomat-exklusive Pokémon gegen andere derselben Seltenheit tauschen
function dropSlotOnly(s) {
  let changed = false;
  for (const b of [...(s.gacha?.machine || []), ...(s.gacha?.queue || [])]) {
    if (!slotOnly(b.dex)) continue;
    const r = species(b.dex)?.rarity, list = CFG.dex.filter((p) => p.rarity === r && !slotOnly(p.dex)).map((p) => p.dex);
    if (list.length) { b.dex = list[hashString('swap' + b.key) % list.length]; changed = true; }
  }
  return changed;
}
// ein Ball mit zufälligem Inhalt
function makeBall(rnd = Math.random, i = 0) {
  const g = CFG.balance.gacha, byRarity = {};
  for (const p of CFG.dex) if (!slotOnly(p.dex)) (byRarity[p.rarity] ||= []).push(p.dex); // Spielautomat-exklusive fehlen hier
  const ball = weightedPick(g.balls.filter((b) => byRarity[b.rarity]?.length), (b) => b.weight, rnd);
  const list = byRarity[ball.rarity];
  return { key: Math.floor(rnd() * 1e9) * 100 + (i % 100), ball: ball.id, dex: list[Math.floor(rnd() * list.length)], x: null, y: null };
}
// Automat immer bis machineCapacity mit frisch ausgelosten Bällen füllen (der Automat wird nie leer)
function topUp(s) {
  const g = CFG.balance.gacha, m = s.gacha.machine;
  let added = false;
  while (m.length < g.machineCapacity) { const n = (s.gacha.extra = (s.gacha.extra || 0) + 1); m.push(makeBall(Math.random, n)); added = true; }
  return added;
}
// ältere Spielstände (fester Wochen-Pool): alle Bälle im Automaten einmal neu auslosen, Warteschlange verwerfen
function rerollOld(s) {
  if (s.gacha.v === 2) return false;
  s.gacha.machine = s.gacha.machine.map((b, i) => ({ ...makeBall(Math.random, i), x: b.x, y: b.y }));
  s.gacha.queue = []; s.gacha.reveal = null; s.gacha.v = 2;
  return true;
}

export function ensureWeeklyPool(s, nowMs, userId) {
  const g = CFG.balance.gacha;
  const week = weekKey(nowMs);
  if (s.gacha?.machine) { const r = rerollOld(s), d = dropSlotOnly(s); s.gacha.week = week; return topUp(s) || r || d; }
  s.gacha = { week, machine: Array.from({ length: g.machineCapacity }, (_, i) => makeBall(Math.random, i)), queue: [], reveal: null, v: 2 };
  return true;
}

// Ball mit festem Inhalt ausgeben und von oben einen neuen nachfüllen
export function dispenseBall(s, key) {
  const m = s.gacha.machine;
  let i = m.findIndex((b) => b.key === key);
  if (i < 0) i = m.reduce((best, b, j) => ((b.y ?? 0) > (m[best].y ?? 0) ? j : best), 0); // Rückfall: unterster Ball
  const ball = m.splice(i, 1)[0];
  topUp(s); // sofort ein neuer Ball von oben
  if (s.gacha.reveal) s.gacha.reveal.keys = s.gacha.reveal.keys.filter((k) => k !== ball.key);
  return ball;
}

// ---- Psycho-Blick ----
export const revealActive = (s, t) => (s.gacha?.reveal && s.gacha.reveal.until > t ? s.gacha.reveal : null);
export const isPsychic = (p) => species(p.dex)?.types.includes('Psycho');
export function canForesee(p, t) {
  return isPsychic(p) && !!p.area && mood(p, t) >= CFG.balance.gacha.psychic.minMood;
}
export const foreseers = (s, t) => s.pokemon.filter((p) => canForesee(p, t)).sort((a, b) => mood(b, t) - mood(a, t));
