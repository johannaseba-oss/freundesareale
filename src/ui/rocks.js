// Felsbrecher-Oberfläche: Pokémon wählen (Kraft/Tempo), Item-Shop und das Minispiel im Vollbild.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { canBattle } from '../game/battle.js';
import { RockRun, powerOf, speedOf, tapsFor, gapFor, shopItems, itemRoom, buyItem, rockReward, trainedToday, physBuff, buffPct, trainEp } from '../game/rocks.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { iconImg } from '../gfx/icons.js';
import { $, h, toast, modal, confirmDialog } from './dom.js';
import { sfx, setMusic } from '../audio.js';
import { haptic } from '../haptics.js';
import { dayKey, now } from '../time.js';

const R = () => CFG.rocks;
let run = null, ui = null, mon = null, setupEl = null, setupBack = null;

const dots = (n) => '●'.repeat(n) + '○'.repeat(5 - n);
const name = (p) => p.nick || species(p.dex).name;
function statLine(label, r) {
  return h('div.rk-stat', h('span.k', label), h('span.rk-dots', dots(r.level)), h('div.bar.rk', h('i', { style: { width: (r.level >= 5 ? 100 : r.next * 100) + '%' } })));
}

// ================= Auswahl =================
export function renderRocksSetup(el, back) {
  setupEl = el; setupBack = back;
  const mons = (app.state.pokemon || []).filter((p) => canBattle(p.dex))
    .map((p) => ({ p, pw: powerOf(p), sp: speedOf(p) }))
    .sort((a, b) => b.pw.level + b.sp.level - (a.pw.level + a.sp.level) || b.pw.value + b.sp.value - (a.pw.value + a.sp.value));
  const st = app.state.rocks || {}, today = st.day === dayKey(now()) ? st.coinsToday || 0 : 0;
  const best = st.best ? app.state.pokemon.find((p) => p.uid === st.bestUid) : null;
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: back }, '‹ Zurück'),
    h('div.bs-head', h('h2', '⛏ Felsbrecher'), h('button.btn.small.gold', { onclick: () => openItemShop() }, '🛒 Shop')),
    h('p.note', `Felsen rollen herunter – tippe sie kaputt, bevor sie unten ankommen! Kraft = Tipper je Fels (Kraft 1: ${tapsFor(1)}×, Kraft 5: ${tapsFor(5)}×), Tempo = wie schnell du hintereinander tippen darfst. Lange Felsen gedrückt halten, Bomben antippen bremst das Tempo.`),
    h('p.note', `Training: jedes Pokémon 1× pro Tag. Danach gibt es EP und einen Angriffs-Buff für physische Treffer in allen Kampfmodi (bis +${R().training.buffMaxPct} %).`),
    h('div.rk-info', h('span', `Rekord: ${st.best || 0} Felsen`, best ? ` (${name(best)})` : ''), h('span', iconImg('coin', 2), ` heute ${today}/${R().dailyCoinCap}`)),
    mons.length ? h('div.bs-list', mons.map(({ p, pw, sp }) => {
      const done = trainedToday(app.state, p.uid, now()), b = physBuff(app.state, { uid: p.uid, dex: p.dex }, now());
      return h('button.bs-row.rk-row' + (done ? '.done' : ''), { onclick: () => (done ? toast(`${name(p)} hat heute schon trainiert – morgen wieder.`) : startRun(p)) },
        h('img.rk-por', { src: portraitUrl(p.dex), alt: '' }),
        h('div.bs-row-text', h('b', name(p), b > 1 ? h('span.rk-buff', `💪 +${Math.round((b - 1) * 100)} %`) : null, done ? h('span.rk-done', '✓ heute trainiert') : null), statLine('Kraft', pw), statLine('Tempo', sp)),
        h('span.bs-go', done ? '' : '›'));
    })) : h('p.note.warn', 'Du brauchst Pokémon – zieh welche am Automaten!')));
}

