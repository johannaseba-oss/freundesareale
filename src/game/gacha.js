// Pokéball-Automat mit festem Wochen-Pool.
// Zu Wochenbeginn wird einmal festgelegt, welches Pokémon in welchem Ball steckt. Ein Teil der Bälle liegt im Automaten
// (mit gespeicherten Positionen), der Rest wartet in fester Reihenfolge und wird nach jeder Ziehung von oben nachgefüllt.
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

export function ensureWeeklyPool(s, nowMs, userId) {
  const g = CFG.balance.gacha;
  const week = weekKey(nowMs);
  if (s.gacha && s.gacha.week === week) return false;
  const rnd = mulberry32(hashString(`${userId}|week|${week}`));
  const byRarity = {};
  for (const p of CFG.dex) (byRarity[p.rarity] ||= []).push(p.dex);
  const usable = g.balls.filter((b) => byRarity[b.rarity]?.length);
  const pool = [];
  for (let i = 0; i < g.ballsPerWeek; i++) {
    const ball = weightedPick(usable, (b) => b.weight, rnd);
    const list = byRarity[ball.rarity];
    pool.push({ key: Math.floor(rnd() * 1e9) * 100 + i, ball: ball.id, dex: list[Math.floor(rnd() * list.length)], x: null, y: null });
  }
  s.gacha = { week, machine: pool.slice(0, g.machineCapacity), queue: pool.slice(g.machineCapacity), reveal: null };
  return true;
}

// Ball mit festem Inhalt ausgeben und von oben einen neuen aus dem Wochen-Pool nachfüllen
export function dispenseBall(s, key) {
  const m = s.gacha.machine;
  let i = m.findIndex((b) => b.key === key);
  if (i < 0) i = m.reduce((best, b, j) => ((b.y ?? 0) > (m[best].y ?? 0) ? j : best), 0); // Rückfall: unterster Ball
  const ball = m.splice(i, 1)[0];
  if (s.gacha.queue.length) m.push({ ...s.gacha.queue.shift(), x: null, y: null });
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
