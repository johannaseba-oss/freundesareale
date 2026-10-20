// Lädt die anpassbaren Spieldaten aus public/config und public/data.
export const CFG = { balance: null, areas: [], dex: [], dexById: new Map(), bonuses: null, social: null, berryProducers: new Map() };

export async function loadConfig() {
  const base = import.meta.env.BASE_URL;
  const get = (p) => fetch(base + p, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  });
  const [balance, areas, dex, bonuses, social] = await Promise.all([get('config/balance.json'), get('config/areas.json'), get('data/pokedex.json'), get('config/bonuses.json'), get('config/social.json')]);
  CFG.balance = balance;
  CFG.areas = areas.areas;
  CFG.dex = dex;
  CFG.dexById = new Map(dex.map((p) => [p.dex, p]));
  CFG.bonuses = bonuses;
  CFG.social = social;
  CFG.berryProducers = new Map();
  for (const g of balance.berryProduction.producers) for (const d of g.dex) CFG.berryProducers.set(d, g.berries);
}

export const areaById = (id) => CFG.areas.find((a) => a.id === id);
export const species = (dex) => CFG.dexById.get(dex);
export const berryById = (id) => CFG.balance.berries.find((b) => b.id === id);
export const ballById = (id) => CFG.balance.gacha.balls.find((b) => b.id === id);
