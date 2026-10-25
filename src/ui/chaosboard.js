// Chaos-Rangliste: klein und schlicht – Trainerbild + Rekordwelle aller Spielerinnen (eigene Zeile hervorgehoben).
// Daten kommen aus der Datenbankfunktion chaos_board() (supabase/chaos_board.sql); fehlt sie, bleibt die Anzeige leer.
import { app } from '../app.js';
import { h } from './dom.js';

const base = import.meta.env.BASE_URL;
let cache = null, cacheAt = 0;
export async function loadChaosBoard(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30000) return cache;
  try { cache = (await app.backend?.chaosBoard?.()) || null; } catch { cache = null; }
  cacheAt = Date.now();
  return cache;
}
// Kopf des Trainers (erstes Bild der Laufanimation, Blick nach vorn) als kleines Canvas
const imgs = new Map();
export function trainerHead(sprite, size = 22) {
  const c = h('canvas.cb-head', { width: 40, height: 40 });
  c.style.width = c.style.height = size + 'px';
  let im = imgs.get(sprite);
  if (!im) { im = new Image(); im.src = `${base}art/trainers/${sprite || 1}.png`; imgs.set(sprite, im); }
  const draw = () => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, 40, 40); x.drawImage(im, 12, 6, 40, 40, 0, 0, 40, 40); };
  if (im.complete && im.naturalWidth) draw(); else im.addEventListener('load', draw, { once: true });
  return c;
}
// Liste: [{ me, name, sprite, best }]; myBest = eigener Stand (z. B. laufende Welle), max = wie viele Einträge
export function boardEl(list, { myBest = 0, max = 6, cls = '' } = {}) {
  if (!list) return h('div.cb.hidden');
  const rows = list.map((r) => ({ ...r, best: r.me ? Math.max(r.best, myBest) : r.best }));
  if (!rows.some((r) => r.me) && myBest > 0) rows.push({ me: true, name: app.state.profile?.name || 'Ich', sprite: app.state.profile?.sprite || 1, best: myBest });
  rows.sort((a, b) => b.best - a.best);
  let shown = rows.filter((r) => r.best > 0).slice(0, max);
  const mine = rows.find((r) => r.me);
  if (mine && mine.best > 0 && !shown.includes(mine)) shown = [...shown.slice(0, max - 1), mine];
  return h('div.cb' + cls, shown.map((r) => h('div.cb-chip' + (r.me ? '.me' : ''), { title: `${r.name}: Welle ${r.best}` }, trainerHead(r.sprite), h('b', String(r.best)))));
}
