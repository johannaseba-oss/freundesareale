// Täglicher Pokéball-Automat: pro Tag eine gewichtete Zufallsfüllung, die im Spielstand gespeichert wird.
import { CFG } from '../config.js';
import { dayKey } from '../time.js';
import { hashString, mulberry32, weightedPick } from '../rng.js';

export function ensureDailyPool(s, nowMs, userId) {
  const g = CFG.balance.gacha;
  const day = dayKey(nowMs, g.dayStartsAtHour);
  if (s.gacha && s.gacha.day === day) return false;
  const rnd = mulberry32(hashString(`${userId}|${day}`));
  const byRarity = {};
  for (const p of CFG.dex) (byRarity[p.rarity] ||= []).push(p.dex);
  const usable = g.balls.filter((b) => byRarity[b.rarity]?.length);
  const balls = [];
  for (let i = 0; i < g.ballsPerDay; i++) {
    const ball = weightedPick(usable, (b) => b.weight, rnd);
    const pool = byRarity[ball.rarity];
    balls.push({ ball: ball.id, dex: pool[Math.floor(rnd() * pool.length)], seed: Math.floor(rnd() * 1e9) });
  }
  s.gacha = { day, balls };
  return true;
}

// Zieht einen zufälligen Ball aus dem Automaten. Gibt den Ball zurück (ohne Münzabzug; siehe actions.draw).
export function takeRandomBall(s) {
  const balls = s.gacha.balls;
  if (!balls.length) return null;
  const i = Math.floor(Math.random() * balls.length);
  return balls.splice(i, 1)[0];
}
