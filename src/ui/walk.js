// Spaziergang-Oberfläche: Pokémon wählen, Route auf der Karte zeichnen, losgehen – wilde Pokémon meiden oder bekämpfen.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { canBattle, moveOf } from '../game/battle.js';
import { speedOf, physBuff } from '../game/rocks.js';
import { makeMap, walkable, spawnWild, moveWild, maxSteps, walkSpeed, walkedToday, makeFighter, battleTurn, moveCost, walkWin, walkDone, payMove, cellOf } from '../game/walk.js';
import { renderTerrain, tilesImage, themeOf } from '../gfx/tiles2.js';
import { typeColor } from '../game/types.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { iconImg } from '../gfx/icons.js';
import { $, h, toast, modal, confirmDialog } from './dom.js';
import { sfx, setMusic } from '../audio.js';
import { haptic } from '../haptics.js';
import { now } from '../time.js';

const WK = () => CFG.walk;
const base = import.meta.env.BASE_URL;
const name = (p) => p.nick || species(p.dex).name;
const dots = (n) => '●'.repeat(n) + '○'.repeat(5 - n);
let ui = null, setupEl = null, setupBack = null;

// ================= Auswahl =================
export function renderWalkSetup(el, back) {
  setupEl = el; setupBack = back;
  const mons = (app.state.pokemon || []).filter((p) => canBattle(p.dex)).sort((a, b) => maxSteps(b) - maxSteps(a) || speedOf(b).value - speedOf(a).value);
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: back }, '‹ Zurück'),
    h('div.bs-head', h('h2', '🐾 Spaziergang')),
    h('p.note', 'Zeichne auf der Karte eine Runde vom 🏠 aus und wieder zurück. Ausdauer = wie weit, Tempo = wie schnell. Wilde Pokémon laufen umher – weiche ihnen aus oder kämpfe. Im Kampf kostet jede Attacke Münzen – wer nicht zahlen kann, dessen Pokémon rennt vor Angst nach Hause!'),
    mons.length ? h('div.bs-list', mons.map((p) => {
      const done = walkedToday(app.state, p.uid, now()), sp = speedOf(p);
      return h('button.bs-row.rk-row' + (done ? '.done' : ''), { onclick: () => (done ? toast(`${name(p)} war heute schon spazieren.`) : startWalk(p)) },
        h('img.rk-por', { src: portraitUrl(p.dex), alt: '' }),
        h('div.bs-row-text', h('b', name(p), h('small.wk-lv', ` Lv ${p.level}`), done ? h('span.rk-done', '✓ heute gelaufen') : null),
          h('div.rk-stat', h('span.k', 'Ausdauer'), h('span.rk-dots', dots(p.stamina || 1)), h('small', `${maxSteps(p)} Schritte`)),
          h('div.rk-stat', h('span.k', 'Tempo'), h('span.rk-dots', dots(sp.level)), h('small', `${walkSpeed(p)} Felder/s`))),
        h('span.bs-go', done ? '' : '›'));
    })) : h('p.note.warn', 'Du brauchst Pokémon – zieh welche am Automaten!')));
}

