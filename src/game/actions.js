// Alle Spieleraktionen. Jede Aktion verändert den Spielstand und gibt {ok, msg} zurück.
// Der Aufrufer (main.js) speichert danach automatisch in der Cloud.
import { CFG, areaById, berryById } from '../config.js';
import { dayKey } from '../time.js';
import { capacityOf, residents, rollGender } from './state.js';
import { modsFor } from './bonuses.js';
import { coinRatePerHour } from './sim.js';
import { takeRandomBall } from './gacha.js';

const clamp = (v) => Math.max(0, Math.min(100, v));
const fail = (msg) => ({ ok: false, msg });

export function feed(s, p) {
  const n = CFG.balance.needs;
  if (p.fullness >= 99) return fail('Schon satt.');
  p.fullness = clamp(p.fullness + n.feedAmount);
  p.satisfaction = clamp(p.satisfaction + n.feedSatisfaction);
  p.affection = clamp(p.affection + n.feedAffection);
  return { ok: true };
}

// Streicheln: Zufriedenheit steigt immer, Zuneigung nur bis zum Tageslimit
export function pet(s, p, t) {
  const n = CFG.balance.needs;
  const day = dayKey(t);
  if (p.pet.day !== day) p.pet = { day, amount: 0 };
  p.satisfaction = clamp(p.satisfaction + n.petSatisfaction);
  const gain = Math.min(n.petAffection, Math.max(0, n.petAffectionPerDayMax - p.pet.amount));
  p.pet.amount += gain;
  p.affection = clamp(p.affection + gain);
  return { ok: true, affectionGain: gain };
}

export function collectCoins(s, list) {
  let total = 0;
  const berries = {};
  for (const p of list) {
    total += p.coinsReady; p.coinsReady = 0;
    for (const [id, n] of Object.entries(p.berriesReady || {})) { berries[id] = (berries[id] || 0) + n; s.berries[id] = (s.berries[id] || 0) + n; }
    p.berriesReady = {};
  }
  s.coins += total;
  s.stats.coinsEarned += total;
  const berryCount = Object.values(berries).reduce((x, y) => x + y, 0);
  return { ok: total > 0 || berryCount > 0, total, berries, berryCount };
}

export function giveBerry(s, p, berryId, t) {
  const b = berryById(berryId);
  if (!p.area) return fail('Beeren wirken nur bei Pokémon in einem Areal.');
  // zuerst aus dem Inventar, sonst mit Glücksmünzen kaufen
  if ((s.berries[b.id] || 0) > 0) s.berries[b.id]--;
  else if (s.coins < b.cost) return fail('Keine im Inventar und nicht genug Glücksmünzen.');
  else s.coins -= b.cost;
  if (b.effect === 'zeitsprung') {
    p.coinProgress += coinRatePerHour(p, t, modsFor(s, p)) * b.hours;
    while (p.coinProgress >= 1) { p.coinProgress -= 1; p.coinsReady++; }
  } else if (b.effect === 'produktion') {
    const existing = p.effects.find((e) => e.berry === b.id && e.until > t);
    if (existing) existing.until += b.hours * 3600e3; // gleiche Beere verlängert die Dauer
    else p.effects.push({ type: 'produktion', berry: b.id, factor: b.factor, until: t + b.hours * 3600e3 });
  }
  return { ok: true };
}

export function assign(s, p, areaId) {
  if (areaId) {
    if (!s.areas[areaId]?.unlocked) return fail('Dieses Areal ist noch nicht freigeschaltet.');
    if (p.area !== areaId && residents(s, areaId).length >= capacityOf(s, areaId)) return fail('Das Areal ist voll. Vergrößere es oder wähle ein anderes.');
  }
  p.area = areaId || null;
  return { ok: true };
}

export function unlockArea(s, areaId) {
  const a = areaById(areaId);
  if (s.areas[areaId].unlocked) return fail('Schon freigeschaltet.');
  if (s.coins < a.unlockCost) return fail('Nicht genug Glücksmünzen.');
  s.coins -= a.unlockCost;
  s.areas[areaId].unlocked = true;
  return { ok: true };
}

export function upgradeArea(s, areaId) {
  const a = areaById(areaId), st = s.areas[areaId];
  if (st.level >= a.capacity.length - 1) return fail('Höchste Ausbaustufe erreicht.');
  const cost = a.upgradeCost[st.level];
  if (s.coins < cost) return fail('Nicht genug Glücksmünzen.');
  s.coins -= cost;
  st.level++;
  return { ok: true };
}

export function draw(s, t) {
  const cost = CFG.balance.gacha.drawCost;
  if (!s.gacha?.balls.length) return fail('Der Automat ist für heute leer.');
  if (s.coins < cost) return fail('Nicht genug Glücksmünzen.');
  const ball = takeRandomBall(s);
  s.coins -= cost;
  s.stats.draws++;
  const p = {
    uid: s.nextUid++, dex: ball.dex, ball: ball.ball, caughtAt: t, area: null,
    level: 1, xp: 0, fullness: CFG.balance.newPokemon.fullness, satisfaction: CFG.balance.newPokemon.satisfaction, affection: CFG.balance.newPokemon.affection,
    gender: rollGender(ball.dex), coinProgress: 0, coinsReady: 0, berryProgress: 0, berriesReady: {}, effects: [], pet: { day: '', amount: 0 },
  };
  s.pokemon.push(p);
  return { ok: true, pokemon: p, ball };
}
