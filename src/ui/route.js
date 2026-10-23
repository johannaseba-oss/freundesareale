// Route – Oberfläche: Level wählen, Team (Empfehlung, anpassbar), dann das Feld mit fester Route und Bauplätzen.
// Pokémon aus der Leiste unten auf einen Bauplatz setzen; ein platziertes Pokémon antippen = trainieren (EP) oder zurücknehmen.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import * as A from '../game/actions.js';
import { Route, routeLevels, shapeOf, radiusOf, maxUnits, upgradeCost, recommendRouteTeam, pathCells } from '../game/route.js';
import { canBattle, moveOf, bdata } from '../game/battle.js';
import { typeColor, typeChip } from '../game/types.js';
import { loadSprites, frameOf, portraitUrl, dirFromVector } from '../gfx/sprites.js';
import { $, h, toast, confirmDialog, modal } from './dom.js';
import { teamPicker } from './teampick.js';
import { haptic } from '../haptics.js';
import { sfx, setMusic, musicForLevel } from '../audio.js';
import { now, dayKey } from '../time.js';

const R = () => CFG.route;
const base = import.meta.env.BASE_URL;
let chosen = null, game = null, ui = null, team = [];
const st = () => app.state.route || { ep: 0, cleared: 0 };
const SHAPE_TEXT = { adjacent: 'trifft direkt angrenzende Felder', line: 'trifft die ganze gerade Strecke in Blickrichtung', circle: 'schießt im Radius', cross: 'trifft alles auf einem Kreuz' };

// ================= Auswahl =================
export function renderRouteSetup(el, back) {
  if (!chosen) { renderLevels(el, back); return; }
  const mons = app.state.pokemon.filter((p) => canBattle(p.dex)).sort((a, b) => b.level - a.level || a.dex - b.dex);
  const N = Math.min(maxUnits(st().cleared || 0), mons.length);
  if (!N) { toast('Du brauchst Pokémon – zieh welche am Automaten!'); chosen = null; renderLevels(el, back); return; }
  const hint = (p) => { const sh = R().shapes[shapeOf(p.dex)]; return [h('span.role-tag.route-shape', `${sh.icon} ${sh.name}`), h('span.d-price', `Lv ${p.level}`)]; };
  const picker = teamPicker({ mons, N, hint, initial: recommendRouteTeam(mons, chosen.types, N), onFull: (uids) => confirmTeam(uids) });
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: () => { chosen = null; renderRouteSetup(el, back); } }, '‹ Level'),
    h('div.bs-head', h('h2', `🛤 Level ${chosen.n} · ${chosen.name}`), picker.count),
    h('div.d-theme', h('b', 'Gegner: '), h('span.type-chips.inline', chosen.types.map((t) => typeChip(t))), h('small', ` · ${chosen.waves} Wellen`)),
    h('p.note', `Empfohlenes Team mit verschiedenen Angriffsformen ist ausgewählt – antippen zum Tauschen. Bis zu ${N} Pokémon kommen aufs Feld.`),
    picker.tools, picker.grid));
}
function renderLevels(el, back) {
  const L = routeLevels(), done = st().cleared || 0;
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: back }, '‹ Zurück'),
    h('div.bs-head', h('h2', '🛤 Route'), h('span.bs-count', `${done}/${L.length} geschafft`)),
    h('p.note', `Wilde Pokémon laufen eine feste Route entlang. Setz deine Pokémon auf die Bauplätze daneben. Besiegte Gegner bringen EP – damit trainierst du deine Pokémon dauerhaft (auch in den Arealen). EP: ${st().ep || 0}`),
    h('div.route-levels', L.map((lv) => {
      const state = lv.n <= done ? 'done' : lv.n === done + 1 ? 'next' : 'locked';
      return h('button.route-lv.' + state, { onclick: () => {
        if (state === 'locked') { toast(`Schaffe zuerst Level ${done + 1}.`); return; }
        chosen = lv; haptic('tick'); renderRouteSetup(el, back); el.scrollTop = 0;
      } }, h('b', state === 'done' ? '✓ ' + lv.n : String(lv.n)), h('small', lv.name), h('span.road-types', lv.types.map((t) => h('i', { style: { background: typeColor(t) } }))));
    }))));
}
function confirmTeam(uids) {
  team = uids;
  modal((m, close) => {
    m.append(h('h3', `Dein Route-Team · Level ${chosen.n}`),
      h('div.confirm-list', uids.map((u, i) => {
        const p = app.state.pokemon.find((q) => q.uid === u), sh = R().shapes[shapeOf(p.dex)];
        return h('div.confirm-row', h('span.bs-num', String(i + 1)), h('img', { src: portraitUrl(p.dex), alt: '' }),
          h('div', h('b', `${p.nick || species(p.dex).name} · Lv ${p.level}`), h('small', `${sh.icon} ${sh.name}: ${SHAPE_TEXT[shapeOf(p.dex)]}`)));
      })),
      h('div.row', h('button.btn', { onclick: close }, 'Anpassen'), h('button.btn.primary.big', { onclick: () => { close(); start(); } }, 'Los!')));
  });
}
function start() {
  const members = team.map((u) => app.state.pokemon.find((p) => p.uid === u)).filter(Boolean)
    .map((p) => ({ uid: p.uid, dex: p.dex, ivs: p.ivs, evs: p.evs, level: p.level, nick: p.nick, gender: p.gender }));
  game = new Route({ level: chosen, team: members, cleared: st().cleared || 0 });
  openField();
}

