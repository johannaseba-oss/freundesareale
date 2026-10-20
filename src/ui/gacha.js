// Bildschirm "Automat": tägliche Bälle in der Glaskugel, Kurbel-Animation, Enthüllung.
import { CFG, species, ballById, areaById } from '../config.js';
import { app } from '../app.js';
import { now, nextDayStart, fmtDuration } from '../time.js';
import * as A from '../game/actions.js';
import { capacityOf, residents, genderSymbol } from '../game/state.js';
import { habitatFit } from '../game/habitat.js';
import { ballCanvas, BALL_PIXELS } from '../gfx/balls.js';
import { iconCanvas, iconImg } from '../gfx/icons.js';
import { loadSprites, frameOf } from '../gfx/sprites.js';
import { $, h, toast } from './dom.js';

const BASE = import.meta.env.BASE_URL;
const PX = 7; // Pixelgröße der Bälle in der Kugel (Automatenbild ist ~8x vergrößerte Pixel-Art)
const R = (BALL_PIXELS * PX) / 2;
let meta, machine, knob, ctx, canvas;
let balls = []; // {key, id, x, y, vx, vy, gone}
let anim = null;
let poolDay = '';
let lastInfo = '';

const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });

export async function initGacha() {
  meta = await fetch(`${BASE}art/automat.json`).then((r) => r.json());
  [machine, knob] = await Promise.all([load(`${BASE}art/automat.png`), load(`${BASE}art/knob.png`)]);
  canvas = $('#machine');
  canvas.width = meta.width; canvas.height = meta.height;
  ctx = canvas.getContext('2d');
  $('#gacha-draw').onclick = startDraw;
  app.views.add(renderInfo);
  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (!$('#scr-gacha').classList.contains('hidden')) { step(dt); draw(t); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Kugel-Inhalt an den Spielstand anpassen (der gerade gezogene Ball bleibt bis zum Ende der Animation sichtbar)
function syncBalls() {
  const g = app.state.gacha;
  if (!g) return;
  if (g.day !== poolDay) { balls = []; poolDay = g.day; }
  const keys = new Set(g.balls.map((b) => b.seed));
  const drawing = anim?.ball?.seed;
  balls = balls.filter((b) => keys.has(b.key) || b.key === drawing);
  const have = new Set(balls.map((b) => b.key));
  const G = meta.globe;
  for (const b of g.balls) {
    if (have.has(b.seed)) continue;
    balls.push({ key: b.seed, id: b.ball, x: G.cx + (Math.random() - 0.5) * G.r, y: G.top + R + Math.random() * 120, vx: 0, vy: 0 });
  }
}

const SUB = 6, GRAV = 1500, MAXV = 520;
function step(dt) {
  if (!app.state?.gacha) return;
  syncBalls();
  if (anim) anim.t += dt;
  const G = meta.globe;
  const cranking = anim?.phase === 'crank';
  const chosen = anim && anim.phase !== 'coin' ? balls.find((x) => x.key === anim.ball.seed) : null;
  const h = dt / SUB;
  for (let sub = 0; sub < SUB; sub++) {
    for (const b of balls) {
      if (b === chosen && anim.phase !== 'crank') continue;
      b.vy += GRAV * h;
      if (cranking) {
        // sanftes Schwappen: das Rad unten schiebt die unteren Bälle hin und her
        const low = Math.max(0, (b.y - (G.cy - 40)) / (G.bottom - G.cy + 40));
        b.vx += Math.sin(anim.t * Math.PI * 2.6) * 1100 * low * h;
        if (b === chosen) { b.vx += (G.cx - b.x) * 6 * h; b.vy += 400 * h; } // gezogener Ball rutscht zur Öffnung
      }
      const v = Math.hypot(b.vx, b.vy);
      if (v > MAXV) { b.vx *= MAXV / v; b.vy *= MAXV / v; }
      b.x += b.vx * h; b.y += b.vy * h;
      const damp = cranking ? 0.995 : 0.985;
      b.vx *= damp; b.vy *= damp;
      // Glaswand (kaum federnd)
      const dx = b.x - G.cx, dy = b.y - G.cy, d = Math.hypot(dx, dy), lim = G.r - R - 4;
      if (d > lim) { const nx = dx / d, ny = dy / d; b.x = G.cx + nx * lim; b.y = G.cy + ny * lim; const vn = b.vx * nx + b.vy * ny; if (vn > 0) { b.vx -= 1.15 * vn * nx; b.vy -= 1.15 * vn * ny; } }
      if (b.y > G.bottom - R) { b.y = G.bottom - R; if (b.vy > 0) b.vy *= -0.1; b.vx *= 0.96; }
    }
    for (let it = 0; it < 2; it++) for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], c = balls[j];
      const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = 2 * R - 2;
      if (d >= min) continue;
      const push = (min - d) / 2, nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
      const rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      if (rv < 0) { const imp = -rv * 0.55; a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny; }
    }
  }
}

