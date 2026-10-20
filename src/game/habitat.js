// Wie gut passt ein Areal zu einem Pokémon? Ergebnis -1 (unwohl) .. +1 (wohl), wirkt langsam auf die Zufriedenheit.
import { species, areaById } from '../config.js';

export function habitatFit(dex, areaId) {
  const a = areaById(areaId), sp = species(dex);
  if (!a || !sp) return { fit: 0, likes: [], dislikes: [] };
  const likes = sp.types.filter((t) => (a.likes || []).includes(t));
  const dislikes = a.allTypes ? [] : sp.types.filter((t) => (a.dislikes || []).includes(t)); // Allround-Areale: niemand fühlt sich unwohl
  return { fit: Math.max(-1, Math.min(1, likes.length - dislikes.length)), likes, dislikes };
}

export function habitatText(dex, areaId) {
  const h = habitatFit(dex, areaId), name = areaById(areaId)?.name;
  if (h.fit > 0) return `Fühlt sich in ${name} wohl (${h.likes.join(', ')}) – wird mit der Zeit zufriedener.`;
  if (h.fit < 0) return `Fühlt sich in ${name} nicht so wohl (${h.dislikes.join(', ')}) – wird mit der Zeit unzufriedener.`;
  if (h.likes.length) return `${name} passt teils gut, teils weniger – neutral.`;
  if (areaById(areaId)?.allTypes) return `${name} ist für alle Pokémon geeignet.`;
  return `${name} ist für dieses Pokémon neutral.`;
}
