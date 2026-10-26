// Route – Oberfläche: Level wählen, Team (Empfehlung, anpassbar), dann das Feld mit fester Route und Bauplätzen.
// Pokémon aus der Leiste unten auf einen Bauplatz setzen; ein platziertes Pokémon antippen = trainieren (EP) oder zurücknehmen.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import * as A from '../game/actions.js';
import { Route, routeLevels, shapeOf, radiusOf, ringOuter, isWaterMon, maxUnits, upgradeCost, recommendRouteTeam, pathCells, levelSpeed } from '../game/route.js';
import { burst as typeBurst, drawParticles } from '../gfx/particles.js';
import { canBattle, moveOf, bdata, calcStats } from '../game/battle.js';
import { typeColor, typeChip } from '../game/types.js';
import { loadSprites, frameOf, portraitUrl, dirFromVector } from '../gfx/sprites.js';
import { $, h, toast, confirmDialog, modal } from './dom.js';
import { teamPicker } from './teampick.js';
import { damageStats } from './dmgstats.js';
import { renderTerrain, tilesImage, themeForType } from '../gfx/tiles2.js';
import { physBuff } from '../game/rocks.js';
import { fxOf } from '../game/items.js';
import { haptic } from '../haptics.js';
import { sfx, setMusic, musicForLevel } from '../audio.js';
import { now, dayKey } from '../time.js';

const R = () => CFG.route;
const base = import.meta.env.BASE_URL;
let chosen = null, game = null, ui = null, team = [];
let sortBy = 'level', pickSel = null; // Sortierung der Teamauswahl, aktuelle Auswahl (bleibt beim Umsortieren)
const st = () => app.state.route || { ep: 0, cleared: 0 };
const SHAPE_TEXT = { adjacent: 'trifft direkt angrenzende Felder', line: 'trifft die ganze gerade Strecke in Blickrichtung', circle: 'Welle trifft alle im Radius', cross: 'greift in alle vier Richtungen gleichzeitig an', ring: 'Ring-Welle trifft alle im Ring, innen bleibt frei (darf auf Seerosen)' };
const WATER_ONLY = 'Auf die Seerosen im Teich dürfen nur Wasser-Pokémon.';

