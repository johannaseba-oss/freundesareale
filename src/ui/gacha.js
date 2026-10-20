// Bildschirm "Automat" (Vollbild): Bälle des Wochen-Pools in der Glaskugel; welcher herauskommt, entscheidet die Physik. Den Drehknopf dreht man mit dem Finger
// (oder kurz antippen = automatisch drehen). Haptisches Feedback beim Drehen, beim Herausfallen und beim Öffnen.
import { CFG, species, ballById, areaById } from '../config.js';
import { app } from '../app.js';
import { now, fmtDuration } from '../time.js';
import { nextWeekStart, revealActive, foreseers } from '../game/gacha.js';
import { portraitUrl } from '../gfx/sprites.js';
import * as A from '../game/actions.js';
import { capacityOf, residents, genderSymbol } from '../game/state.js';
import { habitatFit } from '../game/habitat.js';
import { ballCanvas, BALL_PIXELS } from '../gfx/balls.js';
import { iconCanvas, iconImg, drawCoin } from '../gfx/icons.js';
import { loadSprites, frameOf } from '../gfx/sprites.js';
import { haptic } from '../haptics.js';
import { $, h, toast } from './dom.js';

const BASE = import.meta.env.BASE_URL;
const PX = 7; // Pixelgröße der Bälle in der Kugel (Automatenbild ist ~8x vergrößerte Pixel-Art)
const R = (BALL_PIXELS * PX) / 2;
const TAU = Math.PI * 2;
let meta, machine, knob, ctx, canvas, plateColor = '#9ea3b5';
let balls = [];
let anim = null; // Ziehung läuft: {phase: 'drop', t, ball, result}
let crank = { active: false, auto: false, angle: 0, accum: 0, t: 0, ticks: 0, coin: 0 };
let poolWeek = '';
let settle = 0; // Zeit, seit die Bälle ruhig liegen
const portraits = new Map();
const portraitImg = (dex) => { if (!portraits.has(dex)) { const i = new Image(); i.src = portraitUrl(dex); portraits.set(dex, i); } return portraits.get(dex); };
let lastInfo = '';

const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });

