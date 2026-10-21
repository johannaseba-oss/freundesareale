// Wetter für die Kampfmodi (Arena, PokeDefense): nach Jahreszeit gewichtet, Typen-Bonus (battle.json weather).
import { CFG, species } from '../config.js';

const W = () => CFG.battle.weather;
export const weatherInfo = (id) => W().kinds[id];

// zufälliges Wetter (nicht das aktuelle), gewichtet nach der aktuellen Jahreszeit
export function pickWeather(rnd, current = null) {
  const month = new Date().getMonth() + 1;
  const season = Object.values(W().seasons).find((x) => x.months.includes(month)) || Object.values(W().seasons)[0];
  const ids = Object.keys(W().kinds).filter((k) => k !== current && (season.weights[k] || 0) > 0);
  let r = rnd() * ids.reduce((a, k) => a + season.weights[k], 0);
  return ids.find((k) => (r -= season.weights[k]) < 0) || ids[0];
}
export const nextWeatherIn = (rnd) => { const [a, b] = W().changeEverySeconds; return a + rnd() * (b - a); };
// Schaden-Faktor für einen Angreifer dieser Art
export const weatherBoost = (dex, id) => (weatherInfo(id).types.some((t) => species(dex).types.includes(t)) ? W().boost : 1);
export const weatherText = (id) => { const w = weatherInfo(id); return `${w.icon} ${w.name}${w.types.length ? ' – ' + w.types.join(' & ') + ' stärker' : ''}`; };