// ================= Spielfeld =================
function openField() {
  closeField();
  const canvas = h('canvas.arena-canvas');
  const bar = h('div.r-bar'), info = h('div.d-info'), msg = h('div.b-msg');
  const livesEl = h('span.r-stat'), epEl = h('span.r-stat'), waveEl = h('div.d-wave', h('span'), h('div.d-wavebar', h('i')));
  const go = h('button.btn.primary.big.d-go', { onclick: () => { go.remove(); game.started = true; message('Los! Halte die wilden Pokémon auf.'); haptic('medium'); } }, 'Los!');
  const top = h('div.b-top', livesEl, waveEl, epEl, h('button.b-btn', { onclick: giveUp, title: 'Aufgeben' }, '🏳'));
  const root = h('div.battle.defense.route', top, h('div.b-field', canvas, go), info, bar, msg);
  document.body.append(root);
  document.body.classList.add('in-battle');
  setMusic(musicForLevel(game.level.types));
  ui = { root, canvas, ctx: canvas.getContext('2d'), bar, info, msg, livesEl, epEl, waveEl, sel: null, selUnit: null, fx: [], texts: [], beams: [], last: performance.now(), raf: 0 };
  for (const m of game.team) loadSprites(m.dex, m.gender);
  const TH = CFG.defenseThemes; ui.themeId = TH.byType[game.level.types[0]] || 'wald';
  const ti = new Image(); ti.src = `${base}art/defense/${ui.themeId}.png`; ti.onload = () => { ui.bg = null; }; ui.tiles = ti;
  ui.ro = new ResizeObserver(() => layout()); ui.ro.observe(canvas.parentElement);
  canvas.addEventListener('pointerdown', onField);
  layout();
  buildBar();
  renderInfo();
  message('Setz deine Pokémon auf die Bauplätze – dann „Los!“');
  const loop = (t) => { if (!ui) return; const dt = Math.min(0.1, (t - ui.last) / 1000); ui.last = t; frame(dt); ui.raf = requestAnimationFrame(loop); };
  ui.raf = requestAnimationFrame(loop);
  if (import.meta.env.DEV) app.route = { get g() { return game; }, get ui() { return ui; } };
}
function closeField() {
  if (!ui) return;
  cancelAnimationFrame(ui.raf); ui.ro.disconnect(); ui.root.remove();
  document.body.classList.remove('in-battle');
  ui = null;
  setMusic('menu');
}
function layout() {
  const { canvas } = ui, r = canvas.parentElement.getBoundingClientRect(), G = R().grid;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  const fit = Math.min(r.width / (G.cols + 0.6), r.height / (G.rows + 0.4));
  const m = Math.floor((fit * dpr) / 24), tile = m >= 1 ? (24 * m) / dpr : Math.floor(fit); // ganzzahlige Pixel wie im PokeDefense
  const snap = (v) => Math.round(v * dpr) / dpr;
  Object.assign(ui, { dpr, w: r.width, h: r.height, tile, ox: snap((r.width - tile * G.cols) / 2), oy: snap((r.height - tile * G.rows) / 2), bg: null });
}
function frame(dt) {
  if (!ui || !game) return;
  game.update(dt);
  handleEvents();
  draw(dt);
  renderTop();
  if (game.over && !ui.ended) end();
}
const cellAt = (cx, cy) => { const r = ui.canvas.getBoundingClientRect(), G = R().grid; const c = Math.floor((cx - r.left - ui.ox) / ui.tile), rr = Math.floor((cy - r.top - ui.oy) / ui.tile); return c >= 0 && c < G.cols && rr >= 0 && rr < G.rows ? [c, rr] : null; };
const slotAt = (c) => game.level.slots.findIndex(([x, y]) => x === c[0] && y === c[1]);