function draw() {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(machine, 0, 0);
  for (const b of balls) {
    if (anim?.ball?.seed === b.key && anim.phase === 'drop') {
      // in die Öffnung unten sinken
      const p = Math.min(1, anim.t / 0.3);
      if (p >= 1) continue;
      const c = ballCanvas(b.id, PX), sz = c.width * (1 - p);
      ctx.drawImage(c, Math.round(b.x - sz / 2), Math.round(b.y - sz / 2 + p * 30), sz, sz);
      continue;
    }
    ctx.drawImage(ballCanvas(b.id, PX), Math.round(b.x - R), Math.round(b.y - R));
  }
  // Glanzlicht auf dem Glas
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  for (let i = 0; i < 6; i++) ctx.fillRect(170 + i * 16, 230 - i * 10, 40, 8);
  const K = meta.knob;
  if (anim) {
    const t = anim.t;
    if (anim.phase === 'coin') {
      const c = iconCanvas('coin', 6), p = Math.min(1, t / 0.45);
      ctx.drawImage(c, K.x - c.width / 2, 700 + p * 145 - c.height / 2);
      if (t > 0.5) { anim.phase = 'crank'; anim.t = 0; }
    }
    if (anim.phase === 'crank') {
      // Drehknopf dreht sich (gestauchte Breite = Drehung)
      const sx = Math.cos(t * Math.PI * 3);
      ctx.fillStyle = '#9ea3b5';
      ctx.fillRect(K.x - 78, K.y - 48, 156, 96);
      ctx.save(); ctx.translate(K.x, K.y); ctx.scale(Math.abs(sx) < 0.15 ? 0.15 * Math.sign(sx || 1) : sx, 1);
      ctx.drawImage(knob, -knob.width / 2, -knob.height / 2); ctx.restore();
      if (t > 1.3) { anim.phase = 'drop'; anim.t = 0; }
    }
    if (anim.phase === 'drop') {
      // Ball rollt aus dem Schacht
      if (t < 0.3) return;
      const c = ballCanvas(anim.ball.ball, PX), p = Math.min(1, (t - 0.3) / 0.5);
      const y = meta.chute.y - 70 + p * 70 + Math.abs(Math.sin(p * Math.PI * 2)) * -14 * (1 - p);
      ctx.drawImage(c, meta.chute.x - R, y - R);
      if (t > 1.2) { anim.phase = 'done'; reveal(anim.result); }
    }
  }
}

function renderInfo() {
  const s = app.state;
  if (!s?.gacha || !meta) return;
  const g = s.gacha, cfg = CFG.balance.gacha;
  const counts = {};
  for (const b of g.balls) counts[b.ball] = (counts[b.ball] || 0) + 1;
  const next = fmtDuration(nextDayStart(now(), cfg.dayStartsAtHour) - now());
  const key = [g.balls.length, s.coins, next, !!anim].join('|');
  if (key === lastInfo) return;
  lastInfo = key;
  const info = $('#gacha-info');
  info.replaceChildren(
    h('b', `Heute im Automaten: ${g.balls.length} / ${cfg.ballsPerDay}`),
    h('small', `Neue Füllung in ${next}`),
    h('div.row', { style: { justifyContent: 'center', marginTop: '6px' } }, cfg.balls.map((b) => {
      const c = ballCanvas(b.id, 2); c.className = 'ico';
      return h('span.chip', { title: b.name }, c, ' ', counts[b.id] || 0);
    })));
  const btn = $('#gacha-draw');
  btn.replaceChildren('Kurbeln · ', iconImg('coin', 3), cfg.drawCost);
  btn.disabled = !!anim || !g.balls.length || s.coins < cfg.drawCost;
  if (!g.balls.length) btn.replaceChildren('Für heute leer');
}

function startDraw() {
  if (anim) return;
  const r = app.act((s, t) => A.draw(s, t), true);
  if (!r.ok) return;
  anim = { phase: 'coin', t: 0, ball: r.ball, result: r };
  renderInfo();
}