// ================= Karte =================
// Planen: ganze Karte im Überblick, Route mit dem Finger zeichnen. Laufen: Kamera zoomt heran und folgt dem Trainer,
// dein Pokémon läuft hinterher. Unten eine Pokéwalker-Anzeige mit Schrittzähler.
const TS = 16; // Weltpixel je Feld (Tileset)
function startWalk(p) {
  closeWalk();
  const rnd = Math.random, map = makeMap(rnd);
  const canvas = h('canvas.sl-canvas');
  const lcd = h('div.pw-lcd', h('div.pw-l1'), h('div.pw-bar', h('i')), h('div.pw-l2'));
  const undo = h('button.pw-btn', { onclick: () => { if (ui.phase === 'plan' && ui.route.length > 1) { ui.route.pop(); haptic('tick'); } }, title: 'Schritt zurück' }, '↶');
  const clear = h('button.pw-btn', { onclick: () => { if (ui.phase === 'plan') { ui.route = []; haptic('tick'); } }, title: 'Route löschen' }, '🗑');
  const go = h('button.pw-btn.go', { onclick: startWalking }, 'LOS');
  const walker = h('div.pw', h('div.pw-body', h('div.pw-rim', lcd), h('div.pw-btns', undo, clear, go)));
  const hint = h('div.wk-hint', 'Zeichne vom Startplatz aus eine Runde und komm wieder zurück.');
  const chip = h('div.wk-chip', h('img', { src: portraitUrl(p.dex), alt: '' }), h('div', h('b', name(p)), h('small', `Lv ${p.level} · Ausdauer ${p.stamina || 1} · Tempo ${speedOf(p).level}`)));
  const root = h('div.sl-full.walk2', canvas, hint, chip, h('button.sl-fab.right', { onclick: leave, title: 'Beenden' }, '✕'), walker);
  document.body.append(root);
  document.body.classList.add('in-battle');
  setMusic('menu');
  const me = makeFighter({ ...p, pbuff: physBuff(app.state, { uid: p.uid, dex: p.dex }, now()) }, p.level);
  const tr = new Image(); tr.src = `${base}art/trainers/${app.state.profile?.sprite || 1}.png`;
  ui = { p, me, map, rnd, root, canvas, ctx: canvas.getContext('2d'), lcd, go, walker, hint, trainer: tr, phase: 'plan', route: [], drawing: false,
    wild: spawnWild(map, rnd, p.level), t: 0, s: 0, wins: 0, ep: 0, evs: [0, 0, 0, 0, 0, 0], last: performance.now(), raf: 0, max: maxSteps(p), speed: walkSpeed(p), cam: null, bang: [] };
  loadSprites(p.dex, p.gender); for (const w of ui.wild) loadSprites(w.dex);
  const ti = tilesImage(); if (!ti.complete) ti.addEventListener('load', () => { if (ui) ui.bg = null; }, { once: true });
  ui.ro = new ResizeObserver(layout); ui.ro.observe(root);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  const up = () => { if (ui) ui.drawing = false; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  layout();
  const loop = (t) => { if (!ui) return; const dt = Math.min(0.05, (t - ui.last) / 1000); ui.last = t; frame(dt); ui.raf = requestAnimationFrame(loop); };
  ui.raf = requestAnimationFrame(loop);
  if (import.meta.env.DEV) app.walk = { get ui() { return ui; }, step: (dt) => frame(dt), go: startWalking };
}
function closeWalk() {
  if (!ui) return;
  cancelAnimationFrame(ui.raf); ui.ro.disconnect(); ui.root.remove();
  document.body.classList.remove('in-battle');
  ui = null;
  setMusic('menu');
}
function layout() {
  const { canvas, root, map } = ui, r = root.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  const foot = ui.walker.getBoundingClientRect().height || 120, top = 56;
  // Überblick: ganze Karte zwischen oberer Leiste und Pokéwalker
  const fitV = Math.min(r.width / (map.cols * TS), (r.height - foot - top) / (map.rows * TS));
  Object.assign(ui, { dpr, w: r.width, h: r.height, foot, top, fitV, bg: ui.bg });
  ui.cam ||= { x: (map.cols * TS) / 2, y: (map.rows * TS) / 2, v: fitV };
}
// Kamera-Ziel: im Überblick die ganze Karte, beim Laufen nah am Trainer (am Kartenrand angehalten)
function camTarget() {
  const M = ui.map, mapW = M.cols * TS, mapH = M.rows * TS, viewH = ui.h - ui.foot - ui.top;
  if (ui.phase === 'plan' || ui.over) return { x: mapW / 2, y: mapH / 2, v: ui.fitV };
  const v = Math.max(ui.fitV, WK().zoom || 2), p = posAt(ui.s), hw = ui.w / 2 / v, hh = viewH / 2 / v;
  return { x: Math.max(hw, Math.min(mapW - hw, (p.x + 0.5) * TS)), y: Math.max(hh, Math.min(mapH - hh, (p.y + 0.5) * TS)), v };
}
const toWorld = (e) => { const r = ui.canvas.getBoundingClientRect(), c = ui.cam; return [(e.clientX - r.left - ui.w / 2) / c.v + c.x, (e.clientY - r.top - ui.top - (ui.h - ui.foot - ui.top) / 2) / c.v + c.y]; };
const cellAt = (e) => toWorld(e).map((v) => Math.floor(v / TS));
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
const isHome = (c) => same(c, ui.map.home);

// ---- Route zeichnen ----
function onDown(e) {
  if (ui.phase !== 'plan') return;
  const c = cellAt(e), R = ui.route, last = R[R.length - 1];
  if (!R.length) { if (ui.map.g[c[1]]?.[c[0]] === 'C') { R.push([...ui.map.home]); ui.drawing = true; haptic('tick'); extend(c); } else toast('Fang am Startplatz an.'); return; }
  if (same(c, last)) { ui.drawing = true; return; }
  if (Math.abs(c[0] - last[0]) + Math.abs(c[1] - last[1]) <= 2) { ui.drawing = true; extend(c); return; }
  toast('Zeichne am Ende deiner Route weiter.');
}
function onMove(e) { if (ui?.drawing && ui.phase === 'plan') extend(cellAt(e)); }
// Schritt für Schritt (nur waagrecht/senkrecht) zum Finger; zurück auf das vorletzte Feld = letzten Schritt löschen
function extend(target) {
  const R = ui.route;
  for (let guard = 0; guard < 40; guard++) {
    const last = R[R.length - 1];
    if (same(last, target)) return;
    const dx = Math.sign(target[0] - last[0]), dy = Math.sign(target[1] - last[1]);
    const tries = Math.abs(target[0] - last[0]) >= Math.abs(target[1] - last[1]) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
    const step = tries.map(([a, b]) => [last[0] + a, last[1] + b]).find((c) => (c[0] !== last[0] || c[1] !== last[1]) && walkable(ui.map, c[0], c[1]));
    if (!step) return;
    if (R.length > 1 && same(step, R[R.length - 2])) { R.pop(); continue; }
    if (R.length - 1 >= ui.max) { if (!ui.maxWarn || performance.now() - ui.maxWarn > 1500) { toast(`Weiter schafft ${name(ui.p)} nicht (${ui.max} Schritte).`); ui.maxWarn = performance.now(); } return; }
    R.push(step);
    if (R.length % 2) haptic('tick');
  }
}
const complete = () => ui.route.length > 3 && isHome(ui.route[ui.route.length - 1]);

function startWalking() {
  if (!ui || ui.phase !== 'plan') return;
  if (!complete()) { toast('Die Route muss wieder am Startplatz enden.'); return; }
  ui.phase = 'walk'; ui.s = 0; ui.drawing = false;
  ui.walker.classList.add('walking'); ui.hint.textContent = 'Los geht’s! Wer euch begegnet, will kämpfen.';
  setTimeout(() => ui?.hint.classList.add('hidden'), 2600);
  haptic('medium'); sfx.place();
}
// Position auf der Route (Felder, s = zurückgelegte Schritte); Blickrichtung 0 unten, 2 rechts, 4 oben, 6 links
function posAt(s) {
  const R = ui.route;
  if (!R.length) return { x: ui.map.home[0], y: ui.map.home[1], dir: 4 };
  s = Math.max(0, s);
  const i = Math.min(R.length - 2, Math.floor(s)), k = Math.min(1, s - i);
  const a = R[Math.max(0, i)], b = R[i + 1] || a;
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, dir: b[0] > a[0] ? 2 : b[0] < a[0] ? 6 : b[1] > a[1] ? 0 : 4 };
}

