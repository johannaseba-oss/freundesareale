// Zeichnet ein Freundesareal bildschirmfüllend mit umherlaufenden Pokémon.
// Koordinaten = Pixel des Hintergrundbilds. Wischen links/rechts wechselt das Areal, Antippen wählt ein Pokémon.
import { CFG } from '../config.js';
import { loadSprites, frameOf, dirFromVector } from '../gfx/sprites.js';
import { iconCanvas, berryCanvas } from '../gfx/icons.js';
import { SocialDirector } from './social.js';

const imgCache = new Map();
function bgImage(file) {
  if (!imgCache.has(file)) {
    const i = new Image();
    i.src = `${import.meta.env.BASE_URL}art/areale/${file}`;
    imgCache.set(file, i);
  }
  return imgCache.get(file);
}
// Bild laden und dekodieren (verhindert ein leeres Bild beim Arealwechsel)
export function preloadArea(area) {
  const img = bgImage(area.image);
  return (img.decode ? img.decode() : Promise.resolve()).catch(() => {});
}

const ICON = { coin: iconCanvas('coin', 1), food: iconCanvas('food', 1), heart: iconCanvas('heart', 1) };
const rand = (a, b) => a + Math.random() * (b - a);
// Bereiche oben/unten, die von der schwebenden Oberfläche belegt sind (CSS-Pixel) – dort laufen keine Pokémon
const SAFE = { top: 110, bottom: 110, side: 24 };

export class AreaScene {
  constructor(canvas, wrap, handlers) {
    this.canvas = canvas; this.wrap = wrap; this.ctx = canvas.getContext('2d');
    this.h = handlers;
    this.actors = new Map();
    this.particles = [];
    this.area = null;
    this.time = 0;
    this.ground = [];
    this.social = new SocialDirector(this, (a, b, positive, kind) => this.h.onSocial?.(a, b, positive, kind));
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(wrap);
  }

  setArea(area, residents, ground = []) {
    const changed = this.area?.id !== area.id;
    this.area = area;
    this.ground = ground;
    this.bg = bgImage(area.image);
    if (changed) { this.actors.clear(); this.particles = []; this.social.reset(); }
    const ready = () => { if (changed || !this.k) this.resize(); this.sync(residents); };
    if (this.bg.complete && this.bg.naturalWidth) ready(); else this.bg.onload = ready;
  }

  resize() {
    if (!this.bg?.naturalWidth) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = Math.round(this.wrap.clientWidth * dpr), H = Math.round(this.wrap.clientHeight * dpr);
    if (!W || !H) return;
    if (this.canvas.width !== W) this.canvas.width = W; // Neusetzen leert die Leinwand -> nur bei Änderung
    if (this.canvas.height !== H) this.canvas.height = H;
    this.dpr = dpr;
    const iw = this.bg.naturalWidth, ih = this.bg.naturalHeight;
    this.k = H / ih; // Bild immer in voller Höhe; seitlich ggf. beschnitten oder mit Rand
    this.vw = W / this.k; this.vh = H / this.k;
    const w = this.area.walk;
    const fx = this.area.focusX ?? w.cx, fy = this.area.focusY ?? w.cy;
    this.camX = this.vw >= iw ? (iw - this.vw) / 2 : Math.max(0, Math.min(iw - this.vw, fx * iw - this.vw / 2));
    this.camY = Math.max(0, Math.min(ih - this.vh, fy * ih - this.vh / 2));
    // sichtbarer, nicht von UI verdeckter Bereich in Bildkoordinaten
    const px = (css) => (css * dpr) / this.k;
    this.safe = { x0: Math.max(0, this.camX) + px(SAFE.side), x1: Math.min(iw, this.camX + this.vw) - px(SAFE.side), y0: this.camY + px(SAFE.top), y1: this.camY + this.vh - px(SAFE.bottom) };
    for (const a of this.actors.values()) { const c = this.clampSafe(a); a.x = c.x; a.y = c.y; }
  }

  clampSafe(pt) {
    const s = this.safe;
    return { x: Math.max(s.x0, Math.min(s.x1, pt.x)), y: Math.max(s.y0, Math.min(s.y1, pt.y)) };
  }