// ---- Enthüllung ----
function reveal(r) {
  const p = r.pokemon, sp = species(p.dex), ball = ballById(r.ball.ball);
  const legendary = sp.rarity === 'legendaer';
  const cv = h('canvas', { width: 380, height: 380 });
  const txt = h('div.txt');
  const el = h('div.reveal', h('div', cv, txt));
  document.body.append(el);
  const c = cv.getContext('2d');
  const sprites = loadSprites(p.dex, p.gender);
  const t0 = performance.now();
  let raf;
  const sparkles = Array.from({ length: 24 }, () => ({ a: Math.random() * Math.PI * 2, s: 60 + Math.random() * 140, r: Math.random() }));
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 380, 380);
    const cx = 190, cy = 200;
    const wobbleEnd = 1.9, openAt = 2.1;
    if (legendary || t > openAt) {
      // Lichtstrahlen
      c.save(); c.translate(cx, cy); c.rotate(t * 0.3);
      c.fillStyle = legendary ? 'rgba(255,215,90,.35)' : 'rgba(255,240,170,.35)';
      for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(-14, -200); c.lineTo(14, -200); c.fill(); }
      c.restore();
    }
    if (t < openAt) {
      const big = ballCanvas(ball.id, 12);
      const wob = t < wobbleEnd ? Math.sin(t * 9) * Math.max(0, Math.sin((t / wobbleEnd) * Math.PI * 3)) * 0.35 : 0;
      c.save(); c.translate(cx, cy + 40); c.rotate(wob); c.drawImage(big, -big.width / 2, -big.height); c.restore();
      if (t > wobbleEnd) { c.fillStyle = `rgba(255,255,255,${(t - wobbleEnd) / (openAt - wobbleEnd)})`; c.fillRect(0, 0, 380, 380); }
    } else {
      const k = t - openAt;
      if (k < 0.4) { c.fillStyle = `rgba(255,255,255,${1 - k / 0.4})`; c.fillRect(0, 0, 380, 380); }
      const open = ballCanvas(ball.id, 6, true);
      c.drawImage(open, cx - open.width / 2, 290 - open.height / 2);
      if (sprites.ready) {
        const f = frameOf(sprites, k < 0.8 ? 'Hop' : 'Idle', 0, k * 1000);
        const sc = Math.min(5, Math.floor(200 / Math.max(f.fw, f.fh))) * Math.min(1, 0.3 + k * 2);
        c.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, cx - (f.fw * sc) / 2, 230 - (f.fh * sc) / 2 - 30, f.fw * sc, f.fh * sc);
      }
      for (const s of sparkles) {
        const d = s.s * Math.min(1, k * 1.5);
        c.fillStyle = legendary ? '#ffd23f' : '#fff6a8';
        const sz = 4 + (Math.sin(k * 6 + s.r * 10) > 0 ? 4 : 0);
        c.fillRect(cx + Math.cos(s.a) * d, cy - 30 + Math.sin(s.a) * d, sz, sz);
      }
      if (!txt.childElementCount) showText();
    }
    raf = requestAnimationFrame(frame);
  };
  const close = () => { cancelAnimationFrame(raf); el.remove(); anim = null; lastInfo = ''; app.refresh(); };
  const showText = () => {
    const free = CFG.areas.filter((a) => app.state.areas[a.id].unlocked && residents(app.state, a.id).length < capacityOf(app.state, a.id));
    const sel = h('select', free.map((a) => h('option', { value: a.id }, `${a.name} (${residents(app.state, a.id).length}/${capacityOf(app.state, a.id)})${['  ✕ unwohl', '', '  ♥ passt'][habitatFit(p.dex, a.id).fit + 1]}`)));
    const best = free.find((a) => habitatFit(p.dex, a.id).fit > 0);
    if (best) sel.value = best.id;
    txt.append(
      h('div', h('span.tag.' + sp.rarity, CFG.balance.rarityNames[sp.rarity]), ' ', ball.name),
      h('h2', `${sp.name}!`, h('span.gender.' + p.gender, genderSymbol(p))),
      h('div.effects', sp.types.join(' / ')),
      free.length ? h('div.row', { style: { justifyContent: 'center', marginTop: '10px' } }, sel) : h('p.effects', 'Alle Areale sind voll – es wartet erst einmal in der Sammlung.'),
      h('div.acts',
        free.length ? h('button.btn.primary', { onclick: () => {
          const res = app.act((s) => A.assign(s, p, sel.value), true);
          if (res.ok) { toast(`${sp.name} zieht in ${areaById(sel.value).name} ein!`); close(); }
        } }, 'Einziehen lassen') : null,
        h('button.btn', { onclick: close }, free.length ? 'Später' : 'Weiter')));
  };
  raf = requestAnimationFrame(frame);
}
