// Pokébälle als Pixel-Art aus dem Bogen public/art/balls.png (28 Bälle à 20×20 px, zeilenweise; Bau: tools/build_balls.mjs).
// Super-, Hyper- und Meisterball haben ihr eigenes Bild; normale Pokébälle zeigen je Ball eines der übrigen Motive.
const base = import.meta.env.BASE_URL;
const N = 20, COLS = 7;
const TIER = { pokeball: 0, superball: 1, hyperball: 2, meisterball: 3 };
const COMMON = [0, ...Array.from({ length: 24 }, (_, i) => i + 4)];

let sheet = null;
export function loadBallSprites() {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { sheet = img; cache.clear(); res(); };
    img.onerror = () => res();
    img.src = base + 'art/balls.png';
  });
}

// Bild-ID eines Balls: normale Pokébälle bekommen über ihren Schlüssel ein festes Motiv ("pokeball#7")
export const ballSprite = (tier, key) => (tier === 'pokeball' && key != null ? `pokeball#${COMMON[Math.abs(key) % COMMON.length]}` : tier);
const indexOf = (id) => { const [tier, n] = String(id).split('#'); return n != null ? +n : TIER[tier] ?? 0; };

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
