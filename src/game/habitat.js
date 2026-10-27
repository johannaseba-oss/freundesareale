// Wie gut passt ein Areal zu einem Pokémon? Ergebnis -1 (unwohl) .. +1 (wohl), wirkt langsam auf die Zufriedenheit.
import { species, areaById } from '../config.js';

// Areale mit only-Liste (z. B. Tiefsee nur für Fische): nur diese Arten dürfen einziehen
export const allowedIn = (dex, areaId) => { const a = areaById(areaId); return !a?.only || a.only.includes(dex); };
export function habitatFit(dex, areaId) {
  const a = areaById(areaId), sp = species(dex);
  if (!a || !sp) return { fit: 0, likes: [], dislikes: [] };
  if (a.only) return a.only.includes(dex) ? { fit: 1, likes: [...sp.types], dislikes: [] } : { fit: -1, likes: [], dislikes: [...sp.types] };
  const likes = sp.types.filter((t) => (a.likes || []).includes(t));
  const dislikes = a.allTypes ? [] : sp.types.filter((t) => (a.dislikes || []).includes(t)); // Allround-Areale: niemand fühlt sich unwohl
  return { fit: Math.max(-1, Math.min(1, likes.length - dislikes.length)), likes, dislikes };
}

// Geeignet = mindestens ein Typ passt zum Areal (oder Allround-Areal) – Voraussetzung für Levelaufstiege
export function suitsArea(dex, areaId) {
  const a = areaById(areaId), sp = species(dex);
  if (!a || !sp) return false;
  if (a.only) return a.only.includes(dex);
  return !!a.allTypes || sp.types.some((t) => (a.likes || []).includes(t));
}

export function habitatText(dex, areaId) {
  const h = habitatFit(dex, areaId), name = areaById(areaId)?.name;
  if (h.fit > 0) return `Fühlt sich in ${name} wohl (${h.likes.join(', ')}) – wird mit der Zeit zufriedener.`;
  if (h.fit < 0) return `Fühlt sich in ${name} nicht so wohl (${h.dislikes.join(', ')}) – wird mit der Zeit unzufriedener.`;
  if (h.likes.length) return `${name} passt teils gut, teils weniger – neutral.`;
  if (areaById(areaId)?.allTypes) return `${name} ist für alle Pokémon geeignet.`;
  return `${name} ist für dieses Pokémon neutral.`;
}
