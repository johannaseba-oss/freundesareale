// Pokébälle als Pixel-Art aus dem Bogen public/art/balls.png (28 Bälle à 20×20 px, zeilenweise; Bau: tools/build_balls.mjs).
// Jedes Pokémon steckt in einem zu ihm passenden Ball (public/config/balls.json), sonst im Ball seiner Seltenheitsstufe.
import { CFG, species } from '../config.js';

const base = import.meta.env.BASE_URL;
const N = 20, COLS = 7;

let sheet = null;
export function loadBallSprites() {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { sheet = img; cache.clear(); res(); };
    img.onerror = () => res();
    img.src = base + 'art/balls.png';
  });
}

// passender Ball für eine Art (erste zutreffende Regel)
const ruleCache = new Map();
function ballForDex(dex) {
  if (ruleCache.has(dex)) return ruleCache.get(dex);
  const sp = species(dex), speed = CFG.battleData?.pokemon[dex]?.base[5] || 0;
  const r = sp && (CFG.balls?.rules || []).find((x) =>
    (x.legendary && sp.rarity === 'legendaer') || x.dex?.includes(dex) || x.types?.some((t) => sp.types.includes(t)) || (x.minSpeed && speed >= x.minSpeed));
  ruleCache.set(dex, r?.ball || null);
  return r?.ball || null;
}
// Bild-ID eines Balls: passend zum Inhalt (dex), sonst der Ball der Seltenheitsstufe
export const ballSprite = (tier, key, dex) => (dex != null && ballForDex(dex)) || tier;
export const ballName = (id) => CFG.balls?.sprites[id]?.name || id;
const indexOf = (id) => CFG.balls?.sprites[id]?.i ?? 0;

const cache = new Map();
// Canvas mit dem Ball in Pixelgröße 'px'; open = nur die untere Hälfte (geöffneter Ball)
export function ballCanvas(id, px = 1, open = false) {
  const k = `${id}|${px}|${open}`;
  if (cache.has(k)) return cache.get(k);
  const c = document.createElement('canvas');
  c.width = c.height = N * px;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (sheet) {
    const i = indexOf(id);
    const sy = Math.floor(i / COLS) * N, top = open ? N / 2 : 0;
    ctx.drawImage(sheet, (i % COLS) * N, sy + top, N, N - top, 0, top * px, N * px, (N - top) * px);
    cache.set(k, c);
  }
  return c;
}
export const BALL_PIXELS = N;