function onField(e) {
  if (!game || game.over) return;
  const c = cellAt(e.clientX, e.clientY);
  if (!c) return;
  const si = slotAt(c);
  if (si < 0) { ui.sel = null; ui.selUnit = null; renderInfo(); return; }
  const u = game.units.find((x) => x.slot === si);
  if (u) { ui.sel = null; ui.selUnit = u; renderInfo(); unitMenu(u); return; }
  if (!ui.sel) { toast('Wähle unten ein Pokémon und tippe dann auf einen Bauplatz.'); return; }
  if (game.units.length >= game.max) { toast(`Höchstens ${game.max} Pokémon gleichzeitig auf dem Feld.`); return; }
  if (game.place(ui.sel, si)) { haptic('medium'); sfx.place(); ui.sel = null; buildBar(); renderInfo(); }
}
// Platziertes Pokémon: trainieren (EP, dauerhaft) oder zurück in die Leiste
function unitMenu(u) {
  const p = app.state.pokemon.find((q) => q.uid === u.uid), cost = upgradeCost(u.level), have = (st().ep || 0) + game.ep;
  const today = st().day === dayKey(now()) ? st().today?.[u.uid] || 0 : 0, lim = R().upgrade.dailyPerPokemon;
  const sh = R().shapes[u.shape];
  modal((m, close) => {
    m.append(h('h3', `${u.nick || species(u.dex).name} · Lv ${u.level}`),
      h('p.note', `${sh.icon} ${sh.name}: ${SHAPE_TEXT[u.shape]}${u.shape === 'circle' ? ` (Radius ${radiusOf(u.level).toFixed(1)} Felder)` : ''}.`),
      h('p.note', `Training +1 Level: schneller, mehr Wucht${u.shape === 'circle' ? ', größerer Radius' : ''}. Das Level bleibt dauerhaft – auch in den Arealen. Kosten: ${cost} EP (du hast ${have}). Heute noch ${Math.max(0, lim - today)}× möglich.`),
      h('div.row',
        h('button.btn', { onclick: () => { close(); if (game.unplace(u)) { ui.selUnit = null; buildBar(); renderInfo(); } } }, 'Zurück in die Leiste'),
        h('button.btn.primary', { onclick: () => { close(); train(u, p, cost); } }, `⬆ Trainieren (${cost} EP)`)));
  });
}
function commitEp() {
  if (!game || game.ep <= 0) return;
  const n = game.ep; game.ep = 0;
  app.act((s) => A.addRouteEp(s, n), true);
}
function train(u, p, cost) {
  if (!p) return;
  commitEp();
  const r = app.act((s, t) => A.trainLevel(s, s.pokemon.find((q) => q.uid === p.uid), t, cost, dayKey(now())), true);
  if (r.ok === false) return;
  game.levelUp(u);
  haptic('medium'); sfx.levelUp();
  message(`${u.nick || species(u.dex).name} ist jetzt Level ${u.level}!`);
}

