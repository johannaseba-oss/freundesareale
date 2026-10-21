import { CFG, areaById, species, isHairy } from '../config.js';
import { hashString } from '../rng.js';
import { rollIvs } from './battle.js';
import { emptyContest, staminaOf, contestStart } from './contest.js';

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
    battle: { team: [], towers: [] },
    profile: { name: '', sprite: 1 },
    achievements: {},
    dexOwned: [],
    eggs: { pairs: {}, list: [] },
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
  s.battle ||= { team: [], towers: [] };
  s.profile ||= { name: '', sprite: 1 };
  s.defense ||= { team: [] };
  s.achievements ||= {};
  s.eggs ||= { pairs: {}, list: [] };
  s.dexOwned = [...new Set([...(s.dexOwned || []), ...s.pokemon.map((p) => p.dex)])];
  for (const k of ['battlesWon', 'battlesPlayed', 'grooms', 'eggsHatched']) s.stats[k] ||= 0;
  s.stats.beaten ||= {};
  // jedes Exemplar braucht eine eigene ID – doppelte (aus älteren Ständen) bekommen eine neue
  const seen = new Set();
  for (const p of s.pokemon) {
    if (p.uid == null || seen.has(p.uid)) p.uid = newUid(s, p.caughtAt || Date.now());
    seen.add(p.uid);
  }
  for (const p of s.pokemon) {
    p.effects ||= [];
    p.pet ||= { day: '', amount: 0 };
    p.berriesReady ||= {};
    if (p.coinBatches == null) {
      // alte Spielstände: aufgehäufte Münzen auf höchstens einen Takt begrenzen
      const max = (CFG.balance.coins.byRarity[species(p.dex)?.rarity] || CFG.balance.coins.byRarity.gewoehnlich).coins[1];
      p.coinsReady = Math.min(p.coinsReady || 0, max);
      p.coinBatches = p.coinsReady > 0 ? 1 : 0;
    }
    if (isHairy(p.dex) && p.cleanliness == null) p.cleanliness = CFG.grooming.startCleanliness;
    if (p.gender === undefined) p.gender = rollGender(p.dex, hashString('g' + p.uid) / 4294967296);
    ensureBattleData(p);
    if (p.levelMs == null) p.levelMs = Math.max(0, (p.level || 1) - 1) * 24 * 3600e3; // bisherigen Stand übernehmen
    if (p.area && !areaById(p.area)) p.area = null; // Areal wurde aus der Konfiguration entfernt
  }
  return s;
}

// Dauerhafte Werte je Exemplar: IVs (fest, beim Fang ausgewürfelt), EVs (aus Kämpfen), zusätzlich gekaufte Attacken (später),
// Wettbewerbspunkte und Ausdauer (nur für Minispiele, die sie ausdrücklich nutzen)
export function ensureBattleData(p) {
  p.ivs ||= rollIvs(`${p.uid}|${p.caughtAt}`);
  p.evs ||= [0, 0, 0, 0, 0, 0];
  p.moves ||= [];
  p.contest ||= emptyContest();
  // Startwerte der Art einmalig übernehmen – vorhandene Werte werden nur erhöht, nie gesenkt
  if (!p.contestInit) {
    const st = contestStart(p.dex, Math.abs(Math.floor(p.uid % 233280)));
    for (const [k, v] of Object.entries(st)) p.contest[k] = Math.max(p.contest[k] || 0, v);
    p.contestInit = true;
  }
  p.stamina ??= staminaOf(p.dex);
  return p;
}

// Eindeutige ID eines Exemplars (Zeitstempel + Zufall) – unabhängig von Pokédex-Nummer und Gerät,
// damit zwei Geräte nie dieselbe ID vergeben
export function newUid(s, t) {
  const used = new Set(s.pokemon.map((p) => p.uid));
  let u;
  do u = Math.floor(t) * 1000 + Math.floor(Math.random() * 1000); while (used.has(u));
  return u;
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
// Anzeigename: Spitzname, sonst Artname
export const nameOf = (p) => p.nick || species(p.dex)?.name || '';
export const genderSymbol = (p) => (p.gender === 'm' ? '♂' : p.gender === 'w' ? '♀' : '');
