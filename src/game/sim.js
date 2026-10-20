// Zeitbasierte Simulation: rechnet den Spielstand vom letzten Zeitstempel bis "jetzt" weiter.
// Läuft in festen Schritten, damit Hunger, Zufriedenheit, Beeren-Effekte, Gruppen-/Legendären-Boni und Level
// sich korrekt gegenseitig beeinflussen, auch wenn die App tagelang geschlossen war.
// (Wer in welchem Areal wohnt, ändert sich nur durch Aktionen – die Boni sind also während eines Laufs konstant.)
import { CFG, isHairy, species } from '../config.js';
import { HOUR } from '../time.js';
import { hashString } from '../rng.js';
import { xpForLevel } from './state.js';
import { allMods, modsFor } from './bonuses.js';
import { habitatFit } from './habitat.js';
import { mood, socialClimate } from './mood.js';
import { mulberry32, weightedPick } from '../rng.js';

const clamp = (v) => Math.max(0, Math.min(100, v));
const tierFactor = (table, value) => (table.find((t) => value >= t.min) || table[table.length - 1]).factor;
const levelFactor = (p) => 1 + CFG.balance.coins.levelSpeedupPerLevel * (p.level - 1);

const coinTable = (p) => CFG.balance.coins.byRarity[species(p.dex)?.rarity] || CFG.balance.coins.byRarity.gewoehnlich;
const seeded = (p, tag) => hashString(`${p.uid}|${tag}|${p.coinCycles || 0}`) / 4294967296;
// Dauer des aktuellen Takts (Minuten) und Münzen, die er bringt – festgelegt durch Pokémon + Taktnummer
export function cycleMinutes(p) { const r = coinTable(p).minutes; return r[0] + seeded(p, 'd') * (r[1] - r[0]); }
export function cycleCoins(p) { const r = coinTable(p).coins; return r[0] + Math.floor(seeded(p, 'y') * (r[1] - r[0] + 1)); }
export const coinRange = (p) => coinTable(p).coins;

export function coinRatePerHour(p, t, m) {
  const c = CFG.balance.coins;
  if (p.area && habitatFit(p.dex, p.area).fit < 0) return 0; // fühlt sich im Areal unwohl -> produziert keine Münzen
  let rate = (60 / cycleMinutes(p)) * levelFactor(p) * tierFactor(c.satisfactionFactor, mood(p, t));
  for (const e of p.effects) if (e.type === 'produktion' && e.until > t) rate *= e.factor;
  return rate * (m?.coin ?? 1);
}

export function berryRatePerHour(p, m, t = Date.now()) {
  if (!CFG.berryProducers.has(p.dex)) return 0;
  const bp = CFG.balance.berryProduction;
  return (1 / bp.baseIntervalHours) * levelFactor(p) * tierFactor(CFG.balance.coins.satisfactionFactor, mood(p, t)) * (m?.berry ?? 1);
}

function pickBerry(p) {
  const w = CFG.berryProducers.get(p.dex);
  const ids = Object.keys(w), total = ids.reduce((s, k) => s + w[k], 0);
  let r = (hashString(`${p.uid}|${p.berriesMade || 0}`) / 4294967296) * total;
  for (const k of ids) { r -= w[k]; if (r < 0) return k; }
  return ids[0];
}

function stepPokemon(p, t, dtH, m, fit, social) {
  const b = CFG.balance, n = b.needs, L = b.level;
  p.fullness = clamp(p.fullness - n.hungerPerHour * m.hunger * dtH);
  const decay = p.fullness < n.hungryBelow ? n.satisfactionDecayHungryPerHour : n.satisfactionDecayPerHour;
  p.satisfaction = clamp(p.satisfaction - decay * m.sat * dtH + (n.habitatPerHour || 0) * fit * dtH + (CFG.social.socialPerHour || 0) * social * dtH);
  if (p.petBoost && p.petBoost.until <= t) p.petBoost = null;
  // Sauberkeit (nur haarige Pokémon): sinkt langsam, wirkt leicht auf die Zufriedenheit
  if (p.cleanliness != null && isHairy(p.dex)) {
    const G = CFG.grooming;
    p.cleanliness = clamp(p.cleanliness - G.cleanPerHour * dtH);
    p.satisfaction = clamp(p.satisfaction + G.effectPerHour * ((p.cleanliness - 50) / 50) * dtH);
  }
  if (n.affectionDecayPerDay) p.affection = clamp(p.affection - (n.affectionDecayPerDay / 24) * dtH);

  if (p.level < L.max) {
    p.xp += L.xpPerHour * dtH * m.xp * tierFactor(L.satisfactionFactor, mood(p, t)) * (1 + L.affectionBonusAt100 * (p.affection / 100));
    while (p.level < L.max && p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; p.levelUps = (p.levelUps || 0) + 1; }
  }

  p.coinProgress += coinRatePerHour(p, t, m) * dtH;
  const cap = b.coins.storageCapPerPokemon;
  while (p.coinProgress >= 1) {
    if (cap && p.coinsReady >= cap) { p.coinProgress = 1; break; }
    p.coinProgress -= 1;
    p.coinsReady += cycleCoins(p);
    p.coinCycles = (p.coinCycles || 0) + 1;
  }

  const br = berryRatePerHour(p, m, t);
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
  const socials = new Map(living.map((p) => [p.uid, socialClimate(p, living.filter((q) => q.area === p.area))]));
  spawnGroundBerries(s, nowMs);
  while (t < nowMs) {
    const dt = Math.min(step, nowMs - t);
    t += dt;
    for (const p of living) stepPokemon(p, t, dt / HOUR, mods.get(p.uid), fits.get(p.uid), socials.get(p.uid));
  }
  s.lastSim = nowMs;
  return true;
}

// Zeit bis zur nächsten Münze / Beere (Schätzung mit aktueller Rate inkl. Boni)
export function msToNextCoin(s, p, t) {
  const r = coinRatePerHour(p, t, modsFor(s, p));
  return r ? ((1 - p.coinProgress) / r) * HOUR : Infinity;
}
export function msToNextBerry(s, p) {
  const r = berryRatePerHour(p, modsFor(s, p), Date.now());
  return r ? ((1 - (p.berryProgress || 0)) / r) * HOUR : Infinity;
}

// Zufällig auftauchende Beeren in freigeschalteten Arealen (Position 0-1 relativ zur begehbaren Fläche)
export function spawnGroundBerries(s, nowMs) {
  const G = CFG.social.groundBerries;
  for (const a of CFG.areas) {
    const st = s.areas[a.id];
    if (!st?.unlocked) continue;
    st.ground ||= [];
    const rnd = mulberry32((st.berrySeed || 1) * 2654435761);
    const next = () => (G.everyHours[0] + rnd() * (G.everyHours[1] - G.everyHours[0])) * HOUR;
    if (!st.nextBerryAt) st.nextBerryAt = nowMs + next();
    let guard = 0;
    while (st.nextBerryAt <= nowMs && guard++ < 50) {
      if (st.ground.length < G.maxPerArea) {
        const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.9;
        st.ground.push({ id: (st.berrySeed * 1000 + guard) | 0, berry: weightedPick(Object.keys(G.weights), (k) => G.weights[k], rnd), u: Math.cos(ang) * r, v: Math.sin(ang) * r });
      }
      st.nextBerryAt += next();
    }
    if (guard > 1) st.berrySeed = (st.berrySeed || 1) + guard;
  }
}
