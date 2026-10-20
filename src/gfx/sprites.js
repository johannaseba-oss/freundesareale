// Lädt PMD-Spritesheets (public/sprites/<dex>/) und liefert Animationsframes.
// Zeilen der Sheets = 8 Blickrichtungen: 0 unten, 1 unten-rechts, 2 rechts, 3 oben-rechts, 4 oben, 5 oben-links, 6 links, 7 unten-links
import { species } from '../config.js';

const cache = new Map();
const base = import.meta.env.BASE_URL;
export const pad = (dex) => String(dex).padStart(4, '0');
export const portraitUrl = (dex, emotion = 'Normal') => {
  const sp = species(dex);
  const e = sp?.portraits.includes(emotion) ? emotion : 'Normal';
  return `${base}sprites/${pad(dex)}/p_${e}.png`;
};

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// gender "w" nutzt die weibliche Sprite-Variante, falls es eine gibt
export function loadSprites(dex, gender = null) {
  const sp = species(dex);
  const female = gender === 'w' && sp.femaleAnims;
  const key = dex + (female ? 'w' : '');
  if (cache.has(key)) return cache.get(key);
  const entry = { ready: false, anims: {} };
  entry.promise = Promise.all(Object.entries(female ? sp.femaleAnims : sp.anims).map(async ([name, a]) => {
    const img = await loadImg(`${base}sprites/${pad(dex)}/${female ? 'w/' : ''}${a.file}`);
    const total = a.dur.reduce((x, y) => x + y, 0);
    entry.anims[name] = { ...a, img, total };
  })).then(() => { entry.ready = true; return entry; });
  cache.set(key, entry);
  return entry;
}

// Frame zu Zeitpunkt tMs (Dauern in 1/60 s). once=true -> bleibt auf letztem Frame stehen
export function frameOf(entry, name, dir, tMs, once = false) {
  const a = entry.anims[name] || entry.anims.Idle;
  let tick = Math.floor(tMs / (1000 / 60));
  tick = once ? Math.min(tick, a.total - 1) : tick % a.total;
  let i = 0;
  while (tick >= a.dur[i]) { tick -= a.dur[i]; i++; }
  const row = a.rows === 1 ? 0 : dir;
  return { img: a.img, sx: i * a.fw, sy: row * a.fh, fw: a.fw, fh: a.fh, duration: a.total * (1000 / 60) };
}

export function dirFromVector(dx, dy) {
  const ang = Math.atan2(dy, dx); // 0 = rechts, +90° = unten
  const oct = Math.round(ang / (Math.PI / 4));
  return { 0: 2, 1: 1, 2: 0, 3: 7, 4: 6, '-4': 6, '-3': 5, '-2': 4, '-1': 3 }[oct];
}
