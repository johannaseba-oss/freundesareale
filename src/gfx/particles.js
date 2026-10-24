// Pixel-Partikel je Attackentyp (Route-Modus): Tropfen/Blasen, Flämmchen, Blitze, Blätter, Sternchen, Flocken, Federn …
// burst() legt Partikel in eine Liste (Koordinaten in Feldern), drawParticles() zeichnet und bewegt sie.
import { typeColor } from '../game/types.js';

export const FX = {
  Feuer: { c: ['#ffe066', '#ffb84a', '#ff6a3a'], g: -2.5, shape: 'flame' }, Wasser: { c: ['#bfe3ff', '#6fb7ff', '#3d7be0'], g: 6, shape: ['drop', 'drop', 'bubble'] },
  Elektro: { c: ['#fff6a0', '#ffe066', '#8fd8ff'], g: 0, shape: 'bolt' }, Pflanze: { c: ['#bde58f', '#7ac74c', '#4f8f30'], g: 1.2, shape: 'leaf' },
  Eis: { c: ['#ffffff', '#bff4ff', '#96d9d6'], g: 2, shape: 'flake' }, Gestein: { c: ['#c9b07a', '#a08050', '#6d5a3a'], g: 9, shape: 'sq' },
  Boden: { c: ['#e2bf65', '#a08050'], g: 8, shape: 'sq' }, Geist: { c: ['#b89ae0', '#735797'], g: -1.5, shape: 'ring' },
  Psycho: { c: ['#ffb3d0', '#f95587'], g: -1, shape: 'ring' }, Gift: { c: ['#d79ae0', '#a33ea1'], g: -1.8, shape: 'bubble' },
  Unlicht: { c: ['#8a7464', '#3b2f28'], g: 2, shape: 'sq' }, Fee: { c: ['#ffd6ec', '#ff9ccf', '#ffffff'], g: -1, shape: 'star' },
  Flug: { c: ['#ffffff', '#dfe8ff', '#a98ff3'], g: 1, shape: 'feather' }, Käfer: { c: ['#c8d84a', '#a6b91a', '#6d7a12'], g: 4, shape: 'sq' },
  Stahl: { c: ['#ffffff', '#d0d4e0', '#b7b7ce'], g: 3, shape: 'spark' }, Drache: { c: ['#a08cff', '#6f35fc', '#4fd0ff'], g: -2, shape: 'flame' },
  Kampf: { c: ['#ffffff', '#ffb070', '#c22e28'], g: 2, shape: 'spark' }, Normal: { c: ['#ffffff', '#e8e2d0', '#c6c0a8'], g: 2, shape: 'sq' },
};

// n Partikel vom Punkt o aus (power = Tempo, size = Größe, spread = Startstreuung in Feldern)
export function burst(list, o, type, n, power = 1, size = 1, spread = 0) {
  const st = FX[type] || { c: [typeColor(type), '#ffffff'], g: 4, shape: 'sq' };
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (0.6 + Math.random() * 1.8) * power;
    const shape = Array.isArray(st.shape) ? st.shape[Math.floor(Math.random() * st.shape.length)] : st.shape;
    list.push({ x: o.x + (Math.random() - 0.5) * spread, y: o.y - 0.1 + (Math.random() - 0.5) * spread, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6 * power, g: st.g, drag: 2, color: st.c[Math.floor(Math.random() * st.c.length)], shape, size: (0.6 + Math.random() * 0.8) * size, life: 0.35 + Math.random() * 0.4, rot: Math.random() * 4 });
  }
}

// alle Partikel bewegen und zeichnen; ox/oy/T = Feldursprung und Feldgröße in Pixeln
export function drawParticles(x, list, dt, ox, oy, T, now) {
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    f.life -= dt;
    if (f.life <= 0) { list.splice(i, 1); continue; }
    f.x += f.vx * dt; f.y += f.vy * dt; f.vy += f.g * dt; f.vx *= 1 - dt * f.drag;
    x.globalAlpha = Math.min(1, f.life / 0.3); x.fillStyle = f.color;
    drawParticle(x, f, ox + f.x * T, oy + f.y * T, Math.max(2, (T / 10) * f.size), T, now);
  }
  x.globalAlpha = 1;
}

function drawParticle(x, f, X, Y, s, T, now) {
  const q = Math.max(1, Math.round(s / 3));
  switch (f.shape) {
    case 'spark': x.strokeStyle = f.color; x.lineWidth = Math.max(1.5, s / 2); x.beginPath(); x.moveTo(X, Y); x.lineTo(X - f.vx * T * 0.05, Y - f.vy * T * 0.05); x.stroke(); break;
    case 'ring': x.strokeStyle = f.color; x.lineWidth = 1.5; x.beginPath(); x.arc(X, Y, s, 0, 7); x.stroke(); break;
    case 'bubble': x.strokeStyle = f.color; x.lineWidth = Math.max(1, q); x.strokeRect(X - s / 2, Y - s / 2, s, s); x.fillStyle = '#ffffff'; x.fillRect(X - s / 2 + q, Y - s / 2 + q, q, q); break;
    case 'drop': x.fillRect(X - q / 2, Y - q * 1.5, q, q); x.fillRect(X - q, Y - q / 2, q * 2, q * 1.5); break;
    case 'flame': { const fl = (Math.floor(now / 70 + f.rot * 10) % 2) * q; x.fillStyle = '#ff6a3a'; x.fillRect(X - q, Y - q / 2, q * 2, q * 1.5); x.fillStyle = f.color; x.fillRect(X - q / 2, Y - q * 1.5 - fl, q, q * 1.5); break; }
    case 'bolt': x.fillRect(X, Y - q * 2, q, q); x.fillRect(X - q, Y - q, q * 2, q); x.fillRect(X - q, Y, q, q); x.fillRect(X - q * 2, Y + q, q, q); break;
    case 'leaf': { const o = Math.round(Math.sin(now / 120 + f.rot) * q); x.fillRect(X - q + o, Y - q / 2, q * 2, q); x.fillRect(X + o, Y - q * 1.5, q, q); x.fillStyle = '#2f6b25'; x.fillRect(X - q + o, Y + q / 2, q, q / 2); break; }
    case 'star': x.fillRect(X - q * 1.5, Y - q / 2, q * 3, q); x.fillRect(X - q / 2, Y - q * 1.5, q, q * 3); break;
    case 'flake': x.fillRect(X - q * 1.5, Y - q / 2, q * 3, q); x.fillRect(X - q / 2, Y - q * 1.5, q, q * 3); x.fillRect(X - q * 1.5, Y - q * 1.5, q, q); x.fillRect(X + q / 2, Y + q / 2, q, q); break;
    case 'feather': x.fillRect(X - q * 1.5, Y, q * 3, q); x.fillRect(X - q / 2, Y - q, q * 2, q); break;
    default: x.fillRect(X - s / 2, Y - s / 2, s, s);
  }
}
