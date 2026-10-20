// Pokébälle als Pixel-Art (Grundraster 12x12), prozedural pro Pixel gefärbt.
const STYLE = {
  pokeball: { top: '#e5383b', hi: '#ff8f8f', sh: '#a4161a' },
  superball: { top: '#3d7be0', hi: '#8cb8ff', sh: '#22489a', mark: '#e5383b' },
  hyperball: { top: '#2b2b33', hi: '#5a5a66', sh: '#141418', mark: '#f5c518' },
  meisterball: { top: '#8e44c9', hi: '#c48af0', sh: '#5b2486', mark: '#ff7fc8', letter: '#ffffff' },
};
const N = 12;
const OUT = '#1d1a22', WHITE = '#f4f2f8', WSH = '#c9c6d4', BAND = '#1d1a22';

function colorAt(id, x, y, open) {
  const s = STYLE[id];
  const cx = x + 0.5 - N / 2, cy = y + 0.5 - N / 2;
  const d = Math.hypot(cx, cy);
  if (d > 6) return null;
  if (d > 5.1) return OUT;
  // Knopf
  const bd = Math.hypot(cx, cy - 0.3);
  if (bd < 1.3) return '#ffffff';
  if (bd < 2.1) return OUT;
  if (Math.abs(cy - 0.3) < 0.6) return BAND;
  if (cy < 0) {
    if (open) return null;
    // Markierungen
    if (id === 'superball' && Math.abs(Math.abs(cx) - 3) < 0.9 && cy > -3.5 && cy < -1) return s.mark;
    if (id === 'hyperball' && Math.abs(Math.abs(cx) - 2.2) < 0.8 && cy < -0.8) return s.mark;
    if (id === 'meisterball') {
      if (Math.abs(Math.abs(cx) - 3.3) < 0.9 && Math.abs(cy + 2.5) < 1) return s.mark;
      const mx = Math.round(cx - 0.5), my = Math.round(cy - 0.5);
      const M = { '-1,-4': 1, '0,-4': 1, '-1,-3': 1, '0,-3': 1, '-2,-4': 1, '1,-4': 1, '-2,-3': 1, '1,-3': 1 };
      if (M[`${mx},${my}`] && !(my === -3 && (mx === -1 || mx === 0))) return s.letter;
      if (my === -3 && (mx === -1 || mx === 0)) return s.top;
    }
    if (cx < -2 && cy < -2 && cx > -4 && cy > -4.5) return s.hi;
    if (cx + cy > 4.5 || d > 4.3 && cx > 1.5) return s.sh;
    return s.top;
  }
  if (cx + cy > 5 || d > 4.3 && cx > 2) return WSH;
  return WHITE;
}

const cache = new Map();
// Liefert ein Canvas mit dem Ball in Pixelgröße 'px'
export function ballCanvas(id, px = 1, open = false) {
  const k = `${id}|${px}|${open}`;
  if (cache.has(k)) return cache.get(k);
  const c = document.createElement('canvas');
  c.width = c.height = N * px;
  const ctx = c.getContext('2d');
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const col = colorAt(id, x, y, open);
    if (!col) continue;
    ctx.fillStyle = col;
    ctx.fillRect(x * px, y * px, px, px);
  }
  cache.set(k, c);
  return c;
}
export const BALL_PIXELS = N;