function frame(dt) {
  if (!ui) return;
  if (!ui.battle && !ui.over) {
    ui.t += dt;
    moveWild(ui.map, ui.wild, dt, ui.rnd);
    if (ui.phase === 'walk') {
      ui.s = Math.min(ui.route.length - 1, ui.s + ui.speed * dt);
      const me = posAt(ui.s);
      // „!“ über wilden Pokémon in der Nähe
      for (const w of ui.wild) if (!w.gone && w.ignore < ui.t && Math.hypot(w.x - me.x, w.y - me.y) < 2.2 && !w.seen) { w.seen = ui.t; sfx.place(); }
      const hit = ui.wild.find((w) => !w.gone && w.ignore < ui.t && Math.hypot(w.x - me.x, w.y - me.y) < 0.7);
      if (hit) openBattle(hit);
      else if (ui.s >= ui.route.length - 1) finish(true);
    }
  }
  // Kamera weich nachführen
  const tg = camTarget(), c = ui.cam, k = Math.min(1, dt * (ui.phase === 'walk' ? 4 : 6));
  c.x += (tg.x - c.x) * k; c.y += (tg.y - c.y) * k; c.v += (tg.v - c.v) * k;
  renderLcd();
  draw();
}
function renderLcd() {
  const used = Math.max(0, ui.route.length - 1), [l1, bar, l2] = ui.lcd.children;
  if (ui.phase === 'plan') {
    l1.textContent = `👣 ${String(used).padStart(2, '0')} / ${ui.max}`;
    bar.firstChild.style.width = Math.min(100, (used / ui.max) * 100) + '%';
    l2.textContent = complete() ? 'RUNDE FERTIG – LOS!' : used ? 'ZURÜCK ZUM START' : 'START ANTIPPEN & ZIEHEN';
    ui.go.disabled = !complete();
  } else {
    l1.textContent = `👣 ${String(Math.floor(ui.s)).padStart(2, '0')} / ${used}`;
    bar.firstChild.style.width = (ui.s / Math.max(1, used)) * 100 + '%';
    l2.textContent = `⚔ ${ui.wins}   ♥ ${Math.ceil(ui.me.hp)}/${ui.me.maxHp}`;
  }
}