  randomPoint() {
    const w = this.area.walk, W = this.bg.naturalWidth, H = this.bg.naturalHeight;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
      const pt = { x: (w.cx + Math.cos(a) * w.rx * r) * W, y: (w.cy + Math.sin(a) * w.ry * r) * H };
      const s = this.safe;
      if (pt.x >= s.x0 && pt.x <= s.x1 && pt.y >= s.y0 && pt.y <= s.y1) return pt;
    }
    return this.clampSafe({ x: w.cx * W + rand(-20, 20), y: w.cy * H + rand(-10, 10) });
  }

  sync(residents) {
    const keep = new Set(residents.map((p) => p.uid));
    for (const uid of this.actors.keys()) if (!keep.has(uid)) this.actors.delete(uid);
    if (!this.safe) return;
    for (const p of residents) {
      const a = this.actors.get(p.uid);
      if (a) { a.p = p; continue; }
      const pt = this.randomPoint();
      this.actors.set(p.uid, { p, ...pt, sprites: loadSprites(p.dex, p.gender), state: 'idle', dir: 0, t: 0, timer: rand(0.5, 3) });
    }
  }

  react(uid, kind) {
    const a = this.actors.get(uid);
    if (!a) return;
    a.state = 'hop'; a.t = 0; a.timer = 0.8;
    for (let i = 0; i < 4; i++) this.particles.push({ icon: kind, x: a.x + rand(-8, 8), y: a.y - 30, vy: rand(-40, -25), life: 1.2 });
  }

  update(dt) {
    if (!this.area || !this.safe) return;
    this.time += dt;
    const n = CFG.balance.needs;
    const speed = 16 * this.area.spriteScale;
    for (const a of this.actors.values()) {
      a.t += dt * 1000;
      if (a.dragging || a.busy) continue;
      a.timer -= dt;
      if (a.state === 'walk') {
        const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
        if (d < 1.5) { a.state = 'idle'; a.t = 0; a.timer = rand(2, 6); }
        else { a.dir = dirFromVector(dx, dy); a.x += (dx / d) * speed * dt; a.y += (dy / d) * speed * dt; }
      } else if (a.timer <= 0) {
        const sleepy = a.p.fullness < n.hungryBelow || a.p.satisfaction < 25 ? 0.35 : 0.12;
        if (a.state !== 'sleep' && Math.random() < sleepy) { a.state = 'sleep'; a.t = 0; a.timer = rand(8, 20); }
        else { const pt = this.randomPoint(); a.tx = pt.x; a.ty = pt.y; a.state = 'walk'; a.t = 0; }
      }
    }
    this.social.update(dt);
    for (const q of this.particles) { q.y += q.vy * dt; q.life -= dt; }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  draw() {
    const { ctx, k } = this;
    if (!this.bg?.naturalWidth || !k) return;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1f2a1d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, -this.camX * k, -this.camY * k);
    ctx.drawImage(this.bg, 0, 0);
    const s = this.area.spriteScale;
    // Beeren am Boden
    for (const g of this.ground) {
      const pt = this.groundPos(g), c = berryCanvas(g.berry), bw = 10 * s;
      const bob = Math.sin(this.time * 2.5 + g.id) * s;
      ctx.fillStyle = 'rgba(30,40,20,.25)';
      ctx.beginPath(); ctx.ellipse(pt.x, pt.y + 2 * s, 5 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(c, Math.round(pt.x - bw / 2), Math.round(pt.y - bw + bob), bw, bw);
      if (Math.sin(this.time * 3 + g.id * 7) > 0.92) { ctx.fillStyle = '#fff8c8'; ctx.fillRect(pt.x + 3 * s, pt.y - bw - 2 * s, 2 * s, 2 * s); }
      g.box = { x: pt.x - 9 * s, y: pt.y - 14 * s, w: 18 * s, h: 18 * s };
    }
    const list = [...this.actors.values()].sort((a, b) => (a.dragging - b.dragging) || a.y - b.y);
    for (const a of list) {
      if (!a.sprites.ready) continue;
      if (a.dragging) ctx.globalAlpha = 0.85;
      const anim = { walk: 'Walk', sleep: 'Sleep', hop: 'Hop', idle: 'Idle' }[a.state];
      const f = frameOf(a.sprites, anim, a.dir, a.t);
      ctx.fillStyle = 'rgba(30,40,20,.28)';
      ctx.beginPath(); ctx.ellipse(a.x, a.y, 9 * s, 3.5 * s, 0, 0, Math.PI * 2); ctx.fill();
      const w = f.fw * s, hgt = f.fh * s;
      // großzügige Trefferfläche für Finger
      a.box = { x: a.x - Math.max(w / 2, 14 * s), y: a.y - hgt * 0.62, w: Math.max(w, 28 * s), h: hgt * 0.62 + 6 * s };
      ctx.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(a.x - w / 2), Math.round(a.y - hgt / 2 - 4 * s - (a.dragging ? 6 * s : 0)), w, hgt);
      ctx.globalAlpha = 1;
    }
    for (const a of list) {
      if (!a.box) continue;
      const bob = Math.sin(this.time * 4 + a.p.uid) * 1.5 * s;
      const top = a.box.y - 2 * s + bob;
      if (a.p.coinsReady > 0) {
        const c = ICON.coin, cw = c.width * s;
        a.coinBox = { x: a.x - cw / 2 - 6 * s, y: top - cw - 6 * s, w: cw + 12 * s, h: cw + 12 * s };
        ctx.drawImage(c, Math.round(a.x - cw / 2), Math.round(top - cw), cw, cw);
        if (a.p.coinsReady > 1) {
          ctx.font = `bold ${Math.round(7 * s)}px "Pixelify Sans", sans-serif`;
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4a3b33'; ctx.lineWidth = s;
          ctx.strokeText('×' + a.p.coinsReady, a.x + cw / 2 + 1, top - 2); ctx.fillText('×' + a.p.coinsReady, a.x + cw / 2 + 1, top - 2);
        }
      } else a.coinBox = null;
      const berryIds = Object.keys(a.p.berriesReady || {}).filter((id) => a.p.berriesReady[id] > 0);
      if (berryIds.length) {
        const c = berryCanvas(berryIds[0]), bw = 10 * s;
        ctx.drawImage(c, Math.round(a.x - bw / 2 + (a.p.coinsReady > 0 ? -12 * s : 0)), Math.round(top - bw), bw, bw);
      }
      if (a.p.fullness < CFG.balance.needs.hungryBelow) {
        const c = ICON.food, cw = c.width * s;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 3);
        ctx.drawImage(c, Math.round(a.x + (a.p.coinsReady > 0 ? 9 * s : -cw / 2)), Math.round(top - c.height * s), cw, c.height * s);
        ctx.globalAlpha = 1;
      }
    }
    this.social.draw(ctx, s);
    for (const q of this.particles) {
      const c = ICON[q.icon] || ICON.heart;
      ctx.globalAlpha = Math.min(1, q.life * 1.5);
      ctx.drawImage(c, Math.round(q.x - (c.width * s) / 2), Math.round(q.y), c.width * s, c.height * s);
    }
    ctx.globalAlpha = 1;
  }

  groundPos(g) {
    const w = this.area.walk, W = this.bg.naturalWidth, H = this.bg.naturalHeight;
    return this.clampSafe({ x: (w.cx + g.u * w.rx) * W, y: (w.cy + g.v * w.ry) * H });
  }

  // Bildkoordinaten -> Bildschirmkoordinaten (für fliegende Münzen)
  toScreen(x, y) {
    const r = this.canvas.getBoundingClientRect(), f = r.width / this.canvas.width;
    return { x: r.left + (x - this.camX) * this.k * f, y: r.top + (y - this.camY) * this.k * f };
  }
  screenPosOf(uid) {
    const a = this.actors.get(uid);
    return a?.box ? this.toScreen(a.x, a.box.y) : null;
  }

  toImage(cx, cy) {
    const r = this.canvas.getBoundingClientRect(), f = this.canvas.width / r.width;
    return { x: ((cx - r.left) * f) / this.k + this.camX, y: ((cy - r.top) * f) / this.k + this.camY };
  }
  hitAt(cx, cy) {
    const pt = this.toImage(cx, cy);
    const inBox = (b) => b && pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h;
    const list = [...this.actors.values()].sort((a, b) => b.y - a.y);
    return list.find((a) => inBox(a.coinBox)) || list.find((a) => inBox(a.box)) || null;
  }

  // Gesten: Pokémon ziehen (Drag & Drop) · auf freier Fläche wischen (Arealwechsel) · antippen
  bindInput() {
    let down = null;
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), mode: null, actor: this.berryAt(e.clientX, e.clientY) ? null : this.hitAt(e.clientX, e.clientY) };
      try { el.setPointerCapture(e.pointerId); } catch { /* ok */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.mode && Math.hypot(dx, dy) > 10) {
        if (down.actor) { if (down.actor.busy) this.social.finish(down.actor.busy, false); down.mode = 'drag'; down.actor.dragging = true; down.actor.state = 'idle'; this.h.onDragStart?.(down.actor.p); }
        else down.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'none';
      }
      if (down.mode === 'swipe') this.h.onDrag?.(dx);
      if (down.mode === 'drag') {
        const pt = this.toImage(e.clientX, e.clientY + 30); // Füße etwas unter dem Finger
        down.actor.x = pt.x; down.actor.y = pt.y;
        this.h.onDragMove?.(down.actor.p, e.clientX, e.clientY);
      }
    });
    const end = (e) => {
      const d = down; down = null;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (d.mode === 'drag') {
        const a = d.actor;
        a.dragging = false;
        const handled = e.type !== 'pointercancel' && this.h.onDragEnd?.(a.p, e.clientX, e.clientY);
        if (!handled) { const c = this.clampSafe(a); a.x = c.x; a.y = c.y; a.state = 'hop'; a.t = 0; a.timer = 0.6; }
        return;
      }
      if (d.mode === 'swipe') {
        const fast = Math.abs(dx) / Math.max(1, performance.now() - d.t) > 0.5;
        const dir = Math.abs(dx) > this.wrap.clientWidth * 0.22 || (fast && Math.abs(dx) > 40) ? (dx < 0 ? 1 : -1) : 0;
        this.h.onSwipeEnd?.(dir);
        return;
      }
      if (d.mode || e.type === 'pointercancel') return;
      this.tap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  berryAt(cx, cy) {
    const pt = this.toImage(cx, cy);
    return this.ground.find((g) => g.box && pt.x >= g.box.x && pt.x <= g.box.x + g.box.w && pt.y >= g.box.y && pt.y <= g.box.y + g.box.h) || null;
  }

  tap(cx, cy) {
    const berry = this.berryAt(cx, cy);
    if (berry) { const p = this.groundPos(berry); return this.h.onBerry?.(berry, this.toScreen(p.x, p.y - 8)); }
    const hit = this.hitAt(cx, cy);
    if (hit) this.h.onTap(hit.p, this.toScreen(hit.x, hit.box.y));
  }
}