// ================= Item-Shop =================
export function openItemShop(onClose = null) {
  let item = shopItems()[0];
  modal((m, close) => {
    const body = h('div');
    const render = () => {
      const mons = (app.state.pokemon || []).filter((p) => canBattle(p.dex))
        .sort((a, b) => (item.stat === R().power.stat ? powerOf(b).value - powerOf(a).value : speedOf(b).value - speedOf(a).value));
      body.replaceChildren(
        h('div.rk-tabs', shopItems().map((it) => h('button.btn.small' + (it === item ? '.primary' : ''), { onclick: () => { item = it; render(); } }, `${it.icon} ${it.name}`))),
        h('p.note', item.desc, ' ', `+${item.ev} Fleißpunkte (EV) – gilt dauerhaft und auch im Kampf. Mit Items bis ${R().shop.vitaminCap} EV je Wert.`),
        h('p.note', 'Du hast ', iconImg('coin', 2), ` ${app.state.coins}.`),
        h('div.inv.rk-shop', mons.map((p) => {
          const r = item.stat === R().power.stat ? powerOf(p) : speedOf(p), room = itemRoom(p, item);
          return h('div.stone-row',
            h('img', { src: portraitUrl(p.dex), alt: '' }),
            h('div.rk-shop-text', h('b', name(p)), statLine(item.stat === R().power.stat ? 'Kraft' : 'Tempo', r), h('small', `EV ${p.evs?.[item.stat] || 0}`)),
            h('button.btn.gold.small', {
              disabled: !room || app.state.coins < item.price,
              onclick: () => {
                const res = app.act((s) => buyItem(s, p.uid, item.id), true);
                if (res.ok === false) return;
                sfx.coin(); haptic('medium');
                const after = item.stat === R().power.stat ? powerOf(p) : speedOf(p);
                toast(after.level > r.level ? `${name(p)}: ${item.stat === R().power.stat ? 'Kraft' : 'Tempo'} ${after.level}!` : `${name(p)} hat ${item.name} bekommen (+${res.add} EV).`);
                render();
              },
            }, room ? [iconImg('coin', 2), String(item.price)] : 'max'));
        })));
    };
    render();
    m.append(h('div.row', h('h3', { style: { margin: 0, flex: 1 } }, '🛒 Item-Shop'), h('button.btn.small', { onclick: () => import('./slots.js').then((x) => x.openBag()), style: { flex: 'none' } }, '🎒 Steine'), h('button.btn.small', { onclick: () => { close(); onClose?.(); if (setupEl?.isConnected && !ui) renderRocksSetup(setupEl, setupBack); }, style: { flex: 'none' } }, '✕')), body);
  });
}

// ================= Spiel =================
function startRun(p) {
  mon = p;
  run = new RockRun(p);
  const canvas = h('canvas.arena-canvas');
  const score = h('span.rk-score'), lives = h('span.rk-lives');
  const top = h('div.b-top', h('img.rk-top-por', { src: portraitUrl(p.dex), alt: '' }),
    h('div.b-name', h('b', name(p)), h('small', `Kraft ${run.power} · ${run.taps}× tippen · Tempo ${run.speed}`)),
    score, lives,
    h('button.b-btn', { onclick: pauseMenu, title: 'Pause' }, '⏸'),
    h('button.b-btn', { onclick: giveUp, title: 'Aufgeben' }, '🏳'));
  const root = h('div.battle.rocks', top, h('div.b-field', canvas));
  document.body.append(root);
  document.body.classList.add('in-battle');
  setMusic('arena');
  ui = { root, canvas, ctx: canvas.getContext('2d'), score, lives, shards: [], dust: [], texts: [], shapes: new Map(), shake: 0, last: performance.now(), raf: 0, atkT: -9, paused: false, wiggle: new Map(), holds: new Map(), grindT: 0, booms: [], spr: loadSprites(p.dex, p.gender) };
  ui.ro = new ResizeObserver(layout); ui.ro.observe(canvas.parentElement);
  canvas.addEventListener('pointerdown', onTap);
  const letGo = (e) => { const row = ui?.holds.get(e.pointerId); if (row) { run?.release(row); ui.holds.delete(e.pointerId); } };
  canvas.addEventListener('pointerup', letGo); canvas.addEventListener('pointercancel', letGo); canvas.addEventListener('lostpointercapture', letGo);
  layout();
  const loop = (t) => {
    if (!ui) return;
    const dt = Math.min(0.05, (t - ui.last) / 1000); ui.last = t;
    frame(dt);
    ui.raf = requestAnimationFrame(loop);
  };
  ui.raf = requestAnimationFrame(loop);
  if (import.meta.env.DEV) app.rocks = { get run() { return run; }, get ui() { return ui; }, step: (dt) => frame(dt) };
}
function closeRun() {
  if (!ui) return;
  cancelAnimationFrame(ui.raf); ui.ro.disconnect(); ui.root.remove();
  document.body.classList.remove('in-battle');
  ui = null; run = null;
  setMusic('menu');
}
function layout() {
  const { canvas } = ui, r = canvas.parentElement.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  // Pokémon-Leiste unten, darüber das Band; Spalten möglichst breit, aber nicht breiter als hoch
  const foot = Math.min(110, r.height * 0.16), fh = r.height - foot;
  const rowH = fh / R().rowsVisible, laneW = Math.min(r.width / R().lanes, rowH * 1.25);
  Object.assign(ui, { dpr, w: r.width, h: r.height, foot, fh, rowH, laneW, ox: (r.width - laneW * R().lanes) / 2 });
}
const screenOf = (row, y = row.kind === 'hold' ? run.bottomOf(row) + 0.35 : run.yOf(row) + 0.5) => ({ x: ui.ox + (row.lane + 0.5) * ui.laneW, y: ui.fh - y * ui.rowH });