// Weltkarte einmal in Originalgröße rendern (mit etwas Wald rundherum)
const MARGIN = 6;
function buildBackground() {
  const M = ui.map;
  return renderTerrain({ c0: -MARGIN, r0: -MARGIN, c1: M.cols - 1 + MARGIN, r1: M.rows - 1 + MARGIN, cellAt: (x, y) => cellOf(M, x, y), theme: M.theme, seed: (M.home[0] * 7 + M.cols) | 0 });
}
function drawMon(x, dex, gender, wx, wy, dir, anim, ms, inGrass) {
  const e = loadSprites(dex, gender);
  if (!e.ready) return;
  const f = frameOf(e, anim, dir, ms);
  let s = TS / 22; if (e.anims.Idle.fh * s > TS * 1.9) s = (TS * 1.9) / e.anims.Idle.fh;
  const X = (wx + 0.5) * TS, Y = (wy + 0.5) * TS;
  x.fillStyle = 'rgba(20,30,10,.3)'; x.beginPath(); x.ellipse(X, Y + TS * 0.32, TS * 0.32, TS * 0.11, 0, 0, 7); x.fill();
  x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, X - (f.fw * s) / 2, Y + TS * 0.05 - (f.fh * s) / 2, f.fw * s, f.fh * s);
  if (inGrass) grassOver(x, X, Y);
}
// hohes Gras verdeckt die Füße
function grassOver(x, X, Y) {
  const blk = CFG.tiles2.auto[themeOf(ui.map.theme).tall], im = tilesImage();
  if (!blk || !im.complete) return;
  x.drawImage(im, (blk[0] + 3) * TS, blk[1] * TS + 8, TS, 8, X - TS / 2, Y + TS * 0.12, TS, 8);
}
function drawTrainer(x, wx, wy, dir, moving, t) {
  const im = ui.trainer;
  if (!im.complete || !im.naturalWidth) return;
  const row = { 0: 0, 6: 1, 2: 2, 4: 3 }[dir] ?? 0, fr = moving ? Math.floor(t * 7) % 4 : 0, s = 0.56;
  const X = (wx + 0.5) * TS, Y = (wy + 0.5) * TS;
  x.fillStyle = 'rgba(20,30,10,.3)'; x.beginPath(); x.ellipse(X, Y + TS * 0.34, TS * 0.3, TS * 0.1, 0, 0, 7); x.fill();
  x.drawImage(im, fr * 64, row * 64, 64, 64, X - 32 * s, Y + TS * 0.38 - 58 * s, 64 * s, 64 * s);
  if (cellOf(ui.map, Math.round(wx), Math.round(wy)) === 'T') grassOver(x, X, Y);
}
function draw() {
  const U = ui, x = U.ctx, t = performance.now(), c = U.cam, M = U.map;
  x.setTransform(U.dpr, 0, 0, U.dpr, 0, 0); x.imageSmoothingEnabled = false;
  x.fillStyle = '#2d4a24'; x.fillRect(0, 0, U.w, U.h);
  if (!U.bg && tilesImage().complete) U.bg = buildBackground();
  // Welt-Transformation
  const midY = U.top + (U.h - U.foot - U.top) / 2;
  x.setTransform(U.dpr * c.v, 0, 0, U.dpr * c.v, U.dpr * (U.w / 2 - c.x * c.v), U.dpr * (midY - c.y * c.v));
  if (U.bg) x.drawImage(U.bg, -MARGIN * TS, -MARGIN * TS);
  // Route: Fußspuren-Punkte, fertig = grün; gelaufener Teil verblasst
  const R = U.route;
  if (R.length) {
    const ok = complete(), done = U.phase === 'walk' ? U.s : -1;
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.strokeStyle = 'rgba(30,20,10,.35)'; x.lineWidth = 6;
    x.beginPath(); R.forEach((p, i) => (i ? x.lineTo((p[0] + 0.5) * TS, (p[1] + 0.5) * TS) : x.moveTo((p[0] + 0.5) * TS, (p[1] + 0.5) * TS))); x.stroke();
    x.strokeStyle = ok ? 'rgba(130,240,130,.95)' : 'rgba(255,250,225,.95)'; x.lineWidth = 3.5; x.setLineDash([2, 4]); x.lineDashOffset = -t / 60; x.stroke(); x.setLineDash([]);
    if (done > 0) { x.strokeStyle = 'rgba(120,80,40,.7)'; x.lineWidth = 3.5; x.beginPath(); for (let i = 0; i <= Math.floor(done); i++) { const p = R[i]; i ? x.lineTo((p[0] + 0.5) * TS, (p[1] + 0.5) * TS) : x.moveTo((p[0] + 0.5) * TS, (p[1] + 0.5) * TS); } const me = posAt(done); x.lineTo((me.x + 0.5) * TS, (me.y + 0.5) * TS); x.stroke(); }
    if (U.phase === 'plan') { const l = R[R.length - 1]; x.fillStyle = '#fff'; x.beginPath(); x.arc((l[0] + 0.5) * TS, (l[1] + 0.5) * TS, 3 + Math.sin(t / 150), 0, 7); x.fill(); x.strokeStyle = '#2d4a24'; x.lineWidth = 1; x.stroke(); }
  }
  // Startplatz-Markierung (Fahne)
  { const X = (M.home[0] + 0.5) * TS, Y = (M.home[1] + 0.5) * TS; x.fillStyle = '#6b4a2a'; x.fillRect(X + 9, Y - 16, 1.5, 16); x.fillStyle = Math.floor(t / 300) % 2 ? '#e8453c' : '#f2655c'; x.beginPath(); x.moveTo(X + 10.5, Y - 16); x.lineTo(X + 18, Y - 13); x.lineTo(X + 10.5, Y - 10); x.fill(); }
  // Figuren nach Höhe sortiert
  const list = U.wild.filter((w) => !w.gone).map((w) => ({ w, y: w.y }));
  const walking = U.phase === 'walk' && !U.battle && !U.over;
  const tp = posAt(U.phase === 'walk' ? U.s : 0), pp = U.phase === 'walk' ? posAt(U.s - 0.85) : { x: M.home[0] - 0.7, y: M.home[1], dir: 4 };
  list.push({ trainer: true, y: tp.y }, { mon: true, y: pp.y });
  list.sort((a, b) => a.y - b.y);
  for (const o of list) {
    if (o.trainer) drawTrainer(x, tp.x, tp.y, U.phase === 'walk' ? tp.dir : 0, walking, t / 1000);
    else if (o.mon) drawMon(x, U.p.dex, U.p.gender, pp.x, pp.y, U.phase === 'walk' ? pp.dir : 0, walking ? 'Walk' : 'Idle', t, cellOf(M, Math.round(pp.x), Math.round(pp.y)) === 'T');
    else {
      const w = o.w, inG = cellOf(M, Math.round(w.x), Math.round(w.y)) === 'T';
      if (w.ignore > U.t) x.globalAlpha = 0.5;
      drawMon(x, w.dex, null, w.x, w.y, w.dir, w.k < 1 ? 'Walk' : 'Idle', t, inG);
      x.globalAlpha = 1;
      const X = (w.x + 0.5) * TS, Y = (w.y + 0.5) * TS;
      if (w.seen && U.t - w.seen < 1.2 && !U.battle) { const b = Math.min(1, (U.t - w.seen) * 6); x.fillStyle = '#fff'; x.strokeStyle = '#222'; x.lineWidth = 1; x.beginPath(); x.roundRect(X - 4, Y - 24 - b * 3, 8, 10, 2); x.fill(); x.stroke(); x.fillStyle = '#e8453c'; x.fillRect(X - 0.75, Y - 22 - b * 3, 1.5, 4.5); x.fillRect(X - 0.75, Y - 16.5 - b * 3, 1.5, 1.5); }
      x.font = "600 5px 'Ziffern', sans-serif"; x.textAlign = 'center'; x.lineWidth = 2; x.strokeStyle = 'rgba(40,25,20,.85)';
      x.strokeText('Lv' + w.level, X, Y + 13); x.fillStyle = '#ffe0d0'; x.fillText('Lv' + w.level, X, Y + 13);
    }
  }
}