// Leiste unten: Team; platzierte Pokémon sind abgeblendet
function buildBar() {
  ui.bar.replaceChildren(...game.team.map((m) => {
    const placed = !!game.placed(m.uid), sh = R().shapes[shapeOf(m.dex)];
    const el = h('button.r-mon' + (placed ? '.placed' : '') + (ui.sel === m.uid ? '.sel' : ''), { onclick: () => {
      if (placed) { toast('Schon auf dem Feld – tippe es dort an.'); return; }
      ui.sel = ui.sel === m.uid ? null : m.uid; ui.selUnit = null; haptic('tick'); buildBar(); renderInfo();
    } }, h('img', { src: portraitUrl(m.dex), alt: '' }), h('span.r-shape', sh.icon), h('small', `Lv ${m.level}`));
    return el;
  }), h('span.r-count', `${game.units.length}/${game.max}`));
}
function renderInfo() {
  const m = ui.sel ? game.team.find((x) => x.uid === ui.sel) : ui.selUnit;
  if (!m) { ui.info.replaceChildren(h('small', 'Pokémon unten antippen, dann einen Bauplatz. Platzierte Pokémon antippen = trainieren.')); return; }
  const sh = shapeOf(m.dex), mv = moveOf(bdata(m.dex).move);
  ui.info.replaceChildren(h('b', m.nick || species(m.dex).name), h('span.type-chips.inline', species(m.dex).types.map((t) => typeChip(t))),
    h('small', `${R().shapes[sh].icon} ${R().shapes[sh].name}: ${SHAPE_TEXT[sh]} · ${mv.name} (${mv.cat === 'phys' ? 'physisch' : 'speziell'})`));
}
function renderTop() {
  const w = game.progress(), k = `${game.lives}|${w.wave}|${game.ep}|${st().ep}`;
  if (ui.topKey === k) return;
  ui.topKey = k;
  ui.livesEl.textContent = `♥ ${game.lives}`;
  ui.epEl.textContent = `EP ${(st().ep || 0) + game.ep}`;
  ui.waveEl.firstChild.textContent = w.wave ? `Welle ${w.wave}/${w.total}` : 'Vorbereitung';
  ui.waveEl.lastChild.firstChild.style.width = (w.wave / w.total) * 100 + '%';
}
function message(text) { const el = h('div', text); ui.msg.append(el); setTimeout(() => el.remove(), 2600); }

