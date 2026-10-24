// Lädt die anpassbaren Spieldaten aus public/config und public/data.
export const CFG = { balance: null, areas: [], dex: [], dexById: new Map(), bonuses: null, social: null, grooming: null, types: null, berryProducers: new Map(), battle: null, battleData: null, contest: null, achievements: null, balls: null, defense: null, defenseLevels: null, defenseThemes: null, music: null, route: null, routeLevels: null, routeTiles: null, rocks: null };

export async function loadConfig() {
  const base = import.meta.env.BASE_URL;
  const get = (p) => fetch(base + p, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  });
  const [balance, areas, dex, bonuses, social, grooming, types, battle, battleData, contest, achievements, balls, defense, defenseLevels, defenseThemes, music, route, routeLevels, routeTiles, rocks] = await Promise.all([get('config/balance.json'), get('config/areas.json'), get('data/pokedex.json'), get('config/bonuses.json'), get('config/social.json'), get('config/grooming.json'), get('config/types.json'), get('config/battle.json'), get('data/battle.json'), get('config/contest.json'), get('config/achievements.json'), get('config/balls.json'), get('config/defense.json'), get('config/defense_levels.json'), get('config/defense_themes.json'), get('config/music.json'), get('config/route.json'), get('config/route_levels.json'), get('config/route_tiles.json'), get('config/rocks.json')]);
  CFG.balance = balance;
  CFG.areas = areas.areas;
  CFG.areaAliases = areas.aliases || {};
  CFG.dex = dex;
  CFG.dexById = new Map(dex.map((p) => [p.dex, p]));
  CFG.bonuses = bonuses;
  CFG.social = social;
  CFG.grooming = grooming;
  CFG.types = types;
  CFG.battle = battle;
  CFG.battleData = battleData;
  CFG.contest = contest;
  CFG.achievements = achievements;
  CFG.balls = balls;
  CFG.defense = defense;
  CFG.defenseLevels = defenseLevels;
  CFG.defenseThemes = defenseThemes;
  CFG.music = music;
  CFG.route = route;
  CFG.routeLevels = routeLevels;
  CFG.routeTiles = routeTiles;
  CFG.rocks = rocks;
  CFG.berryProducers = new Map();
  for (const g of balance.berryProduction.producers) for (const d of g.dex) CFG.berryProducers.set(d, g.berries);
}

export const areaById = (id) => CFG.areas.find((a) => a.id === id);
export const species = (dex) => CFG.dexById.get(dex);
export const berryById = (id) => CFG.balance.berries.find((b) => b.id === id);
export const ballById = (id) => CFG.balance.gacha.balls.find((b) => b.id === id);

// Haarige Pokémon (nur sie haben Sauberkeit und das Putz-Minispiel)
export const furOf = (dex) => CFG.grooming?.pokemon[dex] || null;
export const isHairy = (dex) => !!furOf(dex);