// ================= Kampf (rundenbasiert wie im klassischen Spiel) =================
function openBattle(w) {
  const foe = makeFighter({ dex: w.dex, ivs: [10, 10, 10, 10, 10, 10] }, w.level);
  loadSprites(w.dex);
  sfx.wave(false); haptic('strong');
  const scene = h('canvas.wb-scene');
  const box = (f, mine) => {
    const bar = h('div.wb-hp', h('i')), num = mine ? h('small.wb-num') : null;
    return { el: h('div.wb-box' + (mine ? '.me' : '.foe'), h('div.wb-name', h('b', f.nick || species(f.dex).name), h('small', 'Lv' + f.level)), h('div.wb-hpline', h('span', 'KP'), bar), num), bar: bar.firstChild, num };
  };
  const B = { w, foe, me: ui.me, fb: box(foe, false), mb: box(ui.me, true), scene, text: h('div.wb-text'), moves: h('div.wb-moves'), busy: false,
    shown: { p: ui.me.hp, w: foe.hp }, anim: { p: null, w: null }, hurt: { p: -9, w: -9 }, t0: performance.now() };
  B.el = h('div.wb', h('div.wb-stage', scene, B.fb.el, B.mb.el), B.text, B.moves);
  ui.root.append(B.el);
  ui.battle = B;
  say(`Ein wildes ${species(foe.dex).name} (Lv ${foe.level}) greift an! Jede Attacke kostet Münzen – reicht es nicht, rennt ${name(ui.p)} vor Angst nach Hause.`);
  renderMoves(); updateBars(true);
  const loop = () => { if (!ui || ui.battle !== B) return; drawScene(B); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
function say(text) { if (ui?.battle && text) ui.battle.text.textContent = text; }
function renderMoves() {
  const B = ui.battle;
  B.moves.replaceChildren(...B.me.moves.map((k, i) => {
    const mv = moveOf(k), c = moveCost(k);
    return h('button.wb-move', { style: { borderColor: typeColor(mv.type) }, disabled: B.busy, onclick: () => choose(i) },
      h('b', mv.name), h('small', h('i.tdot', { style: { background: typeColor(mv.type) } }), `${mv.type} · ${mv.cat === 'phys' ? 'phys.' : 'spez.'} · Stärke ${mv.power}`),
      h('span.wb-cost' + (app.state.coins < c ? '.poor' : ''), iconImg('coin', 2), String(c)));
  }), h('button.wb-flee', { disabled: B.busy, onclick: () => choose('flee') }, '🏃 Fliehen'));
}
function updateBars(instant = false) {
  const B = ui.battle;
  for (const [who, f, bx] of [['p', B.me, B.mb], ['w', B.foe, B.fb]]) {
    const k = Math.max(0, B.shown[who] / f.maxHp);
    bx.bar.style.transition = instant ? 'none' : 'width .45s ease';
    bx.bar.style.width = k * 100 + '%';
    bx.bar.style.background = k > 0.5 ? '#4cc764' : k > 0.2 ? '#f0c419' : '#e5533d';
    if (bx.num) bx.num.textContent = `${Math.ceil(B.shown[who])} / ${f.maxHp}`;
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function choose(choice) {
  const B = ui?.battle;
  if (!B || B.busy) return;
  if (choice !== 'flee') {
    // nicht bezahlbar: das Pokémon bekommt Angst und rennt nach Hause
    if (app.state.coins < moveCost(B.me.moves[choice])) { B.busy = true; renderMoves(); return endBattle('scared'); }
    const r = app.act((s) => payMove(s, B.me.moves[choice]), true);
    if (r.ok === false) return;
    sfx.coin();
  }
  B.busy = true; renderMoves();
  const steps = battleTurn(B.me, B.foe, choice, Math.random);
  for (const st of steps) {
    if (!ui || ui.battle !== B) return;
    if (st.key) { B.anim[st.who] = performance.now(); sfx.attack?.(); }
    if (st.hit) {
      await wait(250);
      B.shown[st.hit] = st.hp; B.hurt[st.hit] = performance.now(); updateBars();
      if (st.dmg) { st.eff > 1 ? sfx.crit() : sfx.hit(); haptic(st.hit === 'p' ? 'medium' : 'tick'); }
    }
    if (st.text) say(st.text);
    if (st.faint) sfx.ko();
    await wait(st.text ? 850 : 300);
    if (st.fled) { endBattle('fled'); return; }
  }
  if (B.foe.hp <= 0) return endBattle('won');
  if (B.me.hp <= 0) return endBattle('lost');
  B.busy = false; renderMoves(); say(`Was soll ${name(ui.p)} tun?`);
  if (B.me.moves.every((k) => moveCost(k) > app.state.coins)) say(`Achtung: Du kannst dir keine Attacke mehr leisten – ${name(ui.p)} bekommt Angst, wenn du angreifst. Flieh lieber!`);
}
async function endBattle(result) {
  const B = ui.battle;
  if (result === 'won') {
    const r = app.act((s) => walkWin(s, ui.p.uid, B.foe), true);
    ui.wins++; ui.ep += r.ep; r.gained.forEach((v, i) => (ui.evs[i] += v));
    B.w.gone = true; sfx.win();
    const evTxt = r.gained.map((v, i) => (v ? `${['KP', 'Ang', 'Vert', 'SpAng', 'SpVert', 'Init'][i]} +${v}` : null)).filter(Boolean).join(', ');
    say(`Gewonnen! +${r.ep} EP${evTxt ? ' · EV: ' + evTxt : ''}`);
  } else if (result === 'fled') { B.w.ignore = ui.t + WK().wild.fleeIgnore; }
  else if (result === 'scared') { say(`Zu wenig Münzen! ${name(ui.p)} bekommt Angst und rennt nach Hause …`); sfx.lose(); haptic('strong'); ui.scared = true; }
  else { say(`${name(ui.p)} ist erschöpft …`); sfx.lose(); }
  await wait(result === 'fled' ? 500 : 1600);
  if (!ui) return;
  B.el.remove(); ui.battle = null;
  if (result === 'lost' || result === 'scared') finish(false);
}
// Kampfszene: Wiese, Plattformen, Gegner oben rechts (frontal), eigenes Pokémon unten links (Rücken)
function drawScene(B) {
  const c = B.scene, r = c.getBoundingClientRect(), dpr = ui.dpr;
  if (!r.width) return;
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const x = c.getContext('2d'), W = r.width, H = r.height, t = performance.now();
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.imageSmoothingEnabled = false;
  const pal = { schnee: ['#dfeefa', '#f4f8fb', '#cfe0ea', '#b9d2e2', '#e4eff6'], strand: ['#bfe6f7', '#f2ecd0', '#e6d6a0', '#d8c482', '#efe2b4'], herbst: ['#f3dcc0', '#f2ead0', '#c9c27a', '#b0a45c', '#d4cc8c'], nacht: ['#3a3f6a', '#5a6a5a', '#4a6a42', '#3c5a36', '#5a7a4c'], kirsch: ['#fbe0ec', '#f2f6dc', '#a9d98a', '#7fbf5f', '#9ad47a'] }[ui.map.theme] || ['#cfeaf7', '#e9f6d8', '#a9d98a', '#7fbf5f', '#9ad47a'];
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, pal[0]); g.addColorStop(0.45, pal[1]); g.addColorStop(1, pal[2]);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const plat = (cx, cy, rw) => { x.fillStyle = pal[3]; x.beginPath(); x.ellipse(cx, cy, rw, rw * 0.28, 0, 0, 7); x.fill(); x.fillStyle = pal[4]; x.beginPath(); x.ellipse(cx, cy - 3, rw * 0.9, rw * 0.22, 0, 0, 7); x.fill(); };
  plat(W * 0.72, H * 0.42, W * 0.2); plat(W * 0.28, H * 0.86, W * 0.24);
  const mon = (f, who, cx, cy, dir, size) => {
    const e = loadSprites(f.dex, f.gender);
    if (!e.ready) return;
    const at = B.anim[who], hurt = t - B.hurt[who];
    if (f.hp <= 0 && B.shown[who] <= 0 && hurt > 600) return; // besiegt: verschwindet
    let anim = 'Idle', ms = t, once = false, dx = 0;
    if (at && t - at < 600) { anim = e.anims.Attack ? 'Attack' : 'Idle'; ms = t - at; once = true; dx = (who === 'p' ? 1 : -1) * Math.sin(Math.min(1, (t - at) / 300) * Math.PI) * W * 0.06; }
    else if (hurt < 400 && e.anims.Hurt) { anim = 'Hurt'; ms = hurt; once = true; }
    const fr = frameOf(e, anim, dir, ms, once), s = Math.max(1, Math.round((size / e.anims.Idle.fh) * dpr)) / dpr;
    if (hurt < 400 && Math.floor(hurt / 70) % 2) return; // blinken bei Treffer
    x.drawImage(fr.img, fr.sx, fr.sy, fr.fw, fr.fh, Math.round(cx + dx - (fr.fw * s) / 2), Math.round(cy - (fr.fh * s) * 0.62), Math.round(fr.fw * s), Math.round(fr.fh * s));
  };
  mon(B.foe, 'w', W * 0.72, H * 0.42, 0, H * 0.42);
  mon(B.me, 'p', W * 0.28, H * 0.86, 4, H * 0.5);
}

// ================= Ende =================
function finish(home) {
  if (ui.over) return;
  ui.over = true;
  const steps = Math.floor(ui.s), p = ui.p;
  const r = app.act((s, t) => walkDone(s, p.uid, steps, home, t), true);
  if (home) sfx.win();
  const evTxt = ui.evs.map((v, i) => (v ? `${['KP', 'Ang', 'Vert', 'SpAng', 'SpVert', 'Init'][i]} +${v}` : null)).filter(Boolean).join(', ');
  setTimeout(() => modal((m, close) => {
    m.append(h('h3', home ? '🏠 Wieder zu Hause!' : ui.scared ? '😱 Vor Angst nach Hause gerannt' : '😵 Spaziergang abgebrochen'),
      h('p', home ? `${name(p)} ist ${steps} Schritte gelaufen.` : ui.scared ? `Du konntest die Attacke nicht bezahlen – ${name(p)} hat Angst bekommen und ist nach ${steps} Schritten nach Hause gerannt. Spaziergang nicht geschafft.` : `${name(p)} musste nach ${steps} Schritten nach Hause.`),
      h('div.rk-rewards', h('div', `⚔ ${ui.wins} ${ui.wins === 1 ? 'Sieg' : 'Siege'}`), h('div', `+${ui.ep + r.ep} EP${r.ep ? ` (davon ${r.ep} fürs Heimkommen)` : ''}`), evTxt ? h('div', `EV: ${evTxt}`) : null),
      h('div.row', h('button.btn.primary.big', { onclick: () => { close(); closeWalk(); renderWalkSetup(setupEl, setupBack); } }, 'Fertig')));
    $('#modal').onclick = null;
  }), 400);
}
async function leave() {
  if (!ui) return;
  if (ui.phase === 'plan') { closeWalk(); renderWalkSetup(setupEl, setupBack); return; }
  if (ui.over || ui.battle) return;
  const wasT = ui.over; ui.over = true; // anhalten, solange gefragt wird
  const yes = await confirmDialog('Spaziergang abbrechen? Er zählt dann für heute (ohne Heimkehr-EP).', 'Abbrechen');
  if (!ui) return;
  ui.over = wasT;
  if (yes) finish(false);
}
