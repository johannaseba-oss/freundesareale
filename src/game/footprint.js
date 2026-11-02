// Fußabdruck-Minispiel (public/config/footprint.json): Runden auslosen, Antworten prüfen, Punkte und Rang.
import { CFG, species } from '../config.js';

const F = () => CFG.footprint;
const pool = () => F().dex.filter((d) => species(d));
const sample = (list, n, rnd) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};
const withOptions = (dex, others, rnd) => ({ dex, options: sample([dex, ...sample(others.filter((d) => d !== dex), 3, rnd)], 4, rnd) });

export const totalSeconds = () => F().phases.reduce((n, p) => n + p.seconds, 0);

// Normaler Modus: Fußabdrücke aus allen Pokémon
export function classicRound(rnd = Math.random) {
  const all = pool();
  return { mode: 'classic', questions: sample(all, F().rounds, rnd).map((d) => withOptions(d, all, rnd)) };
}

// Türsteher: Liste und wenige andere Pokémon, damit die Liste auch zählt; Antwortnamen stammen aus demselben kleinen Kreis
export function guardRound(rnd = Math.random) {
  const G = F().guard, N = F().rounds, type = rnd() < 0.5 ? 'black' : 'green', all = pool();
  const size = G.listSize[0] + Math.floor(rnd() * (G.listSize[1] - G.listSize[0] + 1));
  const list = sample(all, size, rnd);
  const onList = sample(list, Math.min(size, Math.round(N * G.listShare[type])), rnd);
  const extra = sample(all.filter((d) => !list.includes(d)), N - onList.length, rnd);
  const circle = [...list, ...extra];
  return { mode: 'guard', type, list, questions: sample([...onList, ...extra], N, rnd).map((d) => withOptions(d, circle, rnd)) };
}
export const mayEnter = (round, dex) => (round.type === 'black' ? !round.list.includes(dex) : round.list.includes(dex));
// pick = Pokédex-Nr. (antippen = hereinlassen) oder 'reject' (abweisen)
export function isCorrect(round, dex, pick) {
  if (round.mode !== 'guard') return pick === dex;
  return mayEnter(round, dex) ? pick === dex : pick === 'reject';
}

export const pointsFor = (share) => Math.round(F().scoring.base + F().scoring.speed * share);
export const maxPoints = () => F().rounds * (F().scoring.base + F().scoring.speed);
export const rankOf = (points) => F().scoring.ranks.find((r) => (100 * points) / maxPoints() >= r.min) || F().scoring.ranks.at(-1);

// Bestes Ergebnis je Modus merken
export function saveResult(s, mode, points, correct) {
  s.footprint ||= { best: {} };
  const old = s.footprint.best[mode], isNew = !old || points > old.points;
  if (isNew) s.footprint.best[mode] = { points, correct, rank: rankOf(points).id };
  return { ok: true, isNew };
}
