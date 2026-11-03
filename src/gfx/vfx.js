// Attackeneffekte aus Spritesheets (public/config/vfx.json, Bilder in public/art/vfx). Jeder Kampfmodus hält eine eigene Liste
// laufender Effekte und zeichnet sie mit einer Funktion, die Spielkoordinaten in Pixel umrechnet.
import { CFG } from '../config.js';

const V = () => CFG.vfx;
const imgs = new Map();
const base = import.meta.env.BASE_URL;
function sheet(name) {
  if (!imgs.has(name)) { const i = new Image(); i.src = `${base}art/vfx/${name}.png`; imgs.set(name, i); }
  return imgs.get(name);
}
const ready = (i) => i.complete && i.naturalWidth;
// Bilder vorab laden, damit der erste Treffer nicht ins Leere geht
export function preloadVfx() { for (const n of Object.keys(V().sheets)) sheet(n); }

// Effekt starten: key = Name in effects (crit, ko …) oder direkt ein Spritesheet; o = Spielkoordinaten
export function spawnVfx(list, name, o, size = 1, dy = 0) {
  if (!name || !V().sheets[name] || list.length >= V().maxActive) return;
  list.push({ name, o: { x: o.x, y: o.y }, size, dy, t: 0 });
}
const typeOf = (type) => V().types[type] || V().types.Normal;
// Treffer nach Attackentyp, Volltreffer zusätzlich mit eigenem Effekt
export function hitVfx(list, type, o, crit = false) {
  spawnVfx(list, typeOf(type).hit, o, V().sizes.hit * (crit ? 1.3 : 1), V().hitLift);
  if (crit) spawnVfx(list, V().effects.crit, o, V().sizes.crit, V().hitLift);
}
export const effectVfx = (list, key, o, size) => spawnVfx(list, V().effects[key], o, size ?? V().sizes[key] ?? 1, V().hitLift);

function drawFrame(x, name, f, X, Y, px) {
  const i = sheet(name);
  if (!ready(i)) return false;
  const k = px / Math.max(f[2], f[3]), w = f[2] * k, h = f[3] * k;
  x.drawImage(i, f[0], f[1], f[2], f[3], -w / 2 + X, -h / 2 + Y, w, h);
  return true;
}
// alle laufenden Effekte weiterzählen und zeichnen; toPx(o) -> [X, Y], T = Pixel je Feld
export function drawVfx(x, list, dt, toPx, T) {
  const smooth = x.imageSmoothingEnabled;
  x.imageSmoothingEnabled = false;
  for (let n = list.length - 1; n >= 0; n--) {
    const e = list[n], F = V().sheets[e.name];
    e.t += dt * 1000;
    let ms = e.t, f = null;
    for (const q of F) { if (ms < q[4]) { f = q; break; } ms -= q[4]; }
    if (!f) { list.splice(n, 1); continue; }
    const [X, Y] = toPx(e.o);
    drawFrame(x, e.name, f, X, Y + e.dy * T, T * e.size);
  }
  x.imageSmoothingEnabled = smooth;
}
// fliegendes Geschoss nach Typ; false = kein Sprite (dann zeichnet der Modus sein altes Geschoss)
export function drawMissile(x, type, X, Y, angle, T, now) {
  const name = typeOf(type).missile, F = name && V().sheets[name];
  if (!F) return false;
  const total = F.reduce((n, q) => n + q[4], 0);
  let ms = now % total, f = F[0];
  for (const q of F) { if (ms < q[4]) { f = q; break; } ms -= q[4]; }
  if (!ready(sheet(name))) return false;
  const smooth = x.imageSmoothingEnabled;
  x.save(); x.imageSmoothingEnabled = false; x.translate(X, Y); x.rotate(angle);
  drawFrame(x, name, f, 0, 0, T * V().sizes.missile);
  x.restore(); x.imageSmoothingEnabled = smooth;
  return true;
}
