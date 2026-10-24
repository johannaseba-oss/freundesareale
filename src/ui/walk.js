// Spaziergang-Oberfläche: Pokémon wählen, Route auf der Karte zeichnen, losgehen – wilde Pokémon meiden oder bekämpfen.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { canBattle, moveOf } from '../game/battle.js';
import { speedOf, physBuff } from '../game/rocks.js';
import { makeMap, walkable, spawnWild, moveWild, maxSteps, walkSpeed, walkedToday, makeFighter, battleTurn, moveCost, walkWin, walkDone, payMove } from '../game/walk.js';
import { expectedEdges, pickTile } from './route.js';
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
    h('p.note', 'Zeichne auf der Karte eine Runde vom 🏠 aus und wieder zurück. Ausdauer = wie weit, Tempo = wie schnell. Wilde Pokémon laufen umher – weiche ihnen aus oder kämpfe. Im Kampf kostet jede Attacke Münzen!'),
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
function startWalk(p) {
  closeWalk();
  const rnd = Math.random, map = makeMap(rnd);
  const canvas = h('canvas.arena-canvas');
  const steps = h('span.wk-steps'), coins = h('span.wk-coins');
  const undo = h('button.btn', { onclick: () => { if (ui.phase === 'plan' && ui.route.length > 1) { ui.route.pop(); haptic('tick'); } } }, '↶');
  const clear = h('button.btn', { onclick: () => { if (ui.phase === 'plan') { ui.route = []; haptic('tick'); } } }, 'Löschen');
  const go = h('button.btn.primary.big', { onclick: startWalking }, 'Los!');
  const bar = h('div.wk-bar', undo, clear, go);
  const hint = h('div.wk-hint', 'Zeichne vom 🏠 aus eine Runde und komm wieder zurück.');
  const top = h('div.b-top', h('img.rk-top-por', { src: portraitUrl(p.dex), alt: '' }),
    h('div.b-name', h('b', name(p)), h('small', `Lv ${p.level} · Ausdauer ${p.stamina || 1} · Tempo ${speedOf(p).level}`)),
    steps, coins, h('button.b-btn', { onclick: leave, title: 'Beenden' }, '✕'));
  const root = h('div.battle.walk', top, h('div.b-field', canvas, hint), bar);
  document.body.append(root);
  document.body.classList.add('in-battle');
  setMusic('menu');
  const me = makeFighter({ ...p, pbuff: physBuff(app.state, { uid: p.uid, dex: p.dex }, now()) }, p.level);
  ui = { p, me, map, rnd, root, canvas, ctx: canvas.getContext('2d'), steps, coins, go, bar, hint, phase: 'plan', route: [], drawing: false,
    wild: spawnWild(map, rnd, p.level), t: 0, s: 0, wins: 0, ep: 0, evs: [0, 0, 0, 0, 0, 0], last: performance.now(), raf: 0, max: maxSteps(p), speed: walkSpeed(p) };
  loadSprites(p.dex, p.gender); for (const w of ui.wild) loadSprites(w.dex);
  const ti = new Image(); ti.src = `${base}art/route/${map.theme}.png`; ti.onload = () => { if (ui) ui.bg = null; }; ui.tiles = ti;
  ui.ro = new ResizeObserver(layout); ui.ro.observe(canvas.parentElement);
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
  const { canvas, map } = ui, r = canvas.parentElement.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  const fit = Math.min(r.width / map.cols, r.height / map.rows);
  const m = Math.floor((fit * dpr) / 24), tile = m >= 1 ? (24 * m) / dpr : fit;
  const snap = (v) => Math.round(v * dpr) / dpr;
  Object.assign(ui, { dpr, w: r.width, h: r.height, tile, ox: snap((r.width - tile * map.cols) / 2), oy: snap((r.height - tile * map.rows) / 2), bg: null });
}
const cellAt = (e) => { const r = ui.canvas.getBoundingClientRect(); return [Math.floor((e.clientX - r.left - ui.ox) / ui.tile), Math.floor((e.clientY - r.top - ui.oy) / ui.tile)]; };
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

