// Putz-Minispiel für haarige Pokémon: Schmutz mit dem Finger aus dem Fell wischen.
// Staub geht mit einem Wisch weg, Schlamm und Kletten brauchen mehrere. Am Ende glänzt das Fell.
import { CFG, species, furOf } from '../config.js';
import { app } from '../app.js';
import * as A from '../game/actions.js';
import { portraitUrl } from '../gfx/sprites.js';
import { haptic } from '../haptics.js';
import { h, toast } from './dom.js';

const BASE = import.meta.env.BASE_URL;
const PALETTE = {
  staub: ['#b9ab97', '#a2937d', '#cfc3b1', '#8f806b'],
  schlamm: ['#5b3a22', '#6e4728', '#47301b', '#83593a'],
  klette: ['#6b6a2c', '#8a8636', '#4f4e1f', '#a3a04a'],
};
const rand = (a, b) => a + Math.random() * (b - a);

// Pixel-Schmutzfleck als kleines Canvas (wird groß und kantig skaliert)
function dirtSprite(type) {
  const n = type === 'klette' ? 11 : type === 'schlamm' ? 14 : 12;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const pal = PALETTE[type];
  const lobes = Array.from({ length: 5 }, () => ({ a: rand(0, Math.PI * 2), r: rand(0.15, 0.35) }));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n - 0.5, dy = (y + 0.5) / n - 0.5, d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    let edge = type === 'klette' ? 0.3 + (Math.cos(ang * 7) > 0.3 ? 0.17 : 0) : 0.3;
    for (const l of lobes) edge += Math.max(0, Math.cos(ang - l.a)) ** 6 * l.r * (type === 'staub' ? 0.6 : 0.4);
    if (d > edge) continue;
    if (type === 'staub' && Math.random() < 0.35) continue; // Staub ist fleckig
    const shade = dy < -0.12 && dx < 0 ? 3 : d > edge - 0.07 ? 2 : Math.random() < 0.2 ? 1 : 0;
    ctx.fillStyle = pal[shade];
    ctx.fillRect(x, y, 1, 1);
  }
  return c;
}