// ================= Auswahl =================
export function renderRouteSetup(el, back) {
  if (!chosen) { renderLevels(el, back); return; }
  // Favoriten immer oben, danach nach Level oder Angriffsform
  const SH = ['adjacent', 'line', 'circle', 'cross'];
  const mons = app.state.pokemon.filter((p) => canBattle(p.dex)).sort((a, b) => (!!b.fav - !!a.fav)
    || (sortBy === 'shape' ? SH.indexOf(shapeOf(a.dex)) - SH.indexOf(shapeOf(b.dex)) : 0) || b.level - a.level || a.dex - b.dex);
  const N = Math.min(maxUnits(st().cleared || 0), mons.length);
  if (!N) { toast('Du brauchst Pokémon – zieh welche am Automaten!'); chosen = null; renderLevels(el, back); return; }
  const rec = recommendRouteTeam(mons, chosen.types, N);
  if (!pickSel) pickSel = [...new Set([...mons.filter((p) => p.fav).map((p) => p.uid), ...rec])].slice(0, N); // Favoriten zuerst
  const hint = (p) => {
    const sh = R().shapes[shapeOf(p.dex)];
    return [h('span.role-tag.route-shape', `${sh.icon} ${sh.name}`), h('span.d-price', `Lv ${p.level}`)];
  };
  const picker = teamPicker({ mons, N, hint, initial: pickSel, recommend: rec, selectedFirst: true, onFull: (uids) => confirmTeam(uids) });
  pickSel = picker.sel; // gleiche Liste – Änderungen bleiben beim Neuzeichnen erhalten
  const sortBtn = (id, label) => h('button.btn.small' + (sortBy === id ? '.primary' : ''), { onclick: () => { sortBy = id; renderRouteSetup(el, back); } }, label);
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: () => { chosen = null; pickSel = null; renderRouteSetup(el, back); } }, '‹ Level'),
    h('div.bs-head', h('h2', `🛤 Level ${chosen.n} · ${chosen.name}`), picker.count),
    h('div.d-theme', h('b', 'Gegner: '), h('span.type-chips.inline', chosen.types.map((t) => typeChip(t))), h('small', ` · ${chosen.waves} Wellen`)),
    h('p.note', `✦ = empfohlen (verschiedene Angriffsformen, stark gegen diese Gegner). Antippen zum Tauschen, ☆ markiert Favoriten. Bis zu ${N} Pokémon kommen aufs Feld.`),
    h('div.r-sort', h('small', 'Sortieren:'), sortBtn('level', 'Level'), sortBtn('shape', 'Angriffsform')),
    picker.tools, picker.grid));
}
function renderLevels(el, back) {
  const L = routeLevels(), done = st().cleared || 0, open = A.routeUnlocked(app.state), need = R().unlockWaves || 0, W = st().waves || {};
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: back }, '‹ Zurück'),
    h('div.bs-head', h('h2', '🛤 Route'), h('span.bs-count', `${done}/${L.length} geschafft`)),
    h('p.note', `Wilde Pokémon laufen eine feste Route entlang. Setz deine Pokémon auf die Bauplätze daneben. Besiegte Gegner bringen EP – damit trainierst du deine Pokémon dauerhaft (auch in den Arealen). EP: ${st().ep || 0}`),
    h('div.route-levels', L.map((lv) => {
      const state = lv.n > open ? 'locked' : lv.n <= done ? 'done' : 'next';
      const prog = lv.n === open + 1 ? h('small.rl-prog', `${Math.min(need, W[open] || 0)}/${need} Wellen in Lv ${open}`) : null;
      return h('button.route-lv.' + state, { onclick: () => {
        if (state === 'locked') { toast(`Schaffe zuerst ${need} Wellen in Level ${lv.n - 1} (bisher ${W[lv.n - 1] || 0}).`); return; }
        chosen = lv; pickSel = null; haptic('tick'); renderRouteSetup(el, back); el.scrollTop = 0;
      } }, h('b', state === 'done' ? '✓ ' + lv.n : String(lv.n)), h('small', lv.name), h('span.road-types', lv.types.map((t) => h('i', { style: { background: typeColor(t) } }))), prog);
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
  game.buffOf = (m) => physBuff(app.state, { uid: m.uid, dex: m.dex }, now()); // Felsbrecher-Buff
  game.itemOf = (m) => fxOf(app.state, { uid: m.uid, dex: m.dex }); // getragenes Item
  openField();
}

// ================= Spielfeld =================
function openField() {
  closeField();
  const canvas = h('canvas.arena-canvas');
  const bar = h('div.r-bar'), info = h('div.d-info'), msg = h('div.b-msg');
  const livesEl = h('span.r-stat'), epEl = h('span.r-stat'), waveEl = h('div.d-wave', h('span'), h('div.d-wavebar', h('i')));
  const go = h('button.btn.primary.big.d-go', { onclick: () => { go.remove(); game.started = true; message('Los! Halte die wilden Pokémon auf.'); haptic('medium'); } }, 'Los!');
  const top = h('div.b-top', livesEl, waveEl, epEl, h('button.b-btn', { onclick: pauseMenu, title: 'Pause' }, '⏸'), h('button.b-btn', { onclick: giveUp, title: 'Aufgeben' }, '🏳'));
  const root = h('div.battle.defense.route', top, h('div.b-field', canvas, go), info, bar, msg);
  document.body.append(root);
  document.body.classList.add('in-battle');
  setMusic(musicForLevel(game.level.types));
  ui = { root, canvas, ctx: canvas.getContext('2d'), bar, info, msg, livesEl, epEl, waveEl, sel: null, selUnit: null, fx: [], texts: [], beams: [], waves: [], last: performance.now(), raf: 0 };
  for (const m of game.team) loadSprites(m.dex, m.gender);
  // Gebiet je Level nach Gegner-Typ (Wald, Kirschblüte, Herbst, Schnee, Strand, Nachtwald – tiles2.json)
  ui.themeId = themeForType(game.level.types[0]);
  const ti = tilesImage(); if (!ti.complete) ti.addEventListener('load', () => { if (ui) ui.bg = null; }, { once: true }); ui.tiles = ti;
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
  const m = Math.floor((fit * dpr) / 16), tile = m >= 1 ? (16 * m) / dpr : Math.floor(fit); // ganzzahlige Pixel (16-px-Tileset)
  const snap = (v) => Math.round(v * dpr) / dpr;
  Object.assign(ui, { dpr, w: r.width, h: r.height, tile, ox: snap((r.width - tile * G.cols) / 2), oy: snap((r.height - tile * G.rows) / 2), bg: null });
}
function frame(dt) {
  if (!ui || !game) return;
  if (!ui.paused) game.update(dt); // Pause: Kampf steht still
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
  if (u) { ui.sel = null; dragPlaced(e, u); return; } // ziehen = verschieben, antippen = Trainieren/Zurücknehmen
  if (!ui.sel) { toast('Wähle unten ein Pokémon und tippe dann auf einen Bauplatz.'); return; }
  if (game.units.length >= game.max) { toast(`Höchstens ${game.max} Pokémon gleichzeitig auf dem Feld.`); return; }
  const sm = game.team.find((x) => x.uid === ui.sel);
  if (sm && !game.slotAllows(si, sm.dex)) { toast(WATER_ONLY); return; }
  if (game.place(ui.sel, si)) { haptic('medium'); sfx.place(); ui.sel = null; buildBar(); renderInfo(); }
}
// Kann dieses Pokémon gerade trainiert werden? (genug EP, Tageslimit nicht erreicht)
function trainState(m) {
  const cost = upgradeCost(m.level), have = (st().ep || 0) + (game?.ep || 0);
  const today = st().day === dayKey(now()) ? st().today?.[m.uid] || 0 : 0, left = Math.max(0, R().upgrade.dailyPerPokemon - today);
  return { cost, have, left, ok: have >= cost && left > 0 && (!CFG.balance.level.max || m.level < CFG.balance.level.max) };
}
// Was ein Level mehr bringt: Tempo, Wucht (Angriffswert × Levelfaktor der Schadensformel), Radius
function trainPreview(m) {
  const L = m.level, mv = moveOf(bdata(m.dex).move), k = mv.cat === 'phys' ? 1 : 3;
  const wucht = (lv) => Math.floor((2 * lv) / 5 + 2) * calcStats(m.dex, lv, m.ivs, m.evs)[k];
  const pct = (a, b) => `+${Math.max(0, Math.round((b / a - 1) * 100))} %`;
  const rows = [['Tempo', pct(levelSpeed(L), levelSpeed(L + 1))], ['Wucht', pct(wucht(L), wucht(L + 1))]];
  if (shapeOf(m.dex) === 'circle') rows.push(['Radius', `${radiusOf(L).toFixed(2)} → ${radiusOf(L + 1).toFixed(2)} Felder`]);
  if (shapeOf(m.dex) === 'ring') rows.push(['Ring außen', `${ringOuter(L).toFixed(2)} → ${ringOuter(L + 1).toFixed(2)} Felder`]);
  return h('div.r-preview', h('b', `Lv ${L} → ${L + 1}`), ...rows.map(([a, b]) => h('span', h('i', a), b)));
}
// Platziertes Pokémon: trainieren (EP, dauerhaft) oder zurück in die Leiste
function unitMenu(u) {
  const p = app.state.pokemon.find((q) => q.uid === u.uid), T = trainState(u), cost = T.cost;
  const sh = R().shapes[u.shape];
  modal((m, close) => {
    m.append(h('h3', `${u.nick || species(u.dex).name} · Lv ${u.level}`),
      h('p.note', `${sh.icon} ${sh.name}: ${SHAPE_TEXT[u.shape]}${u.shape === 'circle' ? ` (Radius ${radiusOf(u.level).toFixed(1)} Felder)` : ''}.`),
      trainPreview(u),
      h('p.note', `Das Level bleibt dauerhaft – auch in den Arealen. Kosten: ${cost} EP (du hast ${T.have}). Heute noch ${T.left}× möglich.`),
      h('div.row',
        h('button.btn', { onclick: () => { close(); if (game.unplace(u)) { ui.selUnit = null; buildBar(); renderInfo(); } } }, 'Zurück in die Leiste'),
        h('button.btn.primary' + (T.ok ? '' : '.dim'), { onclick: () => { close(); train(u, p, cost); } }, `⬆ Trainieren (${cost} EP)`)));
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
  buildBar();
  haptic('medium'); sfx.levelUp();
  message(`${u.nick || species(u.dex).name} ist jetzt Level ${u.level}!`);
}

// Leiste unten: Team; platzierte Pokémon sind abgeblendet
function buildBar() {
  ui.bar.replaceChildren(...game.team.map((m) => {
    const placed = !!game.placed(m.uid), sh = R().shapes[shapeOf(m.dex)];
    const el = h('button.r-mon' + (placed ? '.placed' : '') + (ui.sel === m.uid ? '.sel' : ''), { onclick: () => {
      if (performance.now() - (ui.dragEnd || 0) < 300) return;
      if (placed) { unitMenu(game.placed(m.uid)); return; }
      ui.sel = ui.sel === m.uid ? null : m.uid; ui.selUnit = null; haptic('tick'); buildBar(); renderInfo();
    } }, h('img', { src: portraitUrl(m.dex), alt: '' }), h('span.r-shape', sh.icon), h('small', `Lv ${m.level}`),
    trainState(m).ok ? h('span.r-up', { title: 'Genug EP zum Trainieren' }, '⬆') : null);
    if (!placed) el.addEventListener('pointerdown', (e) => dragFromBar(e, m));
    return el;
  }), h('span.r-count', `${game.units.length}/${game.max}`));
}
// Pokémon aus der Leiste aufs Feld ziehen: über einem freien Bauplatz zeigt das Feld, wo es angreifen wird
function dragFromBar(e, m) {
  if (!game || game.over) return;
  const sx = e.clientX, sy = e.clientY;
  let ghost = null;
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 12) return;
    if (!ghost) { ghost = h('img.d-ghost', { src: portraitUrl(m.dex), alt: '' }); document.body.append(ghost); ui.sel = m.uid; ui.selUnit = null; renderInfo(); }
    ghost.style.transform = `translate(${ev.clientX - 26}px, ${ev.clientY - 40}px)`;
    const c = cellAt(ev.clientX, ev.clientY), si = c ? slotAt(c) : -1;
    ui.drag = si >= 0 && game.slotFree(si) && game.slotAllows(si, m.dex) ? previewUnit(m, si) : null;
    ui.dragBad = si >= 0 && game.slotFree(si) && !game.slotAllows(si, m.dex) ? si : -1; // Seerose, aber kein Wasser-Pokémon
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (!ghost || !ui) return;
    ghost.remove(); ui.dragEnd = performance.now();
    const d = ui.drag, bad = ui.dragBad; ui.drag = null; ui.dragBad = -1;
    if (bad >= 0 && ev.type === 'pointerup') { toast(WATER_ONLY); ui.sel = null; buildBar(); renderInfo(); return; }
    if (ev.type !== 'pointerup' || !d) { ui.sel = null; buildBar(); renderInfo(); return; }
    if (game.units.length >= game.max) { toast(`Höchstens ${game.max} Pokémon gleichzeitig auf dem Feld.`); return; }
    if (game.place(m.uid, d.slot)) { haptic('medium'); sfx.place(); ui.sel = null; buildBar(); renderInfo(); }
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
// platziertes Pokémon auf einen anderen Bauplatz ziehen (mit Reichweiten-Vorschau); nur antippen öffnet das Menü
function dragPlaced(e, u) {
  const sx = e.clientX, sy = e.clientY;
  let ghost = null;
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 12) return;
    if (!ghost) { ghost = h('img.d-ghost', { src: portraitUrl(u.dex), alt: '' }); document.body.append(ghost); ui.selUnit = null; ui.moving = u; }
    ghost.style.transform = `translate(${ev.clientX - 26}px, ${ev.clientY - 40}px)`;
    const c = cellAt(ev.clientX, ev.clientY), si = c ? slotAt(c) : -1;
    const m = { dex: u.dex, level: u.level };
    const other = si >= 0 && si !== u.slot ? game.units.find((o) => o !== u && o.slot === si) : null;
    const okSwap = other && game.slotAllows(si, u.dex) && game.slotAllows(u.slot, other.dex);
    ui.drag = si >= 0 && ((game.slotFree(si) && game.slotAllows(si, u.dex)) || okSwap) ? previewUnit(m, si) : null;
    ui.dragBad = si >= 0 && ((game.slotFree(si) && !game.slotAllows(si, u.dex)) || (other && !okSwap)) ? si : -1;
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (!ui) return;
    if (!ghost) { if (ev.type === 'pointerup') { ui.selUnit = u; renderInfo(); unitMenu(u); } return; } // nur angetippt
    ghost.remove(); ui.moving = null;
    const d = ui.drag, bad = ui.dragBad; ui.drag = null; ui.dragBad = -1;
    if (ev.type !== 'pointerup') return;
    if (bad >= 0) { toast(WATER_ONLY); return; }
    const other = d && game.units.find((o) => o !== u && o.slot === d.slot);
    if (other) { if (game.swapUnits(u, other)) { haptic('medium'); sfx.place(); ui.selUnit = u; renderInfo(); } return; }
    if (d && game.moveUnit(u, d.slot)) { haptic('medium'); sfx.place(); ui.selUnit = u; renderInfo(); }
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
// gedachtes Pokémon auf einem Bauplatz (für die Reichweiten-Vorschau)
function previewUnit(m, slot) {
  const [c, r] = game.level.slots[slot], u = { x: c + 0.5, y: r + 0.5, shape: shapeOf(m.dex), level: m.level, slot };
  u.face = game.bestFacing(u);
  return u;
}
function renderInfo() {
  const m = ui.sel ? game.team.find((x) => x.uid === ui.sel) : ui.selUnit;
  if (!m) { ui.info.replaceChildren(h('small', 'Pokémon unten antippen, dann einen Bauplatz. Platzierte Pokémon antippen = trainieren.')); return; }
  const sh = shapeOf(m.dex), mv = moveOf(bdata(m.dex).move);
  ui.info.replaceChildren(h('b', m.nick || species(m.dex).name), h('span.type-chips.inline', species(m.dex).types.map((t) => typeChip(t))),
    h('small', `${R().shapes[sh].icon} ${R().shapes[sh].name}: ${SHAPE_TEXT[sh]} · ${mv.name} (${mv.cat === 'phys' ? 'physisch' : 'speziell'})${R().status?.byType?.[mv.type] ? ' · ' + R().status.byType[mv.type].name : ''}`));
}
function renderTop() {
  const w = game.progress(), k = `${game.lives}|${w.wave}|${game.ep}|${(st().ep || 0) + game.ep}`;
  if (ui.topKey === k) return;
  if (ui.topKey && ui.topKey.split('|')[3] !== String(st().ep)) buildBar(); // EP-Stand geändert: ⬆-Zeichen aktualisieren
  ui.topKey = k;
  ui.livesEl.textContent = `♥ ${game.lives}`;
  ui.epEl.textContent = `EP ${(st().ep || 0) + game.ep}`;
  ui.waveEl.firstChild.textContent = w.wave ? `Welle ${w.wave}/${w.total}` : 'Vorbereitung';
  ui.waveEl.lastChild.firstChild.style.width = (w.wave / w.total) * 100 + '%';
}
function message(text) { const el = h('div', text); ui.msg.append(el); setTimeout(() => el.remove(), 2600); }

// ---------- Zeichnen ----------
// Gelände der Karte: Route, Bauplatz-Lichtungen und Teich-Ufer = Boden (F), Teich = Wasser (A), alles andere = Wand (W, Bäume)
function terrainAt() {
  const G = R().grid, cells = new Map(), k = (x, y) => x + ',' + y;
  for (const [x, y] of pathCells(game.level.path)) cells.set(k(x, y), 'F');
  for (const [x, y] of game.level.slots) cells.set(k(x, y), 'F');
  for (const [x, y] of game.level.water || []) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!cells.has(k(nx, ny)) && nx >= 0 && nx < G.cols && ny >= 0 && ny < G.rows) cells.set(k(nx, ny), 'F'); // Ufer
  }
  for (const [x, y] of game.level.water || []) cells.set(k(x, y), 'A');
  const first = game.level.path[0], last = game.level.path[game.level.path.length - 1];
  return (x, y) => cells.get(k(x, y)) || ((x === first[0] && y < 0) || (x === last[0] && y >= G.rows) ? 'F' : 'W');
}
// erwartete Ränder (N, NO, O, SO, S, SW, W, NW): eigenes Gelände, wenn der Nachbar dazugehört, sonst Boden
export function expectedEdges(tAt, x, y) {
  const t = tAt(x, y);
  if (t === 'F') return 'FFFFFFFF';
  const same = (dx, dy) => tAt(x + dx, y + dy) === t;
  const o = (dx, dy) => (same(dx, dy) ? t : 'F'), corner = (dx, dy) => (same(dx, 0) && same(0, dy) && same(dx, dy) ? t : 'F');
  return o(0, -1) + corner(1, -1) + o(1, 0) + corner(1, 1) + o(0, 1) + corner(-1, 1) + o(-1, 0) + corner(-1, -1);
}
// passende Kachel: wenigste abweichende Ränder; unter gleich guten zufällig (fest je Feld) – so wiederholt sich nichts sichtbar
export function pickTile(tiles, t, exp, h) {
  let best = [], bs = 99;
  for (const k of tiles) {
    if (k.t !== t || (k.x && exp === t.repeat(8))) continue;
    let sc = 0; for (let i = 0; i < 8; i++) if (k.m[i] !== exp[i]) sc += i % 2 ? 1 : 2;
    if (sc < bs) { bs = sc; best = [k]; } else if (sc === bs) best.push(k);
  }
  return best.length ? best[h % best.length] : null;
}
// Hintergrund aus dem 16-px-Tileset (gfx/tiles2.js): Weg, Teiche, Wald ringsum, Deko; darauf Seerosen (Wasser-Plätze)
// und Holzpodeste (Bauplätze) – alles in Original-Pixelgröße gezeichnet und ganzzahlig vergrößert
function buildBackground() {
  const U = ui, G = R().grid, S = 16;
  const c = document.createElement('canvas');
  c.width = Math.round(U.w * U.dpr); c.height = Math.round(U.h * U.dpr);
  const Dp = Math.round(U.tile * U.dpr), ox = Math.round(U.ox * U.dpr), oy = Math.round(U.oy * U.dpr);
  const c0 = Math.floor(-ox / Dp) - 1, r0 = Math.floor(-oy / Dp) - 1, c1 = Math.ceil((c.width - ox) / Dp), r1 = Math.ceil((c.height - oy) / Dp);
  const k = (x, y) => x + ',' + y, cells = new Map();
  for (const [x, y] of game.level.water || []) cells.set(k(x, y), 'A');
  for (const [x, y] of pathCells(game.level.path)) cells.set(k(x, y), 'P');
  for (const [x, y, w] of game.level.slots) if (w !== 'w') cells.set(k(x, y), 'X');
  for (const [x, y] of game.level.water || []) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!cells.has(k(x + dx, y + dy))) cells.set(k(x + dx, y + dy), 'F'); // Ufer
  // Bauplätze bekommen eine kleine Lichtung, damit der Wald sie nicht verdeckt
  for (const [x, y, w] of game.level.slots) if (w !== 'w') for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) if (!cells.has(k(x + dx, y + dy))) cells.set(k(x + dx, y + dy), 'F');
  const first = game.level.path[0], last = game.level.path[game.level.path.length - 1];
  const cellAt = (x, y) => cells.get(k(x, y)) || ((x === first[0] && y < 0) || (x === last[0] && y >= G.rows) || (y === first[1] && x < 0 && first[0] <= 0) || (y === last[1] && x >= G.cols && last[0] >= G.cols - 1) ? 'P' : 'W');
  const lo = renderTerrain({ c0, r0, c1, r1, cellAt, theme: U.themeId, seed: game.level.n * 31 + 7 });
  const x = lo.getContext('2d'); x.imageSmoothingEnabled = false;
  const X = (col) => (col - c0) * S, Y = (r) => (r - r0) * S;
  const P = (px, py, color) => { x.fillStyle = color; x.fillRect(px, py, 1, 1); };
  // Seerosen (nur Wasser-Pokémon): grünes Blatt mit Kerbe und kleiner Blüte
  for (const [a, b, w] of game.level.slots) {
    if (w !== 'w') continue;
    const cx = X(a) + 8, cy = Y(b) + 8;
    for (let yy = -6; yy <= 6; yy++) for (let xx = -7; xx <= 7; xx++) {
      const d = (xx * xx) / 49 + (yy * yy) / 36;
      if (d > 1 || (xx > 0 && Math.abs(yy) < xx / 3)) continue; // Kerbe nach rechts
      P(cx + xx, cy + yy, d > 0.75 ? '#2e6b2a' : (xx + yy) % 5 === 0 ? '#5fae45' : '#4f9a3a');
    }
    x.fillStyle = 'rgba(10,30,60,.3)'; x.fillRect(cx - 6, cy + 6, 12, 1);
    x.fillStyle = '#ffb3d0'; x.fillRect(cx - 4, cy - 4, 2, 2); x.fillStyle = '#fff0f6'; x.fillRect(cx - 4, cy - 4, 1, 1);
  }
  // Bauplätze: Holzpodeste aus Brettern mit Nägeln, Kontur und Schatten
  for (const [a, b, w] of game.level.slots) {
    if (w === 'w') continue;
    const L = X(a) + 1, T0 = Y(b) + 1, W = 14, H = 13;
    x.fillStyle = 'rgba(20,30,10,.35)'; x.fillRect(L + 1, T0 + 2, W, H);
    x.fillStyle = '#4a2f1c'; x.fillRect(L, T0, W, H);
    for (let q = 0; q < 3; q++) {
      const by = T0 + 1 + q * 4;
      x.fillStyle = q % 2 ? '#b07842' : '#c08a4e'; x.fillRect(L + 1, by, W - 2, 4);
      x.fillStyle = '#d7a466'; x.fillRect(L + 1, by, W - 2, 1);
      x.fillStyle = '#7b4e29'; x.fillRect(L + 1, by + 3, W - 2, 1);
      x.fillStyle = '#e8d2a6'; x.fillRect(L + 2, by + 1, 1, 1); x.fillRect(L + W - 3, by + 1, 1, 1);
    }
  }
  const out = c.getContext('2d'); out.imageSmoothingEnabled = false;
  out.drawImage(lo, 0, 0, lo.width, lo.height, ox + c0 * Dp, oy + r0 * Dp, lo.width * (Dp / S), lo.height * (Dp / S));
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
  if (U.sel || U.moving) {
    x.strokeStyle = '#fff'; x.lineWidth = 2;
    const selDex = U.moving ? U.moving.dex : game.team.find((m) => m.uid === U.sel)?.dex;
    game.level.slots.forEach(([a, b], i) => { if (game.slotFree(i) && game.slotAllows(i, selDex)) { const k = 1 + Math.sin(now2 / 180) * 1.5; x.strokeRect(U.ox + a * T + 3 - k, U.oy + b * T + 3 - k, T - 6 + 2 * k, T - 6 + 2 * k); } });
  }
  if (U.dragBad >= 0) { const [a, b] = game.level.slots[U.dragBad]; x.strokeStyle = 'rgba(255,80,80,.95)'; x.lineWidth = 3; x.strokeRect(U.ox + a * T + 1.5, U.oy + b * T + 1.5, T - 3, T - 3); }
  // Reichweite: beim Ziehen (Vorschau) bzw. des angetippten Pokémon
  const show = U.drag || (U.selUnit && game.units.includes(U.selUnit) ? U.selUnit : null);
  if (show) {
    x.fillStyle = U.drag ? 'rgba(130,220,255,.32)' : 'rgba(255,240,150,.26)';
    for (const [a, b] of reachCells(show)) x.fillRect(U.ox + a * T + 1, U.oy + b * T + 1, T - 2, T - 2);
    const rings = show.shape === 'circle' ? [radiusOf(show.level)] : show.shape === 'ring' ? [R().shapes.ring.inner, ringOuter(show.level)] : [];
    if (rings.length) { x.strokeStyle = U.drag ? 'rgba(160,230,255,.9)' : 'rgba(255,240,150,.9)'; x.lineWidth = 2; x.setLineDash([4, 3]); for (const rr of rings) { x.beginPath(); x.arc(U.ox + show.x * T, U.oy + show.y * T, rr * T, 0, 7); x.stroke(); } x.setLineDash([]); }
    if (U.drag) { const [a, b] = game.level.slots[U.drag.slot]; x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeRect(U.ox + a * T + 1.5, U.oy + b * T + 1.5, T - 3, T - 3); }
  }
  const all = [...game.units.map((o) => ({ o, mine: true })), ...game.enemies.map((o) => ({ o, mine: false }))].sort((a, b) => a.o.y - b.o.y);
  for (const { o, mine } of all) drawMon(x, o, mine, P(o), T, now2);
  // Fernschüsse
  for (const s of game.shots) { const [X, Y] = P(s), q = Math.max(4, T / 7); x.fillStyle = '#fff'; x.fillRect(X - q / 2 - 1, Y - q / 2 - 1, q + 2, q + 2); x.fillStyle = typeColor(s.type); x.fillRect(X - q / 2, Y - q / 2, q, q); }
  // Gerade und Kreuz: Strahlen breiten sich vom Pokémon aus in alle Arm-Richtungen gleichzeitig aus
  U.beams = U.beams.filter((b) => {
    b.t += dt; if (b.t > 0.3) return false;
    const reach = Math.min(1, b.t / 0.12) * 9;
    x.globalAlpha = 1 - Math.max(0, b.t - 0.12) / 0.18; x.fillStyle = b.color;
    for (const [a, c] of b.cells) {
      const d = Math.max(Math.abs(a + 0.5 - b.from.x), Math.abs(c + 0.5 - b.from.y));
      if (d > reach) continue;
      x.fillRect(U.ox + a * T + T * 0.28, U.oy + c * T + T * 0.28, T * 0.44, T * 0.44);
      x.fillStyle = '#ffffff'; x.fillRect(U.ox + a * T + T * 0.42, U.oy + c * T + T * 0.42, T * 0.16, T * 0.16); x.fillStyle = b.color;
    }
    x.globalAlpha = 1;
    return true;
  });
  // Radius: Ring-Welle, die sich bis zum Rand des Kreises ausbreitet
  U.waves = U.waves.filter((wv) => {
    wv.t += dt; if (wv.t > 0.45) return false;
    const k = wv.t / 0.45, X = U.ox + wv.x * T, Y = U.oy + wv.y * T, r0 = (wv.r0 || 0) / wv.r, rr = wv.r * T * (Math.max(0.2, r0) + (1 - Math.max(0.2, r0)) * Math.min(1, k * 1.4));
    x.globalAlpha = 1 - k; x.strokeStyle = wv.color; x.lineWidth = Math.max(3, T / 8) * (1 - k * 0.5);
    x.beginPath(); x.arc(X, Y, rr, 0, 7); x.stroke();
    x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(1, T / 20); x.beginPath(); x.arc(X, Y, rr * 0.92, 0, 7); x.stroke();
    x.fillStyle = wv.color; x.globalAlpha = 0.12 * (1 - k); x.beginPath(); x.arc(X, Y, rr, 0, 7); if (wv.r0) x.arc(X, Y, wv.r0 * T, 0, 7, true); x.fill('evenodd');
    x.globalAlpha = 1;
    return true;
  });
  drawParticles(x, U.fx, dt, U.ox, U.oy, T, now2);
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
  let s = T / 34; if (e.anims.Idle.fh * s > T * 1.3) s = (T * 1.3) / e.anims.Idle.fh; // etwas kleiner als im PokeDefense
  if (o.boss) s *= 1.35;
  if (o.hp <= 0) x.globalAlpha = 0.4;
  x.fillStyle = 'rgba(30,40,20,.28)'; x.beginPath(); x.ellipse(X, Y + T * 0.25, T * 0.3, T * 0.1, 0, 0, 7); x.fill();
  x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(X - (f.fw * s) / 2), Math.round(Y - T * 0.05 - (f.fh * s) / 2), Math.round(f.fw * s), Math.round(f.fh * s));
  x.globalAlpha = 1;
  if (mine) { // Level-Schild
    x.font = `600 ${Math.round(T * 0.2)}px 'Ziffern', 'Pixelify Sans', sans-serif`; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = 'rgba(40,25,20,.9)';
    x.strokeText('Lv' + o.level, X, Y + T * 0.46); x.fillStyle = '#fff6c0'; x.fillText('Lv' + o.level, X, Y + T * 0.46);
    if (trainState(o).ok) upArrow(x, X + T * 0.34, Y - T * 0.34, T, now2); // genug EP zum Trainieren
  } else if (o.hp > 0) drawStatus(x, o, X, Y, T, now2);
  if (!mine && o.hp > 0 && (o.hp < o.maxHp || o.boss)) {
    const bw = T * (o.boss ? 1 : 0.6), bh = Math.max(3, T / 14), by = Y - T * 0.5;
    x.fillStyle = '#2f2622'; x.fillRect(X - bw / 2 - 1, by - 1, bw + 2, bh + 2);
    x.fillStyle = o.boss ? '#ffb02e' : '#ef5d5d'; x.fillRect(X - bw / 2, by, (bw * o.hp) / o.maxHp, bh);
  }
}
// Statuseffekte am Gegner: Flämmchen, Giftblasen, Funken (Paralyse), „z“ (Schlaf), blauer Schimmer (Verlangsamung)
function drawStatus(x, o, X, Y, T, now2) {
  const q = Math.max(2, Math.round(T / 14)), t = game.t;
  if (o.dots?.burn && Math.random() < 0.25) burst({ x: o.x, y: o.y - 0.1 }, 'Feuer', 1, 0.3, 0.8, 0.4);
  if (o.dots?.poison && Math.random() < 0.2) burst({ x: o.x, y: o.y - 0.1 }, 'Gift', 1, 0.3, 0.8, 0.4);
  if (t < (o.stunUntil || 0) && Math.floor(now2 / 90) % 2) { x.fillStyle = '#ffe066'; for (let i = 0; i < 3; i++) { const a = now2 / 120 + i * 2.1; x.fillRect(X + Math.cos(a) * T * 0.3, Y - T * 0.45 + Math.sin(a) * T * 0.08, q, q * 2); } }
  if (t < (o.sleepUntil || 0)) { x.font = `600 ${Math.round(T * 0.26)}px 'Ziffern', 'Pixelify Sans', sans-serif`; x.textAlign = 'center'; const k = (now2 / 900) % 1; x.globalAlpha = 1 - k; x.lineWidth = 2; x.strokeStyle = 'rgba(30,30,60,.8)'; x.strokeText('z', X + T * (0.2 + k * 0.2), Y - T * (0.4 + k * 0.4)); x.fillStyle = '#e8f0ff'; x.fillText('z', X + T * (0.2 + k * 0.2), Y - T * (0.4 + k * 0.4)); x.globalAlpha = 1; }
  if (t < (o.slowUntil || 0)) { x.fillStyle = 'rgba(120,190,255,.35)'; x.beginPath(); x.ellipse(X, Y + T * 0.2, T * 0.32, T * 0.12, 0, 0, 7); x.fill(); }
}
// kleiner grüner Pixel-Pfeil (pulsiert): dieses Pokémon kann trainiert werden
function upArrow(x, X, Y, T, now2) {
  const q = Math.max(2, Math.round(T / 16)), b = Math.round(Math.sin(now2 / 220) * q * 0.6);
  const px = [[0, -2], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [0, 1], [0, 2]];
  x.fillStyle = 'rgba(25,40,20,.9)'; for (const [i, j] of px) x.fillRect(Math.round(X + i * q - q), Math.round(Y + b + j * q - q), q * 3, q * 3);
  x.fillStyle = '#7dff6a'; for (const [i, j] of px) x.fillRect(Math.round(X + i * q), Math.round(Y + b + j * q), q, q);
}
const say = (o, text, color, size = 0.3, dur = 0.8) => ui.texts.push({ x: o.x, y: o.y - 0.4, text, color, size, dur, t: 0 });
// Partikel nach Typ (Tropfen, Flämmchen, Blitze, Blätter …); Farbe-Variante für EP/Level/Platzieren
const burst = (o, type, n, power = 1, size = 1, spread = 0) => typeBurst(ui.fx, o, type, n, power, size, spread);
// Angriffseffekte je Form: Partikel entlang der Strahlen, rund um Welle/Ring, Hieb-Funken beim Nahkampf
function attackFx(u, type) {
  if (u.shape === 'line' || u.shape === 'cross') for (const [a, b] of reachCells(u)) burst({ x: a + 0.5, y: b + 0.5 }, type, 3, 0.6, 1.25, 0.6);
  else if (u.shape === 'circle' || u.shape === 'ring') {
    const r = u.shape === 'ring' ? ringOuter(u.level) : radiusOf(u.level), n = Math.round(14 + r * 9);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; burst({ x: u.x + Math.cos(a) * r * 0.9, y: u.y + Math.sin(a) * r * 0.9 + 0.1 }, type, 1, 0.5, 1.3); }
  } else { const t = u.lookAt || u; burst({ x: (u.x + t.x) / 2, y: (u.y + t.y) / 2 + 0.1 }, type, 12, 1.3, 1.3); }
  burst(u, type, 4, 0.6, 0.7); // kleiner Ausbruch am Angreifer
}
function handleEvents() {
  for (const ev of game.events) {
    if (ev.type === 'attack') {
      const u = ev.u, color = typeColor(moveOf(bdata(u.dex).move).type);
      u.lookAt = ev.target;
      if (u.shape === 'line' || u.shape === 'cross') ui.beams.push({ cells: reachCells(u), color, t: 0, from: u });
      if (u.shape === 'circle') ui.waves.push({ x: u.x, y: u.y, r: radiusOf(u.level), color, t: 0 });
      if (u.shape === 'ring') ui.waves.push({ x: u.x, y: u.y, r: ringOuter(u.level), r0: R().shapes.ring.inner, color, t: 0 });
      attackFx(u, moveOf(bdata(u.dex).move).type);
      sfx.attack(moveOf(bdata(u.dex).move).type);
    } else if (ev.type === 'hit') {
      const col = ev.crit ? '#ffe066' : ev.eff > 1 ? '#ffd23f' : ev.eff < 1 ? '#d0c8bc' : '#ffffff';
      say(ev.e, String(ev.dmg), col, ev.crit || ev.eff > 1 ? 0.38 : 0.3); burst(ev.e, ev.move.type, ev.crit ? 18 : 9, ev.crit ? 1.5 : 1.1, ev.crit ? 1.6 : 1.25); sfx.hit();
    } else if (ev.type === 'status') { say(ev.e, ev.name + '!', { burn: '#ffa75c', poison: '#d48ae0', paralysis: '#ffe066', sleep: '#cfe0ff', slow: '#9fd0ff' }[ev.kind], 0.22, 0.9); }
    else if (ev.type === 'dot') { say(ev.e, String(ev.dmg), ev.kind === 'burn' ? '#ffa75c' : '#d48ae0', 0.22, 0.6); }
    else if (ev.type === 'defeat') { say(ev.e, `+${ev.ep} EP`, ev.lucky ? '#ffd23f' : '#9fe8ff', ev.lucky ? 0.36 : 0.26, ev.lucky ? 1.4 : 1); burst(ev.e, species(ev.e.dex).types[0], 14, 1.4, 1.1); if (ev.lucky) burst(ev.e, 'Fee', 22, 1.6, 1.2); sfx.ko(); if (ev.lucky) sfx.star(); }
    else if (ev.type === 'leak') { message(`Ein wildes Pokémon ist durchgekommen! Noch ${game.lives} ♥`); haptic('strong'); sfx.lose(); }
    else if (ev.type === 'wave') { message(ev.last ? 'Letzte Welle – mit Boss!' : `Welle ${ev.wave + 1}`); sfx.wave(ev.last); haptic('medium'); }
    else if (ev.type === 'boss') { message('Ein Boss erscheint!'); haptic('strong'); }
    else if (ev.type === 'level') { say(ev.u, `Lv ${ev.u.level}!`, '#ffd23f', 0.32, 1); burst(ev.u, 'Fee', 18, 1.3, 1.1); burst(ev.u, 'Elektro', 8, 1); }
    else if (ev.type === 'place') burst(ev.u, 'Boden', 10, 1, 0.9);
  }
  game.events.length = 0;
}

