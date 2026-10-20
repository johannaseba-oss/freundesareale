import { CFG, areaById, species, isHairy } from '../config.js';
import { hashString } from '../rng.js';

export const SCHEMA = 1;

export function newGame(nowMs) {
  const areas = {};
  for (const a of CFG.areas) areas[a.id] = { unlocked: a.unlockCost === 0, level: 0 };
  return {
    schema: SCHEMA,
    createdAt: nowMs,
    lastSim: nowMs,
    coins: CFG.balance.start.coins,
    nextUid: 1,
    pokemon: [],
    areas,
    gacha: null,
    berries: {},
    stats: { draws: 0, coinsEarned: 0 },
  };
}

// Ältere/fehlende Felder ergänzen (z. B. wenn neue Areale in areas.json dazukommen)
export function migrate(s) {
  s.schema = SCHEMA;
  s.areas ||= {};
  for (const [oldId, newId] of Object.entries(CFG.areaAliases || {})) {
    const o = s.areas[oldId];
    if (!o || !areaById(newId) || areaById(oldId)) continue;
    const n = (s.areas[newId] ||= { unlocked: false, level: 0 });
    n.unlocked = n.unlocked || o.unlocked;
    n.level = Math.max(n.level, o.level);
    n.ground = [...(n.ground || []), ...(o.ground || [])].slice(0, 3);
    delete s.areas[oldId];
    for (const p of s.pokemon) if (p.area === oldId) p.area = newId;
  }
  for (const a of CFG.areas) s.areas[a.id] ||= { unlocked: a.unlockCost === 0, level: 0 };
  s.stats ||= { draws: 0, coinsEarned: 0 };
  s.berries ||= {};
  for (const p of s.pokemon) {
    p.effects ||= [];
    p.pet ||= { day: '', amount: 0 };
    p.berriesReady ||= {};
    if (isHairy(p.dex) && p.cleanliness == null) p.cleanliness = CFG.grooming.startCleanliness;
    if (p.gender === undefined) p.gender = rollGender(p.dex, hashString('g' + p.uid) / 4294967296);
    if (p.area && !areaById(p.area)) p.area = null; // Areal wurde aus der Konfiguration entfernt
  }
  return s;
}

export const capacityOf = (s, areaId) => {
  const a = areaById(areaId);
  return a.capacity[Math.min(s.areas[areaId].level, a.capacity.length - 1)];
};
export const residents = (s, areaId) => s.pokemon.filter((p) => p.area === areaId);
export const xpForLevel = (lvl) => {
  const c = CFG.balance.level.xpForLevel;
  return Math.round(c.base * Math.pow(lvl, c.exponent));
};

// Geschlecht nach Art (PokeAPI gender_rate: -1 = geschlechtslos, sonst Anteil weiblich in Achteln)
export function rollGender(dex, r = Math.random()) {
  const g = species(dex)?.genderRate ?? -1;
  if (g < 0) return null;
  return r < g / 8 ? 'w' : 'm';
}
export const genderSymbol = (p) => (p.gender === 'm' ? '♂' : p.gender === 'w' ? '♀' : '');