export function openGrooming(p, onDone) {
  const G = CFG.grooming, sp = species(p.dex);
  const fur = new Image();
  fur.src = `${BASE}art/fell/${G.furs[furOf(p.dex)]}`;
  const cv = h('canvas.groom-cv');
  const bar = h('i', { style: { width: '0%' } });
  const portrait = h('img.portrait', { src: portraitUrl(p.dex, 'Worried'), alt: '' });
  const done = h('div.groom-done.hidden');
  const el = h('div.groom',
    cv,
    h('div.groom-top', portrait, h('div.groom-title', h('b', `${sp.name} putzen`), h('div.bar.clean', bar)), h('button.btn.small', { onclick: () => finish(false) }, '✕')),
    h('div.groom-hint', 'Wisch den Schmutz aus dem Fell!'),
    done);
  document.body.append(el);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 3);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  };
  resize();

  // Schmutz verteilen: je schmutziger, desto mehr
  const dirtiness = 100 - (p.cleanliness ?? 50);
  const count = Math.max(G.dirtCount.min, Math.min(G.dirtCount.max, Math.round(dirtiness / 6)));
  const dirts = [];
  for (let i = 0; i < count; i++) {
    const type = weighted(G.dirt);
    const size = type.id === 'schlamm' ? rand(52, 70) : type.id === 'klette' ? rand(38, 48) : rand(44, 60);
    dirts.push({ type: type.id, hp: type.hp, max: type.hp, size, x: rand(40, W - 40), y: rand(130, H - 90), rot: rand(-0.3, 0.3), sprite: dirtSprite(type.id), wipe: 0, pop: 0 });
  }
  const totalHp = dirts.reduce((s, d) => s + d.max, 0);
  const particles = [];
  const trail = [];
  let shine = -1, closed = false, raf;

  function weighted(list) {
    const tot = list.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * tot;
    for (const x of list) { r -= x.weight; if (r < 0) return x; }
    return list[0];
  }
  const progress = () => 1 - dirts.reduce((s, d) => s + d.hp, 0) / totalHp;

  // Wischen
  let last = null;
  cv.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch { /* ok */ } });
  cv.addEventListener('pointermove', (e) => {
    if (!last || shine >= 0) return;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top, dist = Math.hypot(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
    if (Math.random() < 0.6) trail.push({ x, y, life: 0.6, s: rand(4, 9) });
    for (const d of dirts) {
      if (d.hp <= 0 || Math.hypot(d.x - x, d.y - y) > d.size * 0.6) continue;
      d.wipe += dist;
      d.shake = 0.15;
      if (Math.random() < 0.5) particles.push(crumb(d, x, y));
      if (d.wipe >= G.wipePerHit) {
        d.wipe = 0; d.hp--;
        for (let i = 0; i < 6; i++) particles.push(crumb(d, d.x, d.y));
        if (d.hp <= 0) { d.pop = 1; haptic('medium'); for (let i = 0; i < 10; i++) particles.push(bubble(d.x, d.y)); }
        else haptic('tick');
        bar.style.width = progress() * 100 + '%';
        if (progress() >= 1) celebrate();
      }
    }
  });
  const up = () => { last = null; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  function crumb(d, x, y) { const pal = PALETTE[d.type]; return { x, y, vx: rand(-90, 90), vy: rand(-140, -30), g: 420, life: rand(0.4, 0.8), s: rand(3, 6), c: pal[Math.floor(Math.random() * pal.length)] }; }
  function bubble(x, y) { return { x, y, vx: rand(-60, 60), vy: rand(-90, -20), g: -20, life: rand(0.6, 1.1), s: rand(5, 11), c: 'bubble' }; }

  function celebrate() {
    shine = 0;
    haptic('strong');
    portrait.src = portraitUrl(p.dex, 'Joyous');
    done.classList.remove('hidden');
    el.querySelector('.groom-hint')?.remove();
    done.replaceChildren(h('img.portrait.big', { src: portraitUrl(p.dex, 'Joyous'), alt: '' }), h('h2', 'Blitzsauber!'), h('p', `${sp.name} fühlt sich pudelwohl.`), h('button.btn.primary', { onclick: () => finish(true) }, 'Fertig'));
  }

  function finish(success) {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    const frac = success ? 1 : progress();
    if (frac > 0) {
      const r = app.act((s, t) => A.groomed(s, p, t, frac), true);
      if (r.ok && !r.partial) toast(`${sp.name} ist jetzt blitzsauber!`);
      else if (r.ok) toast(`${sp.name} ist etwas sauberer.`);
    }
    el.remove();
    onDone?.();
  }

  let prev = performance.now();
  const frame = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    if (cv.clientWidth !== W || cv.clientHeight !== H) resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // Fell (füllt den Bildschirm)
    if (fur.complete && fur.naturalWidth) {
      const k = Math.max(W / fur.naturalWidth, H / fur.naturalHeight);
      ctx.drawImage(fur, (W - fur.naturalWidth * k) / 2, (H - fur.naturalHeight * k) / 2, fur.naturalWidth * k, fur.naturalHeight * k);
    } else { ctx.fillStyle = '#c9b9a0'; ctx.fillRect(0, 0, W, H); }
    // Schmutz
    for (const d of dirts) {
      if (d.hp <= 0 && d.pop <= 0) continue;
      let alpha = 1, scale = 1;
      if (d.hp <= 0) { d.pop -= dt * 4; alpha = Math.max(0, d.pop); scale = 1 + (1 - d.pop) * 0.4; }
      else { const f = d.hp / d.max; alpha = 0.45 + 0.55 * f; scale = 0.7 + 0.3 * f; }
      const jx = d.shake > 0 ? rand(-2, 2) : 0;
      d.shake = Math.max(0, (d.shake || 0) - dt);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(d.x + jx, d.y); ctx.rotate(d.rot); ctx.scale(scale, scale);
      ctx.drawImage(d.sprite, -d.size / 2, -d.size / 2, d.size, d.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Wisch-Spur (Schaum)
    for (const t of trail) {
      t.life -= dt;
      ctx.globalAlpha = Math.max(0, t.life / 0.6) * 0.8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(t.x - t.s / 2), Math.round(t.y - t.s / 2), t.s, t.s);
    }
    for (let i = trail.length - 1; i >= 0; i--) if (trail[i].life <= 0) trail.splice(i, 1);
    // Krümel & Bläschen
    for (const q of particles) {
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2));
      if (q.c === 'bubble') { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.strokeRect(Math.round(q.x), Math.round(q.y), q.s, q.s); }
      else { ctx.fillStyle = q.c; ctx.fillRect(Math.round(q.x), Math.round(q.y), q.s, q.s); }
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    ctx.globalAlpha = 1;
    // Glanzeffekt am Ende: Lichtstreifen + Funkeln
    if (shine >= 0) {
      shine += dt;
      const x = (shine / 1.1) * (W + H) - H;
      const grad = ctx.createLinearGradient(x, 0, x + H * 0.5, H * 0.5);
      grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 18; i++) {
        const sx = (Math.sin(i * 12.9898) * 0.5 + 0.5) * W, sy = (Math.sin(i * 78.233) * 0.5 + 0.5) * H;
        const tw = Math.max(0, Math.sin(shine * 6 + i));
        const s = 3 + tw * 6;
        ctx.globalAlpha = tw;
        ctx.fillStyle = '#fffbe0';
        ctx.fillRect(sx - s / 2, sy - 1, s, 2); ctx.fillRect(sx - 1, sy - s / 2, 2, s);
      }
      ctx.globalAlpha = 1;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  if (import.meta.env.DEV) app.groom = { dirts, progress, finish, celebrate };
}