// ---------- Zeichnen ----------
function buildBackground() {
  const U = ui, G = R().grid, th = CFG.defenseThemes.themes[U.themeId], S = 24;
  const c = document.createElement('canvas');
  c.width = Math.round(U.w * U.dpr); c.height = Math.round(U.h * U.dpr);
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  const Dp = Math.round(U.tile * U.dpr), ox = Math.round(U.ox * U.dpr), oy = Math.round(U.oy * U.dpr), px = Math.max(1, Math.round(Dp / 24));
  const X = (col) => ox + col * Dp, Y = (r) => oy + r * Dp;
  const hash = (a, b) => (((a * 73856093) ^ (b * 19349663)) >>> 0) % 997;
  const c0 = Math.floor(-ox / Dp) - 1, r0 = Math.floor(-oy / Dp) - 1, c1 = Math.ceil((c.width - ox) / Dp), r1 = Math.ceil((c.height - oy) / Dp);
  const inGrid = (col, r) => col >= 0 && col < G.cols && r >= 0 && r < G.rows;
  for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) x.drawImage(U.tiles, (inGrid(col, r) ? th.wall : hash(col, r) % th.wall) * S, 0, S, S, X(col), Y(r), Dp, Dp);
  // Route: sandiger Pfad mit Pixelrand (auch Ein- und Ausgang bis zum Rand)
  const cells = pathCells(game.level.path), on = new Set(cells.map(([a, b]) => a + ',' + b));
  const first = game.level.path[0], last = game.level.path[game.level.path.length - 1];
  const all = [...cells, [first[0], -1], [last[0], G.rows]];
  const isP = (a, b) => on.has(a + ',' + b) || (a === first[0] && b < 0) || (a === last[0] && b >= G.rows);
  for (const [a, b] of all) {
    x.fillStyle = '#c9a46a'; x.fillRect(X(a), Y(b), Dp, Dp);
    x.fillStyle = '#d8b67c'; for (let i = 0; i < 10; i++) { const hx = hash(a * 13 + i, b * 7 + i); x.fillRect(X(a) + (hx % 22) * px, Y(b) + ((hx >> 3) % 22) * px, px * 2, px); }
    x.fillStyle = '#a9824c';
    if (!isP(a, b - 1)) x.fillRect(X(a), Y(b), Dp, px * 2);
    if (!isP(a, b + 1)) x.fillRect(X(a), Y(b) + Dp - px * 2, Dp, px * 2);
    if (!isP(a - 1, b)) x.fillRect(X(a), Y(b), px * 2, Dp);
    if (!isP(a + 1, b)) x.fillRect(X(a) + Dp - px * 2, Y(b), px * 2, Dp);
  }
  // Bauplätze: helle Steinplatten
  for (const [a, b] of game.level.slots) {
    const L = X(a) + px * 2, T = Y(b) + px * 2, W = Dp - px * 4;
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(L + px, T + px * 2, W, W);
    x.fillStyle = '#b8b2a6'; x.fillRect(L, T, W, W);
    x.fillStyle = '#d9d4c8'; x.fillRect(L + px, T + px, W - px * 2, W - px * 3);
    x.fillStyle = '#8c8578'; x.fillRect(L, T + W - px, W, px); x.fillRect(L + W - px, T, px, W);
  }
  // Rahmen um das Spielfeld
  x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(X(0) - px * 2, Y(0) - px * 2, G.cols * Dp + px * 4, px * 2); x.fillRect(X(0) - px * 2, Y(G.rows), G.cols * Dp + px * 4, px * 2);
  x.fillRect(X(0) - px * 2, Y(0), px * 2, G.rows * Dp); x.fillRect(X(G.cols), Y(0), px * 2, G.rows * Dp);
  return c;
}
// Felder, die ein Pokémon erreicht (Vorschau)
function reachCells(u) {
  const G = R().grid, out = [];
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) if (game.inReach(u, { x: c + 0.5, y: r + 0.5 })) out.push([c, r]);
  return out;
}
function draw(dt) {
  const U = ui, x = U.ctx, T = U.tile, now2 = performance.now();
  x.setTransform(U.dpr, 0, 0, U.dpr, 0, 0); x.imageSmoothingEnabled = false;
  if (!U.bg && U.tiles.complete && U.tiles.naturalWidth) U.bg = buildBackground();
  x.fillStyle = '#4b6a3c'; x.fillRect(0, 0, U.w, U.h);
  if (U.bg) x.drawImage(U.bg, 0, 0, U.w, U.h);
  const P = (o) => [U.ox + o.x * T, U.oy + o.y * T];
  // freie Bauplätze hervorheben, wenn ein Pokémon gewählt ist
  if (U.sel) {
    x.strokeStyle = '#fff'; x.lineWidth = 2;
    game.level.slots.forEach(([a, b], i) => { if (game.slotFree(i)) { const k = 1 + Math.sin(now2 / 180) * 1.5; x.strokeRect(U.ox + a * T + 3 - k, U.oy + b * T + 3 - k, T - 6 + 2 * k, T - 6 + 2 * k); } });
  }
  // Reichweite des angetippten Pokémon
  if (U.selUnit && game.units.includes(U.selUnit)) {
    x.fillStyle = 'rgba(255,240,150,.22)';
    for (const [a, b] of reachCells(U.selUnit)) x.fillRect(U.ox + a * T + 1, U.oy + b * T + 1, T - 2, T - 2);
  }
  const all = [...game.units.map((o) => ({ o, mine: true })), ...game.enemies.map((o) => ({ o, mine: false }))].sort((a, b) => a.o.y - b.o.y);
  for (const { o, mine } of all) drawMon(x, o, mine, P(o), T, now2);
  // Fernschüsse
  for (const s of game.shots) { const [X, Y] = P(s), q = Math.max(4, T / 7); x.fillStyle = '#fff'; x.fillRect(X - q / 2 - 1, Y - q / 2 - 1, q + 2, q + 2); x.fillStyle = typeColor(s.type); x.fillRect(X - q / 2, Y - q / 2, q, q); }
  // Strahlen/Kreuze/Hiebe
  U.beams = U.beams.filter((b) => {
    b.t += dt; if (b.t > 0.25) return false;
    x.globalAlpha = 1 - b.t / 0.25; x.fillStyle = b.color;
    for (const [a, c] of b.cells) x.fillRect(U.ox + a * T + T * 0.3, U.oy + c * T + T * 0.3, T * 0.4, T * 0.4);
    x.globalAlpha = 1;
    return true;
  });
  U.fx = U.fx.filter((f) => { f.life -= dt; if (f.life <= 0) return false; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 5 * dt; x.globalAlpha = Math.min(1, f.life / 0.3); x.fillStyle = f.color; const s = Math.max(2, T / 12); x.fillRect(U.ox + f.x * T - s / 2, U.oy + f.y * T - s / 2, s, s); return true; });
  x.globalAlpha = 1;
  U.texts = U.texts.filter((t) => {
    t.t += dt; if (t.t > t.dur) return false;
    x.globalAlpha = Math.min(1, (t.dur - t.t) / 0.3);
    x.font = `600 ${Math.round(T * t.size)}px 'Ziffern', 'Pixelify Sans', sans-serif`; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = 'rgba(40,25,20,.95)';
    const X = U.ox + t.x * T, Y = U.oy + t.y * T - t.t * T * 0.7;
    x.strokeText(t.text, X, Y); x.fillStyle = t.color; x.fillText(t.text, X, Y);
    x.globalAlpha = 1; return true;
  });
}
function drawMon(x, o, mine, [X, Y], T, now2) {
  const e = loadSprites(o.dex, o.gender);
  if (!e.ready) return;
  let name = mine ? 'Idle' : 'Walk', ms = now2, once = false;
  if (o.hurtT != null && game.t - o.hurtT < 0.25 && e.anims.Hurt) { name = 'Hurt'; ms = (game.t - o.hurtT) * 1000; once = true; }
  else if (o.anim && (game.t - o.anim.t0) * 1000 < (e.anims[o.anim.name]?.total || 0) * (1000 / 60)) { name = o.anim.name; ms = (game.t - o.anim.t0) * 1000; once = true; }
  // Blickrichtung: Gegner in Laufrichtung, eigene zur Strecke (Gerade) bzw. zum letzten Ziel
  const dir = mine ? (o.shape === 'line' ? dirFromVector(o.face[0], o.face[1]) : o.lookAt ? dirFromVector(o.lookAt.x - o.x, o.lookAt.y - o.y) : 0) : dirFromVector(o.dx || 0, o.dy || 1);
  const f = frameOf(e, name, dir, ms, once);
  let s = T / 28; if (e.anims.Idle.fh * s > T * 1.5) s = (T * 1.5) / e.anims.Idle.fh;
  if (o.boss) s *= 1.35;
  if (o.hp <= 0) x.globalAlpha = 0.4;
  x.fillStyle = 'rgba(30,40,20,.28)'; x.beginPath(); x.ellipse(X, Y + T * 0.25, T * 0.3, T * 0.1, 0, 0, 7); x.fill();
  x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(X - (f.fw * s) / 2), Math.round(Y - T * 0.05 - (f.fh * s) / 2), Math.round(f.fw * s), Math.round(f.fh * s));
  x.globalAlpha = 1;
  if (mine) { // Level-Schild
    x.font = `600 ${Math.round(T * 0.2)}px 'Ziffern', 'Pixelify Sans', sans-serif`; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = 'rgba(40,25,20,.9)';
    x.strokeText('Lv' + o.level, X, Y + T * 0.46); x.fillStyle = '#fff6c0'; x.fillText('Lv' + o.level, X, Y + T * 0.46);
  } else if (o.hp > 0 && (o.hp < o.maxHp || o.boss)) {
    const bw = T * (o.boss ? 1 : 0.6), bh = Math.max(3, T / 14), by = Y - T * 0.5;
    x.fillStyle = '#2f2622'; x.fillRect(X - bw / 2 - 1, by - 1, bw + 2, bh + 2);
    x.fillStyle = o.boss ? '#ffb02e' : '#ef5d5d'; x.fillRect(X - bw / 2, by, (bw * o.hp) / o.maxHp, bh);
  }
}
const say = (o, text, color, size = 0.3, dur = 0.8) => ui.texts.push({ x: o.x, y: o.y - 0.4, text, color, size, dur, t: 0 });
const burst = (o, color, n) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.3, v = 1 + Math.random() * 2; ui.fx.push({ x: o.x, y: o.y - 0.1, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, color, life: 0.4 + Math.random() * 0.3 }); } };
function handleEvents() {
  for (const ev of game.events) {
    if (ev.type === 'attack') {
      const u = ev.u, color = typeColor(moveOf(bdata(u.dex).move).type);
      u.lookAt = ev.target;
      if (u.shape === 'line' || u.shape === 'cross') ui.beams.push({ cells: reachCells(u), color, t: 0 });
      sfx.attack(moveOf(bdata(u.dex).move).type);
    } else if (ev.type === 'hit') {
      const col = ev.crit ? '#ffe066' : ev.eff > 1 ? '#ffd23f' : ev.eff < 1 ? '#d0c8bc' : '#ffffff';
      say(ev.e, String(ev.dmg), col, ev.crit || ev.eff > 1 ? 0.38 : 0.3); burst(ev.e, typeColor(ev.move.type), ev.crit ? 10 : 5); sfx.hit();
    } else if (ev.type === 'defeat') { say(ev.e, `+${ev.ep} EP`, '#9fe8ff', 0.26, 1); burst(ev.e, '#ffffff', 12); sfx.ko(); }
    else if (ev.type === 'leak') { message(`Ein wildes Pokémon ist durchgekommen! Noch ${game.lives} ♥`); haptic('strong'); sfx.lose(); }
    else if (ev.type === 'wave') { message(ev.last ? 'Letzte Welle – mit Boss!' : `Welle ${ev.wave + 1}`); sfx.wave(ev.last); haptic('medium'); }
    else if (ev.type === 'boss') { message('Ein Boss erscheint!'); haptic('strong'); }
    else if (ev.type === 'level') { say(ev.u, `Lv ${ev.u.level}!`, '#ffd23f', 0.32, 1); burst(ev.u, '#ffd23f', 14); }
    else if (ev.type === 'place') burst(ev.u, '#e2bf65', 8);
  }
  game.events.length = 0;
}