// ---- Route zeichnen ----
function onDown(e) {
  if (ui.phase !== 'plan') return;
  const c = cellAt(e), R = ui.route, last = R[R.length - 1];
  if (!R.length) { if (same(c, ui.map.home)) { R.push(c); ui.drawing = true; haptic('tick'); } else toast('Fang beim 🏠 an.'); return; }
  if (same(c, last)) { ui.drawing = true; return; }
  if (Math.abs(c[0] - last[0]) + Math.abs(c[1] - last[1]) === 1) { ui.drawing = true; extend(c); return; }
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
const complete = () => ui.route.length > 2 && same(ui.route[ui.route.length - 1], ui.map.home);

function startWalking() {
  if (!ui || ui.phase !== 'plan') return;
  if (!complete()) { toast('Die Route muss wieder am 🏠 enden.'); return; }
  ui.phase = 'walk'; ui.s = 0; ui.drawing = false;
  ui.bar.classList.add('hidden'); ui.hint.textContent = 'Unterwegs … Begegnungen führen zum Kampf!';
  setTimeout(() => ui?.hint.classList.add('hidden'), 2500);
  haptic('medium');
}
// Position auf der Route (Felder, s = zurückgelegte Schritte)
function posAt(s) {
  const R = ui.route, i = Math.min(R.length - 2, Math.floor(s)), k = Math.min(1, s - i);
  const a = R[i], b = R[i + 1] || a;
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
      const hit = ui.wild.find((w) => !w.gone && w.ignore < ui.t && Math.hypot(w.x - me.x, w.y - me.y) < 0.7);
      if (hit) openBattle(hit);
      else if (ui.s >= ui.route.length - 1) finish(true);
    }
  }
  const used = Math.max(0, ui.route.length - 1);
  ui.steps.textContent = ui.phase === 'plan' ? `👣 ${used}/${ui.max}` : `👣 ${Math.floor(ui.s)}/${used}`;
  ui.coins.replaceChildren(iconImg('coin', 2), ` ${app.state.coins}`);
  if (ui.phase === 'plan') { ui.go.disabled = !complete(); }
  draw();
}