// Pause: alles steht still; weiter oder Level verlassen (verdiente EP bleiben)
function pauseMenu() {
  if (!game || game.over || !ui || ui.paused) return;
  ui.paused = true;
  commitEp();
  modal((m, close) => {
    const resume = () => { close(); if (ui) ui.paused = false; };
    m.append(h('h3', '⏸ Pause'), h('p.note', 'Der Kampf ist angehalten. Deine bisher verdienten EP sind gesichert.'),
      h('div.row', h('button.btn', { onclick: () => { close(); if (ui) ui.paused = false; game.over = { won: false, gaveUp: true }; } }, 'Level verlassen'),
        h('button.btn.primary.big', { onclick: resume }, '▶ Weiter')), routeStats());
    $('#modal').onclick = (e) => { if (e.target === $('#modal')) resume(); };
  });
}
// Schadensübersicht: Karte nur über den Bereich der Bauplätze
function routeStats() {
  const S = game.level.slots, cs = S.map((s) => s[0]), rs = S.map((s) => s[1]);
  const at = new Map(S.map(([c, r], i) => [c + ',' + r, i]));
  return damageStats({ units: game.units, cells: game.slotDmg, grid: { c0: Math.min(...cs), c1: Math.max(...cs), r0: Math.min(...rs), r1: Math.max(...rs) }, t: game.t, recent: game.recentDmg, cellOf: (c, r) => at.get(c + ',' + r) ?? null });
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
  const before = A.routeUnlocked(app.state);
  app.act((s) => A.routeWaves(s, lv.n, won ? lv.waves : Math.max(0, game.wave)), true); // geschaffte Wellen dieses Versuchs
  const unlockedNow = A.routeUnlocked(app.state) > before;
  const earned = game.ep;
  commitEp();
  if (won) sfx.win(); else sfx.lose();
  const next = routeLevels().find((x) => x.n === lv.n + 1 && x.n <= A.routeUnlocked(app.state));
  const wDone = st().waves?.[lv.n] || 0, need = R().unlockWaves || 0;
  const leave = (to) => { closeField(); game = null; chosen = to; app.refresh(); document.dispatchEvent(new Event('defense-closed')); };
  ui.root.append(h('div.b-result' + (won ? '.won' : ''),
    h('h2', won ? `Level ${lv.n} geschafft!` : 'Niederlage'),
    h('p', `${won ? `Bonus ${bonus} EP${first ? ' (erster Sieg)' : ''}. ` : game.over.gaveUp ? 'Du hast aufgegeben. ' : 'Zu viele wilde Pokémon sind durchgekommen. '}Verdient: ${earned} EP · Kontostand: ${st().ep} EP`),
    h('p.note', unlockedNow ? `🔓 Level ${lv.n + 1} ist jetzt freigeschaltet!` : routeLevels().some((x) => x.n === lv.n + 1) && lv.n + 1 > A.routeUnlocked(app.state) ? `Wellen in diesem Level: ${Math.min(wDone, need)}/${need} – dann öffnet sich Level ${lv.n + 1}.` : ''),
    h('div.row', h('button.btn', { onclick: () => leave(null) }, 'Level'),
      won && next ? h('button.btn.primary.big', { onclick: () => leave(next) }, `Level ${next.n} ›`) : h('button.btn.primary.big', { onclick: () => leave(lv) }, won ? 'Nochmal' : 'Nochmal versuchen'))));
}
// App im Hintergrund: verdiente EP sichern
document.addEventListener('visibilitychange', () => { if (document.hidden && game && !game.over) { commitEp(); if (game.started) pauseMenu(); } }); // App im Hintergrund: anhalten