function onTap(e) {
  if (!run || run.over || ui.paused) return;
  const r = ui.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const lane = Math.floor((x - ui.ox) / ui.laneW);
  if (lane < 0 || lane >= R().lanes || y > ui.fh) return;
  const r2 = run.tap(lane, (ui.fh - y) / ui.rowH);
  if (r2?.res === 'hold') { ui.holds.set(e.pointerId, r2.row); try { ui.canvas.setPointerCapture(e.pointerId); } catch {} }
  handleEvents();
}

function frame(dt) {
  if (!ui || !run) return;
  if (!ui.paused) run.update(dt);
  handleEvents();
  draw(dt);
  ui.score.textContent = `⛏ ${run.smashed}`;
  ui.lives.textContent = '♥'.repeat(Math.max(0, run.lives)) + '♡'.repeat(Math.max(0, R().lives - run.lives));
  if (run.over && !ui.ended) end();
}

// Felsform je Reihe: unregelmäßiges Vieleck mit festen Risslinien
function shapeOf(row) {
  let s = ui.shapes.get(row);
  if (!s) {
    const n = 9, pts = [], cracks = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.random() * 0.3; const k = 0.78 + Math.random() * 0.22; pts.push([Math.cos(a) * k, Math.sin(a) * k * 0.86]); }
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, seg = [[(Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2]];
      for (let j = 1; j <= 3; j++) seg.push([Math.cos(a + (Math.random() - 0.5) * 0.7) * j * 0.26, Math.sin(a + (Math.random() - 0.5) * 0.7) * j * 0.22]);
      cracks.push(seg);
    }
    s = { pts, cracks, hue: 22 + Math.random() * 14, light: 40 + Math.random() * 8 };
    ui.shapes.set(row, s);
  }
  return s;
}

function handleEvents() {
  for (const ev of run.events) {
    if (ev.type === 'hit' || ev.type === 'smash') {
      const o = screenOf(ev.row), s = shapeOf(ev.row), big = ev.type === 'smash';
      shards(o, s, big ? 22 : 6, big ? 1.4 : 0.7);
      ui.atkT = run.t; ui.atkLane = ev.row.lane;
      if (big) { ui.shake = Math.max(ui.shake, 7); sfx.ko(); haptic('medium'); dust(o, 10); ui.shapes.delete(ev.row); text(o, '+1', '#ffe066'); for (const [id, r] of ui.holds) if (r === ev.row) ui.holds.delete(id); }
      else { ui.shake = Math.max(ui.shake, 2.5); sfx.hit(); haptic('tick'); ui.wiggle.set(ev.row, run.t); }
    } else if (ev.type === 'bomb') {
      const o = screenOf(ev.row);
      ui.booms.push({ x: o.x, y: o.y, t: 0 }); ui.shake = Math.max(ui.shake, 14); ui.flash2 = 0.25;
      shards(o, { hue: 20, light: 18 }, 16, 1.6); dust(o, 16); sfx.explosion(); haptic('strong');
      text(o, 'LANGSAMER!', '#8fd3ff', 1.1); ui.atkT = run.t; ui.atkLane = ev.row.lane;
    } else if (ev.type === 'grab') { ui.atkT = run.t; ui.atkLane = ev.row.lane; haptic('tick'); }
    else if (ev.type === 'tooFast') { ui.wiggle.set(ev.row, run.t); text(screenOf(ev.row), 'zu schnell', '#cfd6e0', 0.7); }
    else if (ev.type === 'miss') { ui.shake = 10; sfx.bite(); haptic('strong'); ui.flash = 0.35; }
  }
  run.events.length = 0;
}
function shards(o, s, n, power) {
  const L = ui.laneW * 0.36;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (60 + Math.random() * 220) * power;
    ui.shards.push({ x: o.x + Math.cos(a) * L * 0.4, y: o.y + Math.sin(a) * L * 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120 * power, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, size: (3 + Math.random() * 7) * (ui.laneW / 90) * (0.8 + power * 0.3), life: 0.7 + Math.random() * 0.5, t: 0, col: `hsl(${s.hue}, 22%, ${s.light - 10 + Math.random() * 25}%)` });
  }
}
function dust(o, n) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2; ui.dust.push({ x: o.x, y: o.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 40 - 20, r: ui.laneW * (0.12 + Math.random() * 0.12), t: 0, life: 0.6 + Math.random() * 0.4 }); } }
function text(o, s, col, life = 0.8) { ui.texts.push({ x: o.x, y: o.y, s, col, t: 0, life }); }