async function giveUp() {
  if (!game || game.over) return;
  if (await confirmDialog('Level aufgeben? Bisher verdiente EP behältst du.', 'Aufgeben')) game.over = { won: false, gaveUp: true };
}
function end() {
  ui.ended = true;
  const won = game.over.won, lv = chosen;
  let bonus = 0, first = false;
  if (won) {
    const r = app.act((s) => A.routeCleared(s, lv.n), true);
    first = r.first; bonus = first ? R().ep.firstWin : R().ep.win;
    game.ep += bonus;
  }
  const earned = game.ep;
  commitEp();
  if (won) sfx.win(); else sfx.lose();
  const next = routeLevels().find((x) => x.n === lv.n + 1);
  const leave = (to) => { closeField(); game = null; chosen = to; app.refresh(); document.dispatchEvent(new Event('defense-closed')); };
  ui.root.append(h('div.b-result' + (won ? '.won' : ''),
    h('h2', won ? `Level ${lv.n} geschafft!` : 'Niederlage'),
    h('p', `${won ? `Bonus ${bonus} EP${first ? ' (erster Sieg)' : ''}. ` : game.over.gaveUp ? 'Du hast aufgegeben. ' : 'Zu viele wilde Pokémon sind durchgekommen. '}Verdient: ${earned} EP · Kontostand: ${st().ep} EP`),
    h('div.row', h('button.btn', { onclick: () => leave(null) }, 'Level'),
      won && next ? h('button.btn.primary.big', { onclick: () => leave(next) }, `Level ${next.n} ›`) : h('button.btn.primary.big', { onclick: () => leave(lv) }, won ? 'Nochmal' : 'Nochmal versuchen'))));
}
// App im Hintergrund: verdiente EP sichern
document.addEventListener('visibilitychange', () => { if (document.hidden && game && !game.over) commitEp(); });