export async function initGacha() {
  meta = await fetch(`${BASE}art/automat.json`).then((r) => r.json());
  [machine, knob] = await Promise.all([load(`${BASE}art/automat.png`), load(`${BASE}art/knob.png`)]);
  canvas = $('#machine');
  canvas.width = meta.width; canvas.height = meta.height;
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Farben für Plattenhintergrund und Bildschirmränder aus dem Bild nehmen
  ctx.drawImage(knob, 0, 0);
  const pc = ctx.getImageData(4, 4, 1, 1).data; plateColor = `rgb(${pc[0]},${pc[1]},${pc[2]})`;
  ctx.drawImage(machine, 0, 0);
  const top = ctx.getImageData(10, 10, 1, 1).data, bot = ctx.getImageData(10, meta.height - 10, 1, 1).data;
  $('#scr-gacha').style.background = `linear-gradient(rgb(${top[0]},${top[1]},${top[2]}) 50%, rgb(${bot[0]},${bot[1]},${bot[2]}) 50%)`;
  bindKnob();
  app.views.add(renderInfo);
  $('#gacha-psychic').onclick = useForesight;
  if (import.meta.env.DEV) app.gacha = { step: (dt) => { stepCrank(dt); step(dt); }, draw, finishCrank, get balls() { return balls; }, get anim() { return anim; }, exitPoint };
  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (!$('#scr-gacha').classList.contains('hidden')) { stepCrank(dt); step(dt); draw(t); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Bildschirm -> Bildkoordinaten (Canvas wird mit object-fit: contain dargestellt)
function toImage(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const k = Math.min(r.width / canvas.width, r.height / canvas.height);
  const ox = r.left + (r.width - canvas.width * k) / 2, oy = r.top + (r.height - canvas.height * k) / 2;
  return { x: (cx - ox) / k, y: (cy - oy) / k };
}

function bindKnob() {
  let grab = null;
  const K = () => meta.knob;
  canvas.addEventListener('pointerdown', (e) => {
    if (anim || crank.active || crank.auto) return;
    const p = toImage(e.clientX, e.clientY);
    if (Math.hypot(p.x - K().x, p.y - K().y) > 130) return;
    const s = app.state, t = now();
    if (!A.canDraw(s, t)) {
      haptic('medium');
      toast(!s.gacha?.machine?.length ? 'Der Automat ist für diese Woche leer.' : 'Nicht genug Glücksmünzen.', true);
      return;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
    grab = { a: Math.atan2(p.y - K().y, p.x - K().x), moved: 0 };
    crank = { active: true, auto: false, angle: crank.angle, accum: 0, t: 0, ticks: 0, coin: A.freeDrawReady(s, t) ? 0 : 0.001 };
    haptic('tick');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!grab || !crank.active) return;
    const p = toImage(e.clientX, e.clientY);
    const a = Math.atan2(p.y - K().y, p.x - K().x);
    let d = a - grab.a;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    grab.a = a;
    grab.moved += Math.abs(d);
    if (d > 0) turn(d); // nur im Uhrzeigersinn
  });
  const end = () => {
    if (!grab) return;
    const g = grab; grab = null;
    if (!crank.active) return;
    if (g.moved < 0.35) { crank.active = false; crank.auto = true; return; } // kurz angetippt -> automatisch drehen
    if (crank.accum < TAU) { crank.active = false; crank.accum = 0; crank.coin = 0; } // nicht ganz gedreht -> abbrechen
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// Knopf um d (Radiant) weiterdrehen; alle 90° ein Haptik-Tick, nach einer vollen Umdrehung wird gezogen
function turn(d) {
  crank.angle += d;
  crank.accum += d;
  const ticks = Math.floor(crank.accum / (Math.PI / 2));
  if (ticks > crank.ticks) { crank.ticks = ticks; haptic(ticks >= 4 ? 'medium' : 'tick'); }
  if (crank.accum >= TAU) finishCrank();
}

function stepCrank(dt) {
  if (crank.active || crank.auto) crank.t += dt;
  if (crank.coin > 0) crank.coin += dt;
  if (crank.auto) turn((dt * TAU) / 1.1);
}

// Ausgabeöffnung unten in der Kugel: der Ball, der ihr beim Ende der Drehung am nächsten liegt, fällt hinein
function exitPoint() { const G = meta.globe; return { x: G.cx, y: G.bottom - R }; }
function finishCrank() {
  crank.active = false; crank.auto = false; crank.accum = 0; crank.coin = 0;
  const ex = exitPoint();
  const chosen = balls.reduce((best, b) => (!best || Math.hypot(b.x - ex.x, b.y - ex.y) < Math.hypot(best.x - ex.x, best.y - ex.y) ? b : best), null);
  if (!chosen) return;
  const r = app.act((st, t) => A.draw(st, t, chosen.key), true);
  if (!r.ok) return;
  anim = { phase: 'drop', t: 0, key: r.ball.key, ballId: r.ball.ball, result: r, landed: false, from: { x: chosen.x, y: chosen.y } };
  renderInfo();
}

// Kugel-Inhalt an den Spielstand anpassen: gespeicherte Positionen übernehmen, neue Bälle fallen von oben hinein.
// Der gerade gezogene Ball bleibt bis zum Ende der Animation sichtbar.
function syncBalls() {
  const g = app.state.gacha;
  if (!g?.machine) return;
  if (g.week !== poolWeek) { balls = []; poolWeek = g.week; }
  const keys = new Set(g.machine.map((b) => b.key));
  balls = balls.filter((b) => keys.has(b.key) || b.key === anim?.key);
  const have = new Set(balls.map((b) => b.key));
  const G = meta.globe;
  let drop = 0;
  for (const b of g.machine) {
    if (have.has(b.key)) continue;
    const saved = b.x != null && b.y != null;
    balls.push({ key: b.key, id: b.ball, dex: b.dex,
      x: saved ? b.x : G.cx + (Math.random() - 0.5) * G.r * 0.8,
      y: saved ? b.y : G.top + R - drop++ * 2 * R, vx: 0, vy: 0,
      a: b.a ?? ((b.key % 360) * Math.PI) / 180 }); // eigene Drehung je Ball (gespeichert oder aus dem Schlüssel)
    settle = 0;
  }
}

const SUB = 6, GRAV = 1500, MAXV = 520;
function step(dt) {
  if (!app.state?.gacha) return;
  syncBalls();
  if (anim) anim.t += dt;
  const G = meta.globe;
  const cranking = crank.active || crank.auto;
  const chosen = anim?.phase === 'drop' ? balls.find((x) => x.key === anim.key) : null;
  const h = dt / SUB;
  for (let sub = 0; sub < SUB; sub++) {
    for (const b of balls) {
      if (b === chosen) continue;
      b.vy += GRAV * h;
      if (cranking) {
        // sanftes Schwappen: das Rad unten schiebt die unteren Bälle hin und her
        const low = Math.max(0, (b.y - (G.cy - 40)) / (G.bottom - G.cy + 40));
        b.vx += Math.sin(crank.t * Math.PI * 2.6) * 1100 * low * h;
      }
      const v = Math.hypot(b.vx, b.vy);
      if (v > MAXV) { b.vx *= MAXV / v; b.vy *= MAXV / v; }
      b.x += b.vx * h; b.y += b.vy * h;
      b.a += (b.vx * h) / R; // rollen: Drehung folgt der Bewegung
      const damp = cranking ? 0.995 : 0.985;
      b.vx *= damp; b.vy *= damp;
      // Glaswand (kaum federnd)
      const dx = b.x - G.cx, dy = b.y - G.cy, d = Math.hypot(dx, dy), lim = G.r - R - 4;
      if (d > lim) { const nx = dx / d, ny = dy / d; b.x = G.cx + nx * lim; b.y = G.cy + ny * lim; const vn = b.vx * nx + b.vy * ny; if (vn > 0) { b.vx -= 1.15 * vn * nx; b.vy -= 1.15 * vn * ny; } }
      if (b.y > G.bottom - R) { b.y = G.bottom - R; if (b.vy > 0) b.vy *= -0.1; b.vx *= 0.96; }
    }
    for (let it = 0; it < 2; it++) for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], c = balls[j];
      if (a === chosen || c === chosen) continue;
      const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = 2 * R - 2;
      if (d >= min) continue;
      const push = (min - d) / 2, nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
      const rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      if (rv < 0) { const imp = -rv * 0.55; a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny; }
    }
  }
  // Positionen speichern, sobald alles ruhig liegt (damit beim nächsten Öffnen alles genauso daliegt)
  // ruhig = kaum tatsächliche Bewegung seit dem letzten Bild (die Rechen-Geschwindigkeit zittert in Stapeln leicht)
  const moving = balls.some((b) => { const mv = b.px != null && Math.hypot(b.x - b.px, b.y - b.py) / Math.max(dt, 1e-3) > 15; b.px = b.x; b.py = b.y; return b !== chosen && mv; });
  settle = moving || cranking || anim ? 0 : settle + dt;
  if (settle > 0.8 && settle - dt <= 0.8) {
    const g = app.state.gacha;
    const changed = balls.some((b) => { const m = g.machine.find((x) => x.key === b.key); return m && (m.x == null || Math.abs(m.x - b.x) > 3 || Math.abs(m.y - b.y) > 3); });
    if (changed) { A.storeBallPositions(app.state, balls); app.saver?.markDirty(); }
  }
}

// Ball gedreht zeichnen (scale = Größe beim Versinken)
function drawBall(id, x, y, a, scale = 1) {
  const c = ballCanvas(id, PX);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(a); ctx.scale(scale, scale);
  ctx.drawImage(c, -R, -R);
  ctx.restore();
}

function draw() {
  ctx.imageSmoothingEnabled = false;
  const rv = revealActive(app.state, now());
  const rev = rv ? new Set(rv.keys) : null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(machine, 0, 0);
  for (const b of balls) {
    if (anim?.key === b.key && anim.phase === 'drop') {
      // rollt zur Öffnung und versinkt darin
      const ex = exitPoint(), p = Math.min(1, anim.t / 0.35), q = Math.max(0, (anim.t - 0.35) / 0.25);
      if (q >= 1) continue;
      const x = anim.from.x + (ex.x - anim.from.x) * p, y = anim.from.y + (ex.y - anim.from.y) * p;
      drawBall(b.id, x, y + q * 30, b.a, 1 - q);
      continue;
    }
    if (rev?.has(b.key)) continue; // aufgedeckte Bälle werden darüber gezeichnet
    drawBall(b.id, b.x, b.y, b.a);
  }
  // Psycho-Blick: wabernde Bälle mit sichtbarem Inhalt
  if (rev) {
    const t = performance.now() / 1000;
    for (const b of balls) {
      if (!rev.has(b.key) || anim?.key === b.key) continue;
      const wob = Math.sin(t * 3 + b.key % 7) * 4;
      const glow = ctx.createRadialGradient(b.x, b.y, R * 0.4, b.x, b.y, R * 1.7);
      glow.addColorStop(0, 'rgba(200,120,255,0.55)'); glow.addColorStop(1, 'rgba(200,120,255,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(b.x, b.y, R * 1.7, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.scale(1 + Math.sin(t * 5 + b.key % 5) * 0.06, 1 - Math.sin(t * 5 + b.key % 5) * 0.06);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(ballCanvas(b.id, PX), -R + wob * 0.3, -R);
      ctx.restore();
      // Porträt des Inhalts im Ball
      const img = portraitImg(b.dex);
      if (img.complete && img.naturalWidth) {
        const ps = R * 1.75;
        ctx.save();
        ctx.beginPath(); ctx.arc(b.x, b.y, ps / 2 + 2, 0, TAU); ctx.clip();
        ctx.globalAlpha = 0.75 + Math.sin(t * 4 + b.key % 3) * 0.2;
        ctx.drawImage(img, b.x - ps / 2, b.y - ps / 2, ps, ps);
        ctx.restore();
        ctx.strokeStyle = 'rgba(190,110,255,0.9)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(b.x, b.y, ps / 2 + 2 + Math.sin(t * 6) * 1.5, 0, TAU); ctx.stroke();
      }
    }
  }
  // Glanzlicht auf dem Glas
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  for (let i = 0; i < 6; i++) ctx.fillRect(170 + i * 16, 230 - i * 10, 40, 8);
  const K = meta.knob;
  // Drehknopf (dreht sich in der Platte)
  ctx.save();
  ctx.beginPath(); ctx.arc(K.x, K.y, 66, 0, TAU); ctx.clip();
  ctx.fillStyle = plateColor; ctx.fillRect(K.x - 70, K.y - 70, 140, 140);
  ctx.translate(K.x, K.y); ctx.rotate(crank.angle);
  ctx.drawImage(knob, -knob.width / 2, -knob.height / 2);
  ctx.restore();
  // Münze fällt in den Schlitz
  if (crank.coin > 0 && crank.coin < 0.5) {
    const p = Math.min(1, crank.coin / 0.45);
    ctx.globalAlpha = 1 - Math.max(0, p - 0.8) * 5;
    drawCoin(ctx, K.x, 700 + p * 145, 80, crank.coin * 1000);
    ctx.globalAlpha = 1;
  }
  if (anim?.phase === 'drop') {
    const t = anim.t;
    if (t >= 0.6) {
      const c = ballCanvas(anim.ballId, PX), p = Math.min(1, (t - 0.6) / 0.5);
      const y = meta.chute.y - 70 + p * 70 + Math.abs(Math.sin(p * Math.PI * 2)) * -14 * (1 - p);
      ctx.drawImage(c, meta.chute.x - R, y - R);
      if (p >= 1 && !anim.landed) { anim.landed = true; haptic('strong'); }
    }
    if (t > 1.5) { anim.phase = 'done'; reveal(anim.result); }
  }
}

function renderInfo() {
  const s = app.state;
  if (!s?.gacha?.machine || !meta) return;
  const cfg = CFG.balance.gacha, t = now();
  const left = s.gacha.machine.length + s.gacha.queue.length;
  const empty = !s.gacha.machine.length, free = !empty && A.freeDrawReady(s, t);
  const rv = revealActive(s, t), seers = rv ? [] : foreseers(s, t);
  const line1 = empty ? `Diese Woche leer · neue Füllung in ${fmtDuration(nextWeekStart(t) - t)}`
    : free ? '✦ Gratis-Ziehung bereit ✦' : `· gratis in ${fmtDuration(s.freeDrawAt - t)}`;
  const line2 = `${left} Bälle diese Woche · neu in ${fmtDuration(nextWeekStart(t) - t)}`;
  const line3 = rv ? `🔮 Psycho-Blick noch ${fmtDuration(rv.until - t)}` : '';
  const key = [line1, line2, line3, !!anim, seers.map((p) => p.uid).join()].join('|');
  if (key === lastInfo) return;
  lastInfo = key;
  $('#gacha-info').replaceChildren(
    h('div', ...(empty || free ? [line1] : ['Ziehung ', iconImg('coin', 2), ` ${cfg.drawCost} ${line1}`])),
    h('small', line2), line3 ? h('small.psy-line', line3) : null);
  $('#gacha-info').classList.toggle('free', !!free);
  $('#gacha-hint').classList.toggle('hidden', !!anim || empty);
  const btn = $('#gacha-psychic');
  btn.classList.toggle('hidden', !seers.length || empty);
  if (seers.length) btn.textContent = `🔮 Psycho-Blick (${species(seers[0].dex).name})`;
}

function useForesight() {
  const p = foreseers(app.state, now())[0];
  if (!p) return;
  const r = app.act((st, t) => A.foresee(st, p, t), true);
  if (!r.ok) return;
  haptic('strong');
  const flash = h('div.psy-flash');
  $('#scr-gacha').append(flash);
  setTimeout(() => flash.remove(), 900);
  toast(`${species(p.dex).name} blickt in die Pokébälle …`);
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
      if (!opened) { opened = true; haptic('strong'); }
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
  let opened = false;
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