function draw(dt) {
  const x = ui.ctx, { dpr, w, h: H, fh, rowH, laneW, ox } = ui, L = R().lanes;
  ui.shake *= Math.pow(0.0005, dt);
  const sx = (Math.random() - 0.5) * ui.shake, sy = (Math.random() - 0.5) * ui.shake;
  x.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
  // Untergrund: Erde mit Spalten
  x.fillStyle = '#4a3b2c'; x.fillRect(-20, -20, w + 40, H + 40);
  for (let i = 0; i < L; i++) { x.fillStyle = i % 2 ? '#5a4836' : '#54432f'; x.fillRect(ox + i * laneW, 0, laneW, fh); }
  // Bodenstreifen, die mitlaufen (Bewegungsgefühl)
  x.fillStyle = 'rgba(0,0,0,.12)';
  const off = ((run.pos % 1) + 1) % 1;
  for (let k = -1; k <= R().rowsVisible; k++) { const y = fh - (k - off) * rowH; x.fillRect(ox, y - 1, laneW * L, 2); }
  x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2;
  for (let i = 1; i < L; i++) { x.beginPath(); x.moveTo(ox + i * laneW, 0); x.lineTo(ox + i * laneW, fh); x.stroke(); }
  // Felsen
  for (const row of run.rows) {
    if (row.dead) continue;
    if (row.kind === 'hold') { drawHold(x, row, dt); continue; }
    if (row.kind === 'bomb') { drawBomb(x, row); continue; }
    const o = screenOf(row), s = shapeOf(row), R0 = Math.min(laneW, rowH) * 0.44;
    const wg = ui.wiggle.get(row), wt = wg != null ? run.t - wg : 9, wob = wt < 0.18 ? Math.sin(wt * 70) * 3 * (1 - wt / 0.18) : 0;
    x.save(); x.translate(o.x + wob, o.y);
    x.fillStyle = 'rgba(0,0,0,.28)'; x.beginPath(); x.ellipse(0, R0 * 0.72, R0 * 0.9, R0 * 0.22, 0, 0, Math.PI * 2); x.fill();
    const path = () => { x.beginPath(); s.pts.forEach(([a, b], i) => (i ? x.lineTo(a * R0, b * R0) : x.moveTo(a * R0, b * R0))); x.closePath(); };
    const g = x.createLinearGradient(-R0, -R0, R0, R0);
    g.addColorStop(0, `hsl(${s.hue}, 18%, ${s.light + 22}%)`); g.addColorStop(0.55, `hsl(${s.hue}, 16%, ${s.light}%)`); g.addColorStop(1, `hsl(${s.hue}, 18%, ${s.light - 16}%)`);
    path(); x.fillStyle = g; x.fill();
    x.lineWidth = Math.max(2, R0 * 0.07); x.strokeStyle = `hsl(${s.hue}, 25%, 16%)`; x.stroke();
    // Glanz
    x.fillStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.ellipse(-R0 * 0.3, -R0 * 0.35, R0 * 0.28, R0 * 0.14, -0.5, 0, Math.PI * 2); x.fill();
    // Risse je nach erlittenen Treffern
    const dmg = 1 - row.hp / run.taps, nc = Math.ceil(dmg * s.cracks.length);
    x.strokeStyle = 'rgba(25,15,8,.85)'; x.lineWidth = Math.max(1.5, R0 * 0.05); x.lineJoin = 'round';
    for (let i = 0; i < nc; i++) { const c = s.cracks[i]; x.beginPath(); c.forEach(([a, b], j) => (j ? x.lineTo(a * R0, b * R0) : x.moveTo(a * R0, b * R0))); x.stroke(); }
    // verbleibende Tipper als kleine Punkte
    if (run.taps > 1) { x.fillStyle = '#fff'; for (let i = 0; i < row.hp; i++) { x.beginPath(); x.arc((i - (row.hp - 1) / 2) * R0 * 0.24, R0 * 0.55, R0 * 0.07, 0, Math.PI * 2); x.fill(); } }
    x.restore();
  }
  // Splitter & Staub
  for (const d of ui.dust) { d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; const k = d.t / d.life; x.fillStyle = `rgba(190,170,140,${0.45 * (1 - k)})`; x.beginPath(); x.arc(d.x, d.y, d.r * (1 + k), 0, Math.PI * 2); x.fill(); }
  ui.dust = ui.dust.filter((d) => d.t < d.life);
  for (const p of ui.shards) {
    p.t += dt; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.globalAlpha = Math.min(1, (p.life - p.t) * 4);
    x.fillStyle = p.col; x.beginPath(); x.moveTo(-p.size, -p.size * 0.5); x.lineTo(p.size * 0.8, -p.size * 0.7); x.lineTo(p.size * 0.3, p.size * 0.8); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 1; x.stroke(); x.restore();
  }
  ui.shards = ui.shards.filter((p) => p.t < p.life);
  // Explosionen
  for (const b of ui.booms) {
    b.t += dt; const k = b.t / 0.5, Rb = laneW * (0.3 + k * 1.1);
    x.globalAlpha = Math.max(0, 1 - k);
    const g = x.createRadialGradient(b.x, b.y, 0, b.x, b.y, Rb);
    g.addColorStop(0, '#fff7c0'); g.addColorStop(0.35, '#ffb43a'); g.addColorStop(0.7, 'rgba(230,70,20,.8)'); g.addColorStop(1, 'rgba(120,30,10,0)');
    x.fillStyle = g; x.beginPath(); x.arc(b.x, b.y, Rb, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 3 * (1 - k); x.beginPath(); x.arc(b.x, b.y, Rb * 1.1, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 1;
  }
  ui.booms = ui.booms.filter((b) => b.t < 0.5);
  if (ui.flash2 > 0) { x.fillStyle = `rgba(255,240,200,${ui.flash2 * 1.6})`; x.fillRect(0, 0, w, H); ui.flash2 -= dt; }
  // Gefahrenlinie unten
  x.fillStyle = ui.flash > 0 ? `rgba(255,60,60,${ui.flash})` : 'rgba(255,90,60,.5)'; x.fillRect(ox, fh - 3, laneW * L, 3);
  if (ui.flash > 0) { x.fillStyle = `rgba(255,40,40,${ui.flash * 0.4})`; x.fillRect(0, 0, w, H); ui.flash -= dt; }
  // Pokémon unten: springt zur getroffenen Spalte und greift an
  x.fillStyle = '#3a2e22'; x.fillRect(-20, fh, w + 40, H - fh + 20);
  if (ui.spr.ready) {
    const since = run.t - ui.atkT, attacking = since < 0.35;
    const tx = attacking ? ox + (ui.atkLane + 0.5) * laneW : w / 2;
    ui.px = ui.px == null ? tx : ui.px + (tx - ui.px) * Math.min(1, dt * 18);
    const f = attacking ? frameOf(ui.spr, 'Attack', 4, since * 1000, true) : frameOf(ui.spr, 'Idle', 4, performance.now());
    const sc = Math.max(2, Math.round((ui.foot * 1.5) / f.fh * dpr)) / dpr; // PMD-Frames haben viel Leerraum
    x.imageSmoothingEnabled = false;
    x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, ui.px - (f.fw * sc) / 2, fh + ui.foot * 0.55 - (f.fh * sc) / 2, f.fw * sc, f.fh * sc);
  }
  // Tempo-Anzeige: wann der nächste Tipp zählt
  const cd = Math.min(1, (run.t - run.lastTap) / run.gap);
  x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(w / 2 - 40, H - 10, 80, 5);
  x.fillStyle = cd >= 1 ? '#7be08a' : '#ffd23f'; x.fillRect(w / 2 - 40, H - 10, 80 * cd, 5);
  // Texte
  x.textAlign = 'center'; x.font = `700 ${Math.round(laneW * 0.2)}px system-ui, sans-serif`;
  for (const t of ui.texts) { t.t += dt; const k = t.t / t.life; x.globalAlpha = 1 - k; x.fillStyle = '#000'; x.fillText(t.s, t.x + 1, t.y - k * 30 + 1); x.fillStyle = t.col; x.fillText(t.s, t.x, t.y - k * 30); }
  x.globalAlpha = 1;
  ui.texts = ui.texts.filter((t) => t.t < t.life);
}

// langer Fels: Säule über mehrere Reihen, bröselt beim Halten von unten weg (Funken + Staub)
function drawHold(x, row, dt) {
  const { laneW, rowH, fh, ox } = ui, s = shapeOf(row);
  const cx = ox + (row.lane + 0.5) * laneW, half = laneW * 0.36;
  const yTop = fh - run.topOf(row) * rowH + rowH * 0.1, yBot = fh - run.bottomOf(row) * rowH - rowH * 0.06;
  if (yBot - yTop < 4) return;
  x.save();
  x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(cx - half + 4, yTop + 6, half * 2, yBot - yTop);
  // zackige Kanten (fest je Fels)
  const seg = Math.max(2, Math.round((yBot - yTop) / (rowH * 0.25)));
  x.beginPath();
  for (let i = 0; i <= seg; i++) { const y = yTop + ((yBot - yTop) * i) / seg; x.lineTo(cx - half - Math.sin(i * 2.3 + s.hue) * half * 0.12, y); }
  for (let i = seg; i >= 0; i--) { const y = yTop + ((yBot - yTop) * i) / seg; x.lineTo(cx + half + Math.cos(i * 1.7 + s.hue) * half * 0.12, y); }
  x.closePath();
  const g = x.createLinearGradient(cx - half, 0, cx + half, 0);
  g.addColorStop(0, `hsl(${s.hue}, 14%, ${s.light + 20}%)`); g.addColorStop(0.5, `hsl(${s.hue}, 14%, ${s.light}%)`); g.addColorStop(1, `hsl(${s.hue}, 16%, ${s.light - 15}%)`);
  x.fillStyle = g; x.fill();
  x.lineWidth = 3; x.strokeStyle = `hsl(${s.hue}, 25%, 16%)`; x.stroke();
  // Schichtlinien + Glanz
  x.strokeStyle = 'rgba(30,20,10,.35)'; x.lineWidth = 2;
  for (let k = 1; k < row.len * 2; k++) { const y = fh - (run.yOf(row) + k * 0.5) * rowH; if (y > yTop + 6 && y < yBot - 6) { x.beginPath(); x.moveTo(cx - half * 0.8, y); x.lineTo(cx + half * 0.6, y + 4); x.stroke(); } }
  x.fillStyle = 'rgba(255,255,255,.16)'; x.fillRect(cx - half * 0.6, yTop + 8, half * 0.22, Math.max(0, yBot - yTop - 16));
  // Hinweis: „halten“
  if (!row.held) { x.fillStyle = 'rgba(255,255,255,.85)'; x.font = `700 ${Math.round(laneW * 0.16)}px system-ui, sans-serif`; x.textAlign = 'center'; x.fillText('HALTEN', cx, yBot - rowH * 0.25); }
  x.restore();
  // beim Halten: Funken und Staub an der Bruchkante
  if (row.held && !ui.paused) {
    ui.grindT -= dt;
    if (ui.grindT <= 0) { ui.grindT = 0.07; shards({ x: cx, y: yBot }, s, 2, 0.6); dust({ x: cx, y: yBot }, 1); if (Math.random() < 0.4) sfx.hit(); ui.shake = Math.max(ui.shake, 1.5); ui.atkT = run.t; ui.atkLane = row.lane; }
  }
}
// Bombe: schwarze Kugel mit glimmender Lunte
function drawBomb(x, row) {
  const o = screenOf(row), R0 = Math.min(ui.laneW, ui.rowH) * 0.34;
  const wg = ui.wiggle.get(row), wt = wg != null ? run.t - wg : 9, wob = wt < 0.18 ? Math.sin(wt * 70) * 3 * (1 - wt / 0.18) : 0;
  x.save(); x.translate(o.x + wob, o.y + R0 * 0.1);
  x.fillStyle = 'rgba(0,0,0,.3)'; x.beginPath(); x.ellipse(0, R0 * 0.95, R0 * 0.85, R0 * 0.2, 0, 0, Math.PI * 2); x.fill();
  const g = x.createRadialGradient(-R0 * 0.35, -R0 * 0.35, R0 * 0.1, 0, 0, R0);
  g.addColorStop(0, '#6a6f80'); g.addColorStop(0.45, '#2a2d38'); g.addColorStop(1, '#0d0e14');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, R0, 0, Math.PI * 2); x.fill();
  x.lineWidth = 2; x.strokeStyle = '#000'; x.stroke();
  x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.ellipse(-R0 * 0.38, -R0 * 0.42, R0 * 0.22, R0 * 0.12, -0.6, 0, Math.PI * 2); x.fill();
  // Kappe + Lunte
  x.fillStyle = '#8a8f9c'; x.fillRect(-R0 * 0.22, -R0 * 1.12, R0 * 0.44, R0 * 0.26);
  x.strokeStyle = '#c9a46a'; x.lineWidth = Math.max(2, R0 * 0.09); x.beginPath(); x.moveTo(0, -R0 * 1.1); x.quadraticCurveTo(R0 * 0.35, -R0 * 1.5, R0 * 0.55, -R0 * 1.35); x.stroke();
  const fl = 0.6 + Math.sin(performance.now() / 45) * 0.4;
  x.fillStyle = `rgba(255,${180 + fl * 60},60,${0.7 + fl * 0.3})`; x.beginPath(); x.arc(R0 * 0.58, -R0 * 1.36, R0 * (0.12 + fl * 0.1), 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(R0 * 0.58, -R0 * 1.36, R0 * 0.05, 0, Math.PI * 2); x.fill();
  // Symbol: Schnecke = bremst
  x.font = `${Math.round(R0 * 0.75)}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🐌', 0, R0 * 0.08); x.textBaseline = 'alphabetic';
  x.restore();
}

function pauseMenu() {
  if (!run || run.over || !ui || ui.paused) return;
  ui.paused = true;
  modal((m, close) => {
    const resume = () => { close(); if (ui) { ui.paused = false; ui.last = performance.now(); } };
    m.append(h('h3', '⏸ Pause'), h('p.note', `${run.smashed} Felsen zertrümmert.`),
      h('div.row', h('button.btn', { onclick: () => { close(); if (ui) ui.paused = false; run.over = true; } }, 'Aufgeben'), h('button.btn.primary.big', { onclick: resume }, '▶ Weiter')));
    $('#modal').onclick = (e) => { if (e.target === $('#modal')) resume(); };
  });
}
document.addEventListener('visibilitychange', () => { if (document.hidden && run && ui && !run.over) pauseMenu(); });
async function giveUp() {
  if (!run || run.over) return;
  ui.paused = true;
  const yes = await confirmDialog('Runde beenden? Deine Felsen bis jetzt zählen.', 'Beenden');
  if (ui) ui.paused = false;
  if (yes && run) run.over = true;
}
function end() {
  ui.ended = true;
  const n = run.smashed, p = mon;
  const r = app.act((s, t) => rockReward(s, p.uid, n, t), true);
  if (r.record) sfx.win(); else sfx.lose();
  setTimeout(() => modal((m, close) => {
    m.append(h('h3', r.record ? '🏆 Neuer Rekord!' : '⛏ Training beendet'),
      h('p', `${name(p)} hat ${n} Felsen zertrümmert${run.bombs ? ` (${run.bombs} ${run.bombs === 1 ? "Bombe" : "Bomben"} gezündet)` : ''}.`),
      r.ok === false ? h('p.note', r.msg) : h('div.rk-rewards',
        h('div', `+${r.ep} EP`),
        r.pct ? h('div', `💪 +${r.pct} % Angriff (physisch) heute in allen Kampfmodi`) : h('div.note', 'Kein Buff – zertrümmere mehr Felsen.'),
        h('div', r.coins ? ['+', String(r.coins), ' ', iconImg('coin', 2)] : h('small', 'Münz-Limit für heute erreicht'))),
      h('div.row', h('button.btn.primary.big', { onclick: () => { close(); closeRun(); renderRocksSetup(setupEl, setupBack); } }, 'Fertig')));
    $('#modal').onclick = null; // nicht versehentlich wegtippen
  }), 500);
}