// Hintergrund aus den Route-Tilesets (Autotiles), ganzzahlig vergrößert
function buildBackground() {
  const U = ui, S = 24, tiles = CFG.routeTiles.themes[U.map.theme].tiles, M = U.map;
  const c = document.createElement('canvas'); c.width = Math.round(U.w * U.dpr); c.height = Math.round(U.h * U.dpr);
  const Dp = Math.round(U.tile * U.dpr), ox = Math.round(U.ox * U.dpr), oy = Math.round(U.oy * U.dpr);
  const c0 = Math.floor(-ox / Dp) - 1, r0 = Math.floor(-oy / Dp) - 1, c1 = Math.ceil((c.width - ox) / Dp), r1 = Math.ceil((c.height - oy) / Dp);
  const lo = document.createElement('canvas'); lo.width = (c1 - c0 + 1) * S; lo.height = (r1 - r0 + 1) * S;
  const x = lo.getContext('2d'); x.imageSmoothingEnabled = false;
  const tAt = (cx, cy) => M.g[cy]?.[cx] || 'W';
  for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) {
    const hsh = ((col * 73856093) ^ (r * 19349663)) >>> 0;
    const k = pickTile(tiles, tAt(col, r), expectedEdges(tAt, col, r), hsh) || pickTile(tiles, 'F', 'FFFFFFFF', hsh);
    if (k) x.drawImage(U.tiles, k.c * S, k.r * S, S, S, (col - c0) * S, (r - r0) * S, S, S);
  }
  const out = c.getContext('2d'); out.imageSmoothingEnabled = false;
  out.drawImage(lo, 0, 0, lo.width, lo.height, ox + c0 * Dp, oy + r0 * Dp, lo.width * (Dp / S), lo.height * (Dp / S));
  return c;
}
function drawMon(x, dex, gender, X, Y, dir, anim, ms) {
  const e = loadSprites(dex, gender);
  if (!e.ready) return;
  const T = ui.tile, f = frameOf(e, anim, dir, ms);
  let s = T / 17; if (e.anims.Idle.fh * s > T * 2.2) s = (T * 2.2) / e.anims.Idle.fh;
  x.fillStyle = 'rgba(30,40,20,.3)'; x.beginPath(); x.ellipse(X, Y + T * 0.25, T * 0.3, T * 0.1, 0, 0, 7); x.fill();
  x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(X - (f.fw * s) / 2), Math.round(Y - T * 0.05 - (f.fh * s) / 2), Math.round(f.fw * s), Math.round(f.fh * s));
}
function draw() {
  const U = ui, x = U.ctx, T = U.tile, t = performance.now();
  x.setTransform(U.dpr, 0, 0, U.dpr, 0, 0); x.imageSmoothingEnabled = false;
  if (!U.bg && U.tiles.complete && U.tiles.naturalWidth) U.bg = buildBackground();
  x.fillStyle = '#4b6a3c'; x.fillRect(0, 0, U.w, U.h);
  if (U.bg) x.drawImage(U.bg, 0, 0, U.w, U.h);
  const C = (cx, cy) => [U.ox + (cx + 0.5) * T, U.oy + (cy + 0.5) * T];
  // Route: breite helle Linie mit Fußspuren; fertig = grün
  const R = U.route;
  if (R.length) {
    const ok = complete();
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.strokeStyle = 'rgba(40,30,20,.35)'; x.lineWidth = T * 0.42;
    x.beginPath(); R.forEach((c, i) => { const [a, b] = C(c[0], c[1]); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke();
    x.strokeStyle = ok ? 'rgba(140,235,140,.85)' : 'rgba(255,248,220,.85)'; x.lineWidth = T * 0.28; x.stroke();
    // bereits gelaufener Teil dunkler
    if (U.phase === 'walk' && U.s > 0) {
      const me = posAt(U.s);
      x.strokeStyle = 'rgba(120,90,50,.8)'; x.lineWidth = T * 0.18; x.beginPath();
      for (let i = 0; i <= Math.floor(U.s); i++) { const [a, b] = C(R[i][0], R[i][1]); i ? x.lineTo(a, b) : x.moveTo(a, b); }
      const [a, b] = C(me.x, me.y); x.lineTo(a, b); x.stroke();
    }
    // Endpunkt beim Zeichnen
    if (U.phase === 'plan') { const l = R[R.length - 1], [a, b] = C(l[0], l[1]); x.fillStyle = '#fff'; x.beginPath(); x.arc(a, b, T * 0.18 + Math.sin(t / 150) * 2, 0, 7); x.fill(); }
  }
  // Zuhause
  { const [a, b] = C(U.map.home[0], U.map.home[1]); x.font = `${Math.round(T * 0.9)}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🏠', a, b); x.textBaseline = 'alphabetic'; }
  // wilde Pokémon (nach Höhe sortiert)
  const list = U.wild.filter((w) => !w.gone).map((w) => ({ w, y: w.y }));
  if (U.phase === 'walk' || R.length) list.push({ me: true, y: U.phase === 'walk' ? posAt(U.s).y : U.map.home[1] });
  list.sort((a, b) => a.y - b.y);
  for (const o of list) {
    if (o.me) {
      const p = U.phase === 'walk' ? posAt(U.s) : { x: U.map.home[0], y: U.map.home[1] - 0.6, dir: 4 };
      const [a, b] = C(p.x, p.y);
      drawMon(x, U.p.dex, U.p.gender, a, b, p.dir, U.phase === 'walk' && !U.battle ? 'Walk' : 'Idle', t);
    } else {
      const w = o.w, [a, b] = C(w.x, w.y);
      if (w.ignore > U.t) x.globalAlpha = 0.5;
      drawMon(x, w.dex, null, a, b, w.dir, w.k < 1 ? 'Walk' : 'Idle', t);
      x.globalAlpha = 1;
      x.font = `700 ${Math.round(T * 0.26)}px system-ui, sans-serif`; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = 'rgba(40,25,20,.9)';
      x.strokeText('Lv' + w.level, a, b + T * 0.75); x.fillStyle = '#ffd0c0'; x.fillText('Lv' + w.level, a, b + T * 0.75);
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
  ui.root.querySelector('.b-field').append(B.el);
  ui.battle = B;
  say(`Ein wildes ${species(foe.dex).name} (Lv ${foe.level}) greift an!`);
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
      h('span.wb-cost', iconImg('coin', 2), String(c)));
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
  else { say(`${name(ui.p)} ist erschöpft …`); sfx.lose(); }
  await wait(result === 'fled' ? 500 : 1600);
  if (!ui) return;
  B.el.remove(); ui.battle = null;
  if (result === 'lost') finish(false);
}
// Kampfszene: Wiese, Plattformen, Gegner oben rechts (frontal), eigenes Pokémon unten links (Rücken)
function drawScene(B) {
  const c = B.scene, r = c.getBoundingClientRect(), dpr = ui.dpr;
  if (!r.width) return;
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const x = c.getContext('2d'), W = r.width, H = r.height, t = performance.now();
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.imageSmoothingEnabled = false;
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#cfeaf7'); g.addColorStop(0.45, '#e9f6d8'); g.addColorStop(1, '#a9d98a');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const plat = (cx, cy, rw) => { x.fillStyle = '#7fbf5f'; x.beginPath(); x.ellipse(cx, cy, rw, rw * 0.28, 0, 0, 7); x.fill(); x.fillStyle = '#9ad47a'; x.beginPath(); x.ellipse(cx, cy - 3, rw * 0.9, rw * 0.22, 0, 0, 7); x.fill(); };
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
    m.append(h('h3', home ? '🏠 Wieder zu Hause!' : '😵 Spaziergang abgebrochen'),
      h('p', home ? `${name(p)} ist ${steps} Schritte gelaufen.` : `${name(p)} musste nach ${steps} Schritten nach Hause.`),
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
