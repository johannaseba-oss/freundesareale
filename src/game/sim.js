// Zeitbasierte Simulation: rechnet den Spielstand vom letzten Zeitstempel bis "jetzt" weiter.
// Läuft in festen Schritten, damit Hunger, Zufriedenheit, Beeren-Effekte, Gruppen-/Legendären-Boni und Level
// sich korrekt gegenseitig beeinflussen, auch wenn die App tagelang geschlossen war.
// (Wer in welchem Areal wohnt, ändert sich nur durch Aktionen – die Boni sind also während eines Laufs konstant.)
import { CFG } from '../config.js';
import { HOUR } from '../time.js';
import { hashString } from '../rng.js';
import { xpForLevel } from './state.js';
import { allMods, modsFor } from './bonuses.js';
import { habitatFit } from './habitat.js';

const clamp = (v) => Math.max(0, Math.min(100, v));
const tierFactor = (table, value) => (table.find((t) => value >= t.min) || table[table.length - 1]).factor;
const levelFactor = (p) => 1 + CFG.balance.coins.levelSpeedupPerLevel * (p.level - 1);

export function coinRatePerHour(p, t, m) {
  const c = CFG.balance.coins;
  let rate = (1 / c.baseIntervalHours) * levelFactor(p) * tierFactor(c.satisfactionFactor, p.satisfaction);
  for (const e of p.effects) if (e.type === 'produktion' && e.until > t) rate *= e.factor;
  return rate * (m?.coin ?? 1);
}

export function berryRatePerHour(p, m) {
  if (!CFG.berryProducers.has(p.dex)) return 0;
  const bp = CFG.balance.berryProduction;
  return (1 / bp.baseIntervalHours) * levelFactor(p) * tierFactor(CFG.balance.coins.satisfactionFactor, p.satisfaction) * (m?.berry ?? 1);
}

function pickBerry(p) {
  const w = CFG.berryProducers.get(p.dex);
  const ids = Object.keys(w), total = ids.reduce((s, k) => s + w[k], 0);
  let r = (hashString(`${p.uid}|${p.berriesMade || 0}`) / 4294967296) * total;
  for (const k of ids) { r -= w[k]; if (r < 0) return k; }
  return ids[0];
}

function stepPokemon(p, t, dtH, m, fit) {
  const b = CFG.balance, n = b.needs, L = b.level;
  p.fullness = clamp(p.fullness - n.hungerPerHour * m.hunger * dtH);
  const decay = p.fullness < n.hungryBelow ? n.satisfactionDecayHungryPerHour : n.satisfactionDecayPerHour;
  p.satisfaction = clamp(p.satisfaction - decay * m.sat * dtH + (n.habitatPerHour || 0) * fit * dtH);
  if (n.affectionDecayPerDay) p.affection = clamp(p.affection - (n.affectionDecayPerDay / 24) * dtH);

  if (p.level < L.max) {
    p.xp += L.xpPerHour * dtH * m.xp * tierFactor(L.satisfactionFactor, p.satisfaction) * (1 + L.affectionBonusAt100 * (p.affection / 100));
    while (p.level < L.max && p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; p.levelUps = (p.levelUps || 0) + 1; }
  }

  p.coinProgress += coinRatePerHour(p, t, m) * dtH;
  const cap = b.coins.storageCapPerPokemon;
  while (p.coinProgress >= 1) {
    if (cap && p.coinsReady >= cap) { p.coinProgress = 1; break; }
    p.coinProgress -= 1; p.coinsReady++;
  }

  const br = berryRatePerHour(p, m);
  if (br) {
    p.berryProgress = (p.berryProgress || 0) + br * dtH;
    const bcap = b.berryProduction.storageCapPerPokemon;
    while (p.berryProgress >= 1) {
      const ready = Object.values(p.berriesReady).reduce((s, v) => s + v, 0);
      if (bcap && ready >= bcap) { p.berryProgress = 1; break; }
      p.berryProgress -= 1;
      const id = pickBerry(p);
      p.berriesReady[id] = (p.berriesReady[id] || 0) + 1;
      p.berriesMade = (p.berriesMade || 0) + 1;
    }
  }
  p.effects = p.effects.filter((e) => e.until > t);
}

// Nur Pokémon, die in einem Areal leben, verändern sich. Pokémon in der Sammlung (ohne Areal) ruhen.
export function simulate(s, nowMs) {
  const sim = CFG.balance.simulation;
  let t = Math.max(s.lastSim, nowMs - sim.maxOfflineDays * 24 * HOUR);
  if (nowMs <= t) return false;
  const step = sim.stepMinutes * 60e3;
  const living = s.pokemon.filter((p) => p.area);
  const mods = allMods(s);
  const fits = new Map(living.map((p) => [p.uid, habitatFit(p.dex, p.area).fit]));
  while (t < nowMs) {
    const dt = Math.min(step, nowMs - t);
    t += dt;
    for (const p of living) stepPokemon(p, t, dt / HOUR, mods.get(p.uid), fits.get(p.uid));
  }
  s.lastSim = nowMs;
  return true;
}

// Zeit bis zur nächsten Münze / Beere (Schätzung mit aktueller Rate inkl. Boni)
export function msToNextCoin(s, p, t) {
  return ((1 - p.coinProgress) / coinRatePerHour(p, t, modsFor(s, p))) * HOUR;
}
export function msToNextBerry(s, p) {
  const r = berryRatePerHour(p, modsFor(s, p));
  return r ? ((1 - (p.berryProgress || 0)) / r) * HOUR : Infinity;
}
