// Wiederbelebungsmaschine: Fossil im Glas, Prozent auf dem Bildschirm. Geschlossene Kreise um die Maschine laden sie auf, ohne Kreise sinkt der Wert langsam.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { loadSprites, frameOf } from '../gfx/sprites.js';
import { h, toast } from './dom.js';
import { playFile } from '../audio.js';
import { haptic } from '../haptics.js';

const R = () => CFG.dig.revive;
const sound = (k) => { const s = CFG.dig.sounds[k]; playFile(s.file, s.vol); };
const ART = `${import.meta.env.BASE_URL}art/dig/`;

// pics = Fossilbilder fürs Glas, run = Spielstand-Aktion (bezahlt und erzeugt das Pokémon), onDone = zurück zum Inventar
export function startRevive(pics, run, onDone) {
  const cost = R().cost;
  if (app.state.coins < cost) { toast(`Das Wiederbeleben kostet ${cost.toLocaleString('de-DE')} Münzen, du hast ${app.state.coins.toLocaleString('de-DE')}.`, true); return; }
  const screen = h('div.rv-screen', '0 %'), glass = h('div.rv-glass', pics);
  const trail = h('canvas.rv-trail'), hint = h('div.rv-hint', 'Kreise schnell mit dem Finger um die Maschine!');
  const stage = h('div.rv-stage', { style: { backgroundImage: `url(${ART}maschine.webp)` } }, glass, screen, trail, hint);
  const root = h('div.rv', stage, h('button.fp-close', { onclick: leave, title: 'Abbrechen' }, '✕'));
  document.body.append(root); document.body.classList.add('in-battle');
  let pct = 0, angle = 0, last = null, dir = 0, pointer = null, lastMove = -1e9, raf = 0, done = false, prev = performance.now(), points = [];

  const center = () => { const r = stage.getBoundingClientRect(); return { x: r.left + r.width * R().centerX, y: r.top + r.height * R().centerY, min: r.width * R().minRadius }; };
  stage.addEventListener('pointerdown', (e) => { if (done) return; pointer = e.pointerId; last = null; angle = 0; dir = 0; try { stage.setPointerCapture(pointer); } catch { /* ok */ } });
  const lift = (e) => { if (e.pointerId === pointer) { pointer = null; last = null; } };
  stage.addEventListener('pointerup', lift); stage.addEventListener('pointercancel', lift);
  stage.addEventListener('pointermove', (e) => {
    if (done || e.pointerId !== pointer) return;
    const c = center(), dx = e.clientX - c.x, dy = e.clientY - c.y;
    points.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    // zu nah an der Mitte = nicht um die Maschine herum: Kreis beginnt neu
    if (Math.hypot(dx, dy) < c.min) { last = null; angle = 0; dir = 0; return; }
    const a = Math.atan2(dy, dx);
    if (last != null) {
      let d = a - last;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      const s = Math.sign(d);
      if (s && dir && s !== dir && Math.abs(d) > 0.05) { angle = 0; dir = s; } // Richtung gewechselt: Kreis beginnt neu
      else if (s && !dir) dir = s;
      angle += Math.abs(d);
      if (Math.abs(d) > 0.005) lastMove = performance.now();
      if (angle >= 2 * Math.PI) { angle -= 2 * Math.PI; circle(); }
    }
    last = a;
  });
  function circle() {
    pct = Math.min(100, pct + R().perCircle);
    sound('hit'); haptic('tick');
    if (pct >= 100) finish();
  }
  function finish() {
    done = true;
    const r = app.act(run, true);
    if (!r?.ok) { leave(); return; }
    sound('win'); haptic('strong');
    const p = r.pokemon, spr = loadSprites(p.dex, p.gender, p.shiny), cv = h('canvas.rv-mon', { width: 96, height: 96 }), x = cv.getContext('2d');
    screen.textContent = '100 %'; hint.remove(); trail.remove();
    glass.replaceChildren(cv); stage.classList.add('done');
    root.append(h('div.rv-result', h('h2', `${species(p.dex).name}${p.shiny ? ' ✨' : ''}!`), h('button.btn.primary', { onclick: leave }, 'Toll!')));
    const animate = (ms) => {
      if (!root.isConnected) return;
      if (spr.ready) { const f = frameOf(spr, 'Idle', 0, ms), k = Math.min(96 / f.fw, 96 / f.fh, 3); x.imageSmoothingEnabled = false; x.clearRect(0, 0, 96, 96); x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, 48 - (f.fw * k) / 2, 48 - (f.fh * k) / 2, f.fw * k, f.fh * k); }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
  const loop = (ms) => {
    if (done || !root.isConnected) return;
    const dt = Math.min(0.05, (ms - prev) / 1000); prev = ms;
    if (ms - lastMove > R().decayDelay * 1000 && pct > 0) pct = Math.max(0, pct - R().decayPerSecond * dt);
    screen.textContent = `${Math.round(pct)} %`;
    // Fingerspur
    const r = stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (trail.width !== Math.round(r.width * dpr)) { trail.width = Math.round(r.width * dpr); trail.height = Math.round(r.height * dpr); }
    const c = trail.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, -r.left * dpr, -r.top * dpr); c.clearRect(r.left, r.top, r.width, r.height);
    points = points.filter((q) => ms - q.t < 450);
    c.strokeStyle = 'rgba(70, 200, 110, .75)'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); points.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.stroke();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  function leave() { cancelAnimationFrame(raf); root.remove(); document.body.classList.remove('in-battle'); onDone(); }
  if (import.meta.env.DEV) app.revive = { get pct() { return pct; }, set pct(v) { pct = v; }, stage };
}
