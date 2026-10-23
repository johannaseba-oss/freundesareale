// PokeDefense – Oberfläche: Team (6) mit Blick auf die angekündigten Gegner-Typen wählen (ohne Zeitlimit),
// dann das vertikale Spielfeld: Sterne einsammeln, Karten antippen und Pokémon auf das untere Feld setzen.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { Defense, roleOf, costOf, rechargeOf, abilityText, levelsList, loanerTeam, abilityOf } from '../game/defense.js';
import { ballCanvas, ballSprite } from '../gfx/balls.js';
import { fromPokemon, canBattle, moveOf, bdata } from '../game/battle.js';
import { typeColor, typeChip } from '../game/types.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { $, h, toast, confirmDialog, modal } from './dom.js';
import { teamPicker } from './teampick.js';
import { haptic } from '../haptics.js';
import { drawWeather } from './weatherfx.js';
import { sfx, setMusic, musicForLevel } from '../audio.js';
import { weatherInfo, weatherText, weatherBoost } from '../game/weather.js';

const D = () => CFG.defense;
const base = import.meta.env.BASE_URL;
let chosen = null; // gewähltes Level (defense_levels.json)
const cleared = () => app.state?.defense?.cleared || 0;
let pick = [];
let game = null;
let ui = null;
let chaosBestBefore = 0; // Rekord vor der laufenden Chaos-Runde (für „neuer Rekord!“)
let tourView = false; // Tournament-Run-Übersicht statt PokeDefense-Roadmap
const tourDone = () => app.state?.defense?.tournament || 0;

// Stern-Sprite (Platzhalter, bis ein eigener Stern bereitgestellt wird)
let starCv = null;
function starCanvas() {
  if (starCv) return starCv;
  const rows = ['....1....', '...121...', '...121...', '111222111', '122232221', '.1222221.', '..12121..', '.121.121.', '.11...11.'];
  const col = { 1: '#8a5a12', 2: '#ffd23f', 3: '#fff6b0' };
  starCv = document.createElement('canvas'); starCv.width = 9; starCv.height = 9;
  const x = starCv.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, i) => { if (col[ch]) { x.fillStyle = col[ch]; x.fillRect(i, y, 1, 1); } }));
  return starCv;
}
const ROLE_SHORT = { produzent: 'Sammler', explosiv: 'Explosiv', mauer: 'Mauer', nahkampf: 'Nahkampf', fernkampf: 'Fernkampf' };
const roleTag = (role) => h('span.role-tag.r-' + role, D().roles[role].icon + ' ' + ROLE_SHORT[role]);
const starImg = () => { const i = h('img.star-ico', { src: starCanvas().toDataURL(), alt: '★' }); return i; };

// ================= Vorbereitung =================
export function renderDefenseSetup(el, back) {
  if (tourView) { renderTournament(el, back); return; }
  if (!chosen) { renderRoadmap(el, back); return; }
  const s = app.state, theme = chosen.types;
  const mons = s.pokemon.filter((p) => canBattle(p.dex)).sort((a, b) => costOf(a.dex) - costOf(b.dex) || a.dex - b.dex);
  if (mons.length < D().teamSize) { renderRoadmap(el, back); offerLoaner(el, back); return; }
  const N = D().teamSize;
  // Rolle als farbiges Etikett, Kosten als schlichte Zahl in der Ecke (kein Stern – sonst sieht alles nach Sternensammler aus)
  const hint = (p) => [roleTag(roleOf(p.dex)), h('span.d-price', String(costOf(p.dex)))];
  const picker = teamPicker({ mons, N, hint, onFull: (uids) => confirmTeam(uids, () => picker.clear()) });
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: () => { chosen = null; renderDefenseSetup(el, back); } }, '‹ Roadmap'),
    h('div.bs-head', h('h2', `★ Level ${chosen.n}`), picker.count),
    h('div.d-theme', h('b', 'Gegner: '), h('span.type-chips.inline', theme.map((t) => typeChip(t))), h('small', ` · ${chosen.waves} Wellen`)),
    h('p.note', `Tippe ${N} Pokémon an. Die Zahl in der Ecke sind die Sternenkosten. Nur ★ Sammler erzeugen Sterne.`),
    picker.grid));
}

// Roadmap: alle Level als Weg; geschaffte golden, das nächste leuchtet, spätere gesperrt
// Level-Weg (PokeDefense-Roadmap und Tournament Run): geschaffte golden, das nächste leuchtet, spätere gesperrt
function roadMap(L, done, onPick) {
  const PER = 4, W = 340, RH = 74;
  const pos = (i) => { const row = Math.floor(i / PER), k = i % PER, col = row % 2 ? PER - 1 - k : k; return { x: 45 + col * ((W - 90) / (PER - 1)), y: 40 + row * RH }; };
  const H = 40 + Math.ceil(L.length / PER) * RH;
  const pts = L.map((_, i) => pos(i));
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="road-svg"><polyline points="${pts.map((p) => p.x + ',' + p.y).join(' ')}" fill="none" stroke="#c9b28a" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${pts.slice(0, done + 1).map((p) => p.x + ',' + p.y).join(' ')}" fill="none" stroke="#f2b93b" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const map = h('div.road', { style: { width: W + 'px', height: H + 'px' } });
  map.innerHTML = svg;
  L.forEach((lv, i) => {
    const st = lv.n <= done ? 'done' : lv.n === done + 1 ? 'next' : 'locked';
    const p = pos(i);
    map.append(h('button.road-node.' + st + (lv.legendary ? '.legend' : ''), { style: { left: p.x + 'px', top: p.y + 'px' }, onclick: () => {
      if (st === 'locked') { toast(`Schaffe zuerst Level ${done + 1}.`); return; }
      haptic('tick'); onPick(lv);
    } }, h('b', st === 'done' ? '✓' : String(lv.n)),
    h('span.road-types', lv.types.map((t) => h('i', { style: { background: typeColor(t) }, title: t })))));
  });
  // zum nächsten Level scrollen
  setTimeout(() => { const n = map.querySelector('.road-node.next'); if (n) n.scrollIntoView({ block: 'center' }); }, 50);
  return h('div.road-wrap', map);
}
function renderRoadmap(el, back) {
  const L = levelsList(), done = cleared();
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: back }, '‹ Zurück'),
    h('div.bs-head', h('h2', '★ PokeDefense'), h('span.bs-count' + (done >= L.length ? '.full' : ''), `${done}/${L.length} geschafft`)),
    h('p.note', 'Tippe auf das leuchtende Level. Die Punkte zeigen die Typen der Gegner.'),
    h('button.btn.chaos-btn', { onclick: () => startChaos(el, back) }, '🎲 Chaos-Modus – Pokébälle statt Sterne', app.state.defense?.chaosBest || tourDone() ? h('small.chaos-best', `Infinity-Rekord: Welle ${app.state.defense.chaosBest || 0} · Tournament ${tourDone()}/${CFG.tournament.levels.length}`) : null),
    roadMap(L, done, (lv) => { chosen = lv; renderDefenseSetup(el, back); el.scrollTop = 0; })));
}
// Tournament Run: 100 Level mit Gegner-Thema, eigene Pokémon zufällig aus Pokébällen
function renderTournament(el, back) {
  const L = CFG.tournament.levels, done = tourDone();
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: () => { tourView = false; renderDefenseSetup(el, back); } }, '‹ PokeDefense'),
    h('div.bs-head', h('h2', '🏆 Tournament Run'), h('span.bs-count' + (done >= L.length ? '.full' : ''), `${done}/${L.length} geschafft`)),
    h('p.note', 'Jedes Level hat sein eigenes Gegner-Thema. Deine Pokémon kommen zufällig aus Pokébällen. Goldener Rand = legendärer Boss.'),
    roadMap(L, done, confirmTournament)));
}
const themeName = (lv) => (lv.mixed ? 'Gemischt' : lv.types.join(' & '));
function confirmTournament(lv) {
  modal((m, close) => {
    m.append(h('h3', `🏆 Level ${lv.n}: ${themeName(lv)}`),
      h('div.d-theme', h('b', 'Gegner: '), h('span.type-chips.inline', lv.types.map((t) => typeChip(t))), h('small', ` · ${lv.waves} große Wellen`)),
      lv.legendary ? h('p.note', '⚠ In der letzten Welle wartet ein legendäres Pokémon als Boss.') : null,
      h('p.note', 'Statt Sternen fallen Pokébälle mit zufälligen Pokémon.'),
      h('div.row', h('button.btn', { onclick: close }, 'Abbrechen'), h('button.btn.primary.big', { onclick: () => { close(); startTournament(lv); } }, 'Los!')));
  });
}
function startTournament(lv) {
  tourView = true;
  chosen = { ...lv, chaos: true, tournament: true };
  game = new Defense({ team: [], level: chosen, chaos: true });
  openField();
}

// Bestätigung mit Rollen, Kosten und Fähigkeit – dann geht es aufs Feld
function confirmTeam(uids, reset) {
  pick = uids;
  modal((el, close) => {
    el.append(h('h3', 'Dein PokeDefense-Team'),
      h('div.d-theme', h('b', `Level ${chosen.n} · Gegner: `), h('span.type-chips.inline', chosen.types.map((t) => typeChip(t)))),
      h('div.confirm-list', pick.map((u, i) => {
        const p = app.state.pokemon.find((q) => q.uid === u);
        return h('div.confirm-row', h('span.bs-num', String(i + 1)), h('img', { src: portraitUrl(p.dex), alt: '' }),
          h('div', h('b', p.nick || species(p.dex).name), h('small', `${D().roles[roleOf(p.dex)].icon} ${abilityText(p.dex)}`)),
          h('span.d-price.inline', String(costOf(p.dex))));
      })),
      h('div.row', h('button.btn', { onclick: () => { close(); reset(); } }, 'Neu wählen'), h('button.btn.primary.big', { onclick: () => { close(); start(); } }, 'Los!')));
  });
}

function start() {
  const team = pick.map((u) => app.state.pokemon.find((p) => p.uid === u)).filter(Boolean);
  app.act((s) => { s.defense = { ...(s.defense || {}), team: [...pick] }; return { ok: true }; });
  game = new Defense({ team: team.map(fromPokemon), level: chosen });
  openField();
}

// Leihteam: zu wenige eigene Pokémon -> zufälliges Team (schwache, Sammler, mittlere, starke), jedes Mal neu
function offerLoaner(el, back) {
  let team = loanerTeam();
  modal((m, close) => {
    const list = h('div.confirm-list');
    const render = () => list.replaceChildren(...team.map((src, i) => h('div.confirm-row', h('span.bs-num', String(i + 1)), h('img', { src: portraitUrl(src.dex), alt: '' }),
      h('div', h('b', species(src.dex).name), h('small', `${D().roles[roleOf(src.dex)].icon} ${abilityText(src.dex)}`)), h('span.d-price.inline', String(costOf(src.dex))))));
    render();
    m.append(h('h3', `Leihteam für Level ${chosen.n}`),
      h('p.note', `Du hast noch keine ${D().teamSize} Pokémon – für diese Runde bekommst du ein zufälliges Team geliehen.`),
      h('div.d-theme', h('b', 'Gegner: '), h('span.type-chips.inline', chosen.types.map((t) => typeChip(t)))),
      list,
      h('div.row', h('button.btn', { onclick: () => { team = loanerTeam(); render(); haptic('tick'); } }, '🎲 Neu würfeln'),
        h('button.btn.primary.big', { onclick: () => { close(); game = new Defense({ team, level: chosen }); openField(); } }, 'Los!')));
  });
}

// Chaos-Modus: Pokébälle statt Sterne – Variante wählen (Infinity Run oder Tournament Run)
function startChaos(el, back) {
  const best = app.state.defense?.chaosBest;
  modal((m, close) => {
    m.append(h('h3', '🎲 Chaos-Modus'),
      h('p.note', 'Statt Sternen fallen Pokébälle! Jeder Ball enthält ein zufälliges Pokémon, das du genau einmal einsetzen kannst – danach kommen andere. Einsetzen kostet nichts.'),
      h('div.chaos-modes',
        h('button.btn.chaos-mode', { onclick: () => { close(); startInfinity(); } },
          h('b', '∞ Infinity Run'), h('small', `Endlos, Gegner und eigene Pokémon völlig zufällig.${best ? ` Rekord: Welle ${best}` : ''}`)),
        h('button.btn.chaos-mode', { onclick: () => { close(); tourView = true; if (el) renderDefenseSetup(el, back); } },
          h('b', '🏆 Tournament Run'), h('small', `${CFG.tournament.levels.length} Level mit Gegner-Themen · ${tourDone()}/${CFG.tournament.levels.length} geschafft`))),
      h('div.row', h('button.btn', { onclick: close }, 'Abbrechen')));
  });
}
// Infinity Run: Gegner aller Typen, endlose Wellen
function startInfinity() {
  chosen = { n: 0, chaos: true, types: [...D().themes.types], enemyLevel: D().chaos.endless.baseLevel, countMult: D().chaos.countMult, finalStage: 3, waves: 0 };
  chaosBestBefore = app.state.defense?.chaosBest || 0;
  game = new Defense({ team: [], level: chosen, chaos: true });
  openField();
}

// ================= Spielfeld =================
function openField() {
  closeField();
  const canvas = h('canvas.arena-canvas');
  const cards = h('div.d-cards');
  const starsEl = h('div.d-stars');
  const waveEl = h('div.d-wave', h('span'), h('div.d-wavebar', h('i')));
  const msg = h('div.b-msg');
  // Chaos: Leben (antippen = weiteres Leben mit Münzen kaufen)
  const livesEl = game.chaos ? h('button.b-btn.d-lives', { onclick: buyLife, title: 'Leben kaufen' }) : null;
  const top = h('div.b-top', starsEl, waveEl, livesEl, h('span.b-weather.d-weather'), h('button.b-btn', { onclick: giveUp, title: 'Aufgeben' }, '🏳'));
  // Normale Level: Vorbereitung ohne Zeitlimit, erst mit „Los!“ beginnen Sternenregen und Wellen. Chaos: Countdown.
  const go = game.chaos ? h('div.d-countdown') : h('button.btn.primary.big.d-go', { onclick: () => { go.remove(); game.started = true; message('Los! Sammle Sterne und verteidige deinen Trainer.'); haptic('medium'); } }, 'Los!');
  const info = h('div.d-info');
  const root = h('div.battle.defense' + (game.chaos ? '.chaos' : ''), top, h('div.b-field', canvas, go), info, cards, msg);
  document.body.append(root);
  document.body.classList.add('in-battle');
  const levelMusic = game.chaos ? 'chaos' : musicForLevel(game.theme); // je Level ein passendes Stück
  setMusic(levelMusic);
  ui = { root, canvas, ctx: canvas.getContext('2d'), cards, info, starsEl, waveEl, livesEl, countEl: game.chaos ? go : null, msg, sel: null, fx: [], areas: [], texts: [], booms: [], rings: [], slashes: [], beams: [], shakeAmt: 0, freeze: 0, flash: 0, wx: [], wxKind: null, cardEls: [], last: performance.now(), raf: 0, hover: null };
  for (const c of game.cards) loadSprites(c.dex, c.src.gender);
  const tr = new Image(); tr.src = `${base}art/trainers/${app.state.profile?.sprite || 1}.png`; ui.trainer = tr;
  // Feld-Thema: passend zu den Gegner-Typen (Chaos: zufällig)
  const TH = CFG.defenseThemes, ids = Object.keys(TH.themes);
  ui.themeId = game.chaos ? ids[Math.floor(Math.random() * ids.length)] : TH.byType[game.theme[0]] || 'wald';
  const ti = new Image(); ti.src = `${base}art/defense/${ui.themeId}.png`; ti.onload = () => { ui.bg = null; }; ui.tiles = ti;
  ui.ro = new ResizeObserver(() => layout()); ui.ro.observe(canvas.parentElement);
  canvas.addEventListener('pointerdown', onField);
  canvas.addEventListener('pointermove', (e) => { ui.hover = ui.sel ? cellAt(e.clientX, e.clientY) : null; });
  buildCards();
  layout();
  renderWeatherChip();
  message(game.chaos ? 'Stell dein Team auf – der Countdown läuft!' : 'Stell in Ruhe dein erstes Team auf – dann „Los!“');
  const loop = (t) => {
    if (!ui) return;
    const dt = Math.min(0.1, (t - ui.last) / 1000); ui.last = t;
    frame(dt);
    ui.raf = requestAnimationFrame(loop);
  };
  ui.raf = requestAnimationFrame(loop);
  if (import.meta.env.DEV) app.defense = { get g() { return game; }, step: (dt) => frame(dt) };
}

function closeField() {
  if (!ui) return;
  cancelAnimationFrame(ui.raf);
  ui.ro.disconnect();
  ui.root.remove();
  document.body.classList.remove('in-battle');
  ui = null;
  setMusic('menu');
}

function layout() {
  const { canvas } = ui, r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1), G = D().grid;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  // etwas Rand links/rechts für Bäume & Co.; im Chaos-Modus zusätzlich die Seitenfelder
  const tile = Math.floor(Math.min(r.width / (G.cols + (game.chaos ? 2.3 : 0.8)), r.height / (G.rows + 1.1)));
  Object.assign(ui, { dpr, w: r.width, h: r.height, tile, ox: Math.floor((r.width - tile * G.cols) / 2), oy: Math.max(0, Math.floor((r.height - tile * (G.rows + 1.1)) / 2)) });
  ui.bg = null; // Hintergrund neu aufbauen
}

function frame(dt) {
  if (!ui || !game) return;
  if (ui.paused) { /* Spiel pausiert (z. B. beim Lebenskauf) */ } else if (ui.freeze > 0) ui.freeze -= dt; // kurzer Trefferstopp bei Volltreffern/Explosionen
  else game.update(dt);
  handleEvents();
  draw(dt);
  renderTop();
  updateCards();
  if (game.over && !ui.ended) end();
}

const cellAt = (cx, cy) => {
  const r = ui.canvas.getBoundingClientRect(), G = D().grid, side = game.chaos ? 1 : 0;
  const col = Math.floor((cx - r.left - ui.ox) / ui.tile), row = Math.floor((cy - r.top - ui.oy) / ui.tile);
  return col >= -side && col < G.cols + side && row >= 0 && row < G.rows ? [col, row] : null;
};
const toGrid = (cx, cy) => { const r = ui.canvas.getBoundingClientRect(); return { x: (cx - r.left - ui.ox) / ui.tile, y: (cy - r.top - ui.oy) / ui.tile }; };
const toScreen = (x, y) => { const r = ui.canvas.getBoundingClientRect(); return { x: r.left + ui.ox + x * ui.tile, y: r.top + ui.oy + y * ui.tile }; };
const dropPos = (d) => { const k = Math.min(1, (game.t - d.born) / 1.2); return { x: d.x + Math.sin((game.t - d.born) * 3) * 0.08 * (1 - k), y: d.fromY + (d.y - d.fromY) * (1 - Math.pow(1 - k, 2)) }; };

function onField(e) {
  if (!game || game.over) return;
  // Sterne haben Vorrang
  const g = toGrid(e.clientX, e.clientY);
  const d = game.drops.find((x) => { const p = dropPos(x); return Math.hypot(p.x - g.x, p.y - g.y) < 0.65; });
  if (d) { const p = dropPos(d); if (game.collect(d)) { flyStar(toScreen(p.x, p.y), d); haptic('tick'); } handleEvents(); return; }
  const c = cellAt(e.clientX, e.clientY);
  if (!c) return;
  // eigenes Pokémon antippen (ohne gewählte Karte): nach Bestätigung vom Feld nehmen
  const own = !ui.sel && game.units.find((u) => u.col === c[0] && u.row === c[1] && u.hp > 0);
  if (own) { askRemove(own); return; }
  if (ui.sel) useCard(ui.sel, c);
}
// Karte auf ein Feld setzen – oder als Weiterentwicklung auf ein passendes, schon platziertes Pokémon
function useCard(card, c) {
  const there = game.units.find((u) => u.col === c[0] && u.row === c[1] && u.hp > 0);
  if (there && game.canUpgrade(card, there)) { if (game.upgrade(card, there)) { haptic('medium'); ui.sel = null; handleEvents(); } return; }
  if (!game.canPlace(c[0], c[1])) { toast(there ? `${species(card.dex).name} ist keine Weiterentwicklung von ${species(there.dex).name}.` : 'Hier kannst du nichts hinsetzen.'); return; }
  if (game.place(card, c[0], c[1])) { haptic('medium'); shake(ui.tile * 0.04); ui.sel = null; handleEvents(); }
}
// Karte aufs Feld ziehen (Drag & Drop) – loslassen über einem Feld setzt sie dort ein
function dragCard(e, c) {
  if (game.over || game.t < c.readyAt || game.stars < c.cost) return;
  const sx = e.clientX, sy = e.clientY;
  let ghost = null;
  const move = (m) => {
    if (!ghost && Math.hypot(m.clientX - sx, m.clientY - sy) < 12) return;
    if (!ghost) { ghost = h('img.d-ghost', { src: portraitUrl(c.dex), alt: '' }); document.body.append(ghost); ui.sel = c; }
    ghost.style.transform = `translate(${m.clientX - 26}px, ${m.clientY - 40}px)`;
    ui.hover = cellAt(m.clientX, m.clientY);
  };
  const up = (u) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (!ghost || !ui) return;
    ghost.remove(); ui.dragEnd = performance.now(); ui.hover = null;
    const cell = u.type === 'pointerup' ? cellAt(u.clientX, u.clientY) : null;
    if (cell) useCard(c, cell); else ui.sel = null;
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
// weiteres Leben mit Münzen kaufen (Preis steigt mit jedem Kauf)
async function buyLife() {
  if (!game || game.over) return;
  const price = game.lifePrice(), coins = app.state.coins;
  if (coins < price) { toast(`Ein Leben kostet ${price} Münzen – du hast ${coins}.`); return; }
  ui.paused = true; // während der Entscheidung läuft das Spiel nicht weiter
  const yes = await confirmDialog(`Ein Leben für ${price} Münzen kaufen? Du hast ${coins} Münzen.`, `♥ für ${price}`);
  if (ui) ui.paused = false;
  if (!yes || !game || game.over) return;
  const r = app.act((s) => { if (s.coins < price) return { ok: false, msg: 'Nicht genug Münzen.' }; s.coins -= price; return { ok: true }; }, true);
  if (r.ok) { game.addLife(); haptic('medium'); handleEvents(); }
}

async function askRemove(u) {
  const name = u.nick || species(u.dex).name;
  if (!(await confirmDialog(`${name} vom Feld nehmen? Es ist dann für diese Runde weg.`, 'Entfernen'))) return;
  if (game && !game.over && game.removeUnit(u)) { haptic('medium'); handleEvents(); }
}

function flyStar(from, d) {
  const to = d?.dex ? ui.cards.getBoundingClientRect() : ui.starsEl.getBoundingClientRect();
  const el = h('img.flyer', { src: d?.dex ? portraitUrl(d.dex) : starCanvas().toDataURL(), alt: '' });
  document.body.append(el);
  el.animate([{ transform: `translate(${from.x - 14}px, ${from.y - 14}px) scale(1.4)` }, { transform: `translate(${to.left}px, ${to.top}px) scale(.8)` }], { duration: 450, easing: 'ease-in' }).onfinish = () => el.remove();
}

// ---------- Karten ----------
function saveChaosBest(wave) {
  if (wave > (app.state.defense?.chaosBest || 0)) app.act((s) => { s.defense ||= {}; s.defense.chaosBest = Math.max(s.defense.chaosBest || 0, wave); return { ok: true }; }, true);
}
// Chaos-Karte aus der Hand werfen, um Platz für neue Pokébälle zu machen
async function askDiscard(c) {
  if (!(await confirmDialog(`${species(c.dex).name} aus deiner Hand löschen?`, 'Löschen'))) return;
  const i = game?.cards.indexOf(c) ?? -1;
  if (i < 0 || game.over) return;
  game.cards.splice(i, 1);
  if (ui.sel === c) ui.sel = null;
  if (ui.inspect === c) ui.inspect = null;
  haptic('tick');
}

function buildCards() {
  ui.cardEls = [];
  ui.cardKey = game.cards.map((c) => c.id ?? c.dex).join();
  ui.cards.classList.toggle('chaos', game.chaos);
  ui.cards.replaceChildren(...game.cards.map((c) => {
    loadSprites(c.dex, c.src.gender);
    // Karte: Typen als farbige Leiste mit Namen, Porträt, Fähigkeit/Rolle als Wort, Kosten
    const types = species(c.dex).types, ab = abilityOf(c.dex);
    const el = h('button.d-card.r-' + c.role,
      h('span.d-card-types', types.map((t) => h('i', { style: { background: typeColor(t) } }, t))),
      h('img', { src: portraitUrl(c.dex), alt: '', draggable: false }),
      h('span.d-card-ab.r-' + c.role, ab ? ab.name : ROLE_SHORT[c.role]),
      h('span.d-card-cost', c.once ? '1×' : String(c.cost)),
      h('i.d-card-cool'),
      c.once ? h('span.d-card-del', { title: 'Löschen', onclick: (e) => { e.stopPropagation(); askDiscard(c); } }, '×') : null);
    el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.d-card-del')) dragCard(e, c); });
    el.addEventListener('click', () => {
      if (game.over || performance.now() - (ui.dragEnd || 0) < 300) return;
      ui.inspect = c; // Infozeile zeigt die Karte auch, wenn sie gerade nicht spielbar ist
      if (game.t < c.readyAt) { toast(`Lädt noch ${Math.ceil(c.readyAt - game.t)} s.`); return; }
      if (game.stars < c.cost) { toast(`Zu wenig Sterne (${c.cost} nötig).`); return; }
      ui.sel = ui.sel === c ? null : c; haptic('tick');
    });
    ui.cardEls.push({ c, el });
    return el;
  }));
}
function updateCards() {
  if (ui.cardKey !== game.cards.map((c) => c.id ?? c.dex).join()) { if (ui.sel && !game.cards.includes(ui.sel)) ui.sel = null; buildCards(); }
  // Infozeile: was das gewählte Pokémon kann
  const shown = ui.sel || (ui.inspect && game.cards.includes(ui.inspect) ? ui.inspect : null);
  const ik = shown ? shown.dex + '|' + (shown.id ?? '') : '';
  if (ui.infoKey !== ik) {
    ui.infoKey = ik;
    const c = shown;
    ui.info.replaceChildren(...(c ? [h('b', c.src.nick || species(c.dex).name), h('span.type-chips.inline', species(c.dex).types.map((t) => typeChip(t))), h('small', `${D().roles[c.role].icon} ${abilityText(c.dex)}`)] : [h('small', 'Tippe eine Karte an, dann ein Feld.')]));
  }
  for (const { c, el } of ui.cardEls) {
    const left = Math.max(0, c.readyAt - game.t);
    el.classList.toggle('sel', ui.sel === c);
    el.classList.toggle('poor', game.stars < c.cost);
    el.querySelector('.d-card-cool').style.height = (left > 0 ? (left / c.recharge) * 100 : 0) + '%';
  }
}
function renderTop() {
  const cd = game.started || game.prepLeft == null ? 0 : Math.ceil(game.prepLeft);
  const k = `${game.stars}|${game.wave}|${game.cards.length}|${game.lives}|${cd}`;
  if (ui.topKey === k) return;
  ui.topKey = k;
  if (game.chaos) ui.starsEl.replaceChildren(ballCanvas('pokeball', 1), `${game.cards.length}/${D().chaos.handMax}`);
  else ui.starsEl.replaceChildren(starImg(), String(game.stars));
  if (ui.livesEl) ui.livesEl.textContent = `♥ ${game.lives + 1}`; // das letzte Leben zählt mit
  if (ui.countEl) { ui.countEl.textContent = cd ? String(cd) : ''; ui.countEl.classList.toggle('hidden', !cd); }
  const w = game.waveProgress();
  const name = game.tournament ? `Level ${game.level.n} · ` : '';
  ui.waveEl.firstChild.textContent = cd ? `Angriff in ${cd} s` : !w.wave ? 'Vorbereitung' : w.total ? `${name}Welle ${w.wave}/${w.total}` : `Welle ${w.wave} · Infinity`;
  ui.waveEl.lastChild.firstChild.style.width = (w.total ? w.wave / w.total : (w.wave % 5) / 5) * 100 + '%';
}
function message(text) {
  const el = h('div', text);
  ui.msg.append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- Zeichnen ----------
function draw(dt) {
  const U = ui, x = U.ctx, T = U.tile, G = D().grid, now = performance.now();
  U.shakeAmt *= Math.exp(-dt * 12);
  const sx = (Math.random() - 0.5) * 2 * U.shakeAmt, sy = (Math.random() - 0.5) * 2 * U.shakeAmt;
  x.setTransform(U.dpr, 0, 0, U.dpr, U.dpr * sx, U.dpr * sy);
  x.imageSmoothingEnabled = false;
  x.fillStyle = '#5e9a46'; x.fillRect(-20, -20, U.w + 40, U.h + 40);
  // Hintergrund aus Tileset-Kacheln (Rand: Bäume/Felsen/Kristalle, Feld: Boden), einmal je Größe aufgebaut
  if (!U.bg && U.tiles.complete && U.tiles.naturalWidth) U.bg = buildBackground();
  if (U.bg) x.drawImage(U.bg, 0, 0, U.w, U.h);
  else for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { x.fillStyle = (r + c) % 2 ? '#8fcd68' : '#99d571'; x.fillRect(U.ox + c * T, U.oy + r * T, T, T); }
  x.fillStyle = 'rgba(20,15,30,.14)'; x.fillRect(U.ox, U.oy, G.cols * T, G.placeRows[0] * T); // Gegner-Bereich etwas dunkler
  // noch gesperrte Reihen des eigenen Bereichs
  const minRow = game.minRow();
  if (minRow > G.placeRows[0]) {
    x.fillStyle = 'rgba(40,30,25,.22)';
    x.fillRect(U.ox, U.oy + G.placeRows[0] * T, G.cols * T, (minRow - G.placeRows[0]) * T);
  }
  x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(U.ox, U.oy + minRow * T - 1, G.cols * T, 2);
  // Grenze zum eigenen Bereich + Ziellinie
  x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(U.ox, U.oy + G.placeRows[0] * T - 1, G.cols * T, 2);
  const goalY = U.oy + G.rows * T;
  x.fillStyle = 'rgba(40,25,15,.35)'; x.fillRect(U.ox, goalY, G.cols * T, T * 1.1);
  x.fillStyle = '#e0606a';
  for (let i = 0; i < G.cols * 4; i++) if (i % 2 === 0) x.fillRect(U.ox + i * T / 4, goalY, T / 4, Math.max(2, T / 14));
  // Trainer (von hinten, schaut nach oben)
  if (U.trainer.complete && U.trainer.naturalWidth) {
    const fr = Math.floor(now / 400) % 2 === 0 ? 0 : 1;
    const sz = T * 1.1;
    x.drawImage(U.trainer, fr * 64, 3 * 64, 64, 64, U.ox + (G.cols * T) / 2 - sz / 2, goalY + T * 0.02, sz, sz);
  }
  // Chaos: Seitenfelder links und rechts (heller Boden mit Rahmen)
  if (game.chaos) {
    const S = D().chaos.side.rows;
    for (const c of [-1, G.cols]) {
      x.fillStyle = 'rgba(255,248,220,.16)'; x.fillRect(U.ox + c * T + 1, U.oy + S[0] * T + 1, T - 2, (S[1] - S[0] + 1) * T - 2);
      x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = 2; x.strokeRect(U.ox + c * T + 1, U.oy + S[0] * T + 1, T - 2, (S[1] - S[0] + 1) * T - 2);
      x.fillStyle = 'rgba(0,0,0,.12)'; for (let r = S[0] + 1; r <= S[1]; r++) x.fillRect(U.ox + c * T + 3, U.oy + r * T, T - 6, 1);
    }
  }
  // Platzierungshilfe
  if (U.sel) {
    x.fillStyle = 'rgba(255,255,255,.18)';
    for (let r = 0; r < G.rows; r++) for (let c = -1; c <= G.cols; c++) if (game.canPlace(c, r)) x.fillRect(U.ox + c * T + 2, U.oy + r * T + 2, T - 4, T - 4);
    // passende Pokémon für eine Weiterentwicklung golden umranden
    x.strokeStyle = '#ffd23f'; x.lineWidth = 3;
    for (const u of game.units) if (game.canUpgrade(U.sel, u)) { const p = 1 + Math.sin(now / 150) * 2; x.strokeRect(U.ox + u.col * T + 2 - p, U.oy + u.row * T + 2 - p, T - 4 + p * 2, T - 4 + p * 2); }
    if (U.hover) {
      const there = game.units.find((u) => u.col === U.hover[0] && u.row === U.hover[1] && u.hp > 0);
      x.strokeStyle = game.canPlace(...U.hover) || (there && game.canUpgrade(U.sel, there)) ? '#fff' : 'rgba(255,90,90,.9)'; x.lineWidth = 2; x.strokeRect(U.ox + U.hover[0] * T + 1, U.oy + U.hover[1] * T + 1, T - 2, T - 2);
    }
  }
  const P = (o) => [U.ox + o.x * T, U.oy + o.y * T];
  // eigene Pokémon und Gegner (nach Tiefe)
  const all = [...game.units.map((u) => ({ o: u, mine: true })), ...game.enemies.map((e) => ({ o: e, mine: false }))].sort((a, b) => a.o.y - b.o.y);
  for (const { o, mine } of all) drawMon(x, o, mine, P(o), T, now);
  // Geschosse: leuchtender Kern mit Schweif in Typfarbe
  for (const p of game.projectiles) {
    if (p.boomerang) { drawBone(x, P(p), T, p.spin || 0); continue; }
    const [X, Y] = P(p), col = typeColor(p.type), s = Math.max(4, Math.round(T / 6.5));
    if (Math.random() < 0.35) burstAt(p, p.type, 1, 0.35, 0.6); // kleine Typ-Partikel entlang der Flugbahn
    (p.trail ||= []).push([X, Y]); if (p.trail.length > 7) p.trail.shift();
    p.trail.forEach(([tx, ty], i) => { const k = (i + 1) / p.trail.length; x.globalAlpha = k * 0.5; x.fillStyle = col; const q = s * (0.4 + k * 0.6); x.fillRect(tx - q / 2, ty - q / 2, q, q); });
    x.globalAlpha = 0.35; x.fillStyle = col; x.beginPath(); x.arc(X, Y, s * 1.3, 0, 7); x.fill();
    x.globalAlpha = 1; x.fillStyle = '#fff'; x.fillRect(X - s / 2 - 1, Y - s / 2 - 1, s + 2, s + 2);
    x.fillStyle = col; x.fillRect(X - s / 2, Y - s / 2, s, s);
    x.fillStyle = '#fff'; x.fillRect(X - s / 4, Y - s / 4, s / 3, s / 3);
  }
  // Strahlen (Rankenhieb, Feuerstrahl, Wasserstrahl): Pixel-Säule über length Felder
  U.beams = U.beams.filter((b) => {
    b.t += dt; if (b.t > 0.32) return false;
    if (b.u.dir) { // Seitenfeld: Strahl quer über das Feld (gedreht)
      const [X, Y] = P(b.u);
      x.save(); x.translate(X, Y); x.rotate((b.u.dir * Math.PI) / 2); drawBeam(x, b, [0, 0], T, now); x.restore();
    } else drawBeam(x, b, P(b.u), T, now);
    return true;
  });
  // Flächen: Schlafpuder/Konfustrahl (3×3 um das Pokémon), Giftwolke (Fläche davor)
  U.areas = (U.areas || []).filter((a) => {
    a.t += dt; if (a.t > a.dur) return false;
    const k = a.t / a.dur, X = U.ox + a.x * T, Y = U.oy + a.y * T, W = a.w * T, H = a.h * T;
    x.globalAlpha = 0.32 * (1 - k); x.fillStyle = a.color; x.fillRect(X, Y, W, H);
    x.globalAlpha = 0.8 * (1 - k); x.strokeStyle = a.color; x.lineWidth = 2; x.strokeRect(X + 1, Y + 1, W - 2, H - 2);
    x.globalAlpha = 1;
    return true;
  });
  // Explosionen: Feuerball + Schockwelle
  U.booms = U.booms.filter((b) => {
    b.t += dt; if (b.t > 0.7) return false;
    const [X, Y] = P(b.u), k = b.t / 0.7, R = (b.r + 0.4) * T;
    x.globalAlpha = 1 - k;
    x.fillStyle = '#fff6c0'; x.beginPath(); x.arc(X, Y, R * (0.3 + k * 0.9), 0, 7); x.fill();
    x.fillStyle = '#ffb84a'; x.beginPath(); x.arc(X, Y, R * (0.25 + k * 0.6), 0, 7); x.fill();
    x.fillStyle = '#ff6a3a'; x.beginPath(); x.arc(X, Y, R * (0.15 + k * 0.35), 0, 7); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = Math.max(2, T / 10) * (1 - k); x.beginPath(); x.arc(X, Y, R * (0.5 + k * 1.3), 0, 7); x.stroke();
    if (b.square) { const S = b.r * T; x.globalAlpha = 0.7 * (1 - k); x.strokeStyle = '#ffe066'; x.lineWidth = 3; x.strokeRect(X - S, Y - S, S * 2, S * 2); } // 3×3-Bereich
    x.globalAlpha = 1;
    return true;
  });
  // Treffer-Ringe und Hieb-Bögen
  U.rings = U.rings.filter((r) => {
    r.t += dt; if (r.t > r.dur) return false;
    const k = r.t / r.dur;
    x.globalAlpha = 1 - k; x.strokeStyle = r.color; x.lineWidth = Math.max(2, T / 12) * (1 - k * 0.6);
    x.beginPath(); x.arc(U.ox + r.x * T, U.oy + r.y * T, T * (r.r0 + k * r.grow), 0, 7); x.stroke();
    x.globalAlpha = 1;
    return true;
  });
  U.slashes = U.slashes.filter((s) => {
    s.t += dt; if (s.t > 0.22) return false;
    const k = s.t / 0.22, X = U.ox + s.x * T, Y = U.oy + s.y * T;
    x.globalAlpha = 1 - k; x.strokeStyle = '#fff'; x.lineWidth = Math.max(3, T / 8) * (1 - k);
    x.beginPath(); x.arc(X, Y + T * 0.3, T * 0.55, Math.PI * (1.15 + k * 0.2), Math.PI * (1.85 + k * 0.2)); x.stroke();
    x.strokeStyle = s.color; x.lineWidth = Math.max(2, T / 14) * (1 - k);
    x.beginPath(); x.arc(X, Y + T * 0.3, T * 0.45, Math.PI * (1.2 + k * 0.2), Math.PI * (1.8 + k * 0.2)); x.stroke();
    x.globalAlpha = 1;
    return true;
  });
  // Partikel (Form je Typ: Funken, Tropfen, Blätter, Splitter, Brocken …)
  U.fx = U.fx.filter((f) => {
    f.life -= dt; if (f.life <= 0) return false;
    f.x += f.vx * dt; f.y += f.vy * dt; f.vy += f.g * dt; f.vx *= 1 - dt * f.drag;
    x.globalAlpha = Math.min(1, f.life / 0.3); x.fillStyle = f.color;
    const s = Math.max(2, (T / 10) * f.size), X = U.ox + f.x * T, Y = U.oy + f.y * T;
    drawParticle(x, f, X, Y, s, now);
    return true;
  });
  x.globalAlpha = 1;
  drawWeather(x, U, game.weather, U.w, U.h, T, dt, now);
  // Sterne (fallen herab, pulsieren, blinken kurz vor dem Verschwinden)
  const star = starCanvas(), ss = T * 0.62;
  for (const d of game.drops) {
    const p = dropPos(d), age = game.t - d.born, life = D().stars.lifetime;
    if (age > life - 2.5 && Math.floor(age * 6) % 2) continue;
    const pulse = 1 + Math.sin(now / 200 + d.id) * 0.08;
    // Leuchten: bei Nacht/Wolken/Regen deutlich stärker, damit die Sterne gut sichtbar bleiben
    const dark = { nacht: 1, bewoelkt: 0.6, regen: 0.6, schnee: 0.4 }[game.weather] || 0;
    const glow = x.createRadialGradient(U.ox + p.x * T, U.oy + p.y * T, 0, U.ox + p.x * T, U.oy + p.y * T, ss * (0.8 + dark * 0.7) * pulse);
    glow.addColorStop(0, `rgba(255,240,150,${0.55 + dark * 0.35})`); glow.addColorStop(1, 'rgba(255,230,120,0)');
    x.fillStyle = glow; x.beginPath(); x.arc(U.ox + p.x * T, U.oy + p.y * T, ss * (0.8 + dark * 0.7) * pulse, 0, 7); x.fill();
    const img = d.dex ? ballCanvas(ballSprite('pokeball', null, d.dex), 4) : star;
    x.drawImage(img, U.ox + p.x * T - (ss * pulse) / 2, U.oy + p.y * T - (ss * pulse) / 2, ss * pulse, ss * pulse);
  }

  // schwebende Zahlen: springen auf, Volltreffer groß und golden
  U.texts = U.texts.filter((t) => {
    t.t += dt; if (t.t > t.dur) return false;
    const pop = t.t < 0.12 ? 1 + (1 - t.t / 0.12) * 0.8 : 1;
    x.globalAlpha = Math.min(1, (t.dur - t.t) / 0.3);
    x.font = `600 ${Math.round(T * t.size * pop)}px 'Ziffern', 'Pixelify Sans', sans-serif`; x.textAlign = 'center';
    x.lineWidth = Math.max(3, T / 12); x.strokeStyle = 'rgba(40,25,20,.95)';
    const X = U.ox + t.x * T, Y = U.oy + t.y * T - t.t * T * 0.7;
    x.strokeText(t.text, X, Y); x.fillStyle = t.color; x.fillText(t.text, X, Y);
    x.globalAlpha = 1;
    return true;
  });
  // Bildschirm-Blitz (Explosion, Volltreffer)
  if (U.flash > 0) { x.setTransform(U.dpr, 0, 0, U.dpr, 0, 0); x.fillStyle = `rgba(255,255,240,${Math.min(0.7, U.flash * 2.5)})`; x.fillRect(0, 0, U.w, U.h); U.flash -= dt; }
}

function drawMon(x, o, mine, [X, Y], T, now) {
  const e = loadSprites(o.dex, o.gender);
  const dead = o.hp <= 0;
  if (!e.ready) return;
  const asleep = !mine && game.t < (o.sleepUntil || 0);
  let name = mine ? 'Idle' : asleep ? 'Sleep' : o.eating ? 'Idle' : 'Walk', ms = now, once = false;
  // Treffer-Sprite (Hurt) hat Vorrang, dann Angriffs-Sprite (Attack/Shoot)
  if (o.hurtT != null && game.t - o.hurtT < 0.28 && e.anims.Hurt) { name = 'Hurt'; ms = (game.t - o.hurtT) * 1000; once = true; }
  else if (o.anim && (game.t - o.anim.t0) * 1000 < (e.anims[o.anim.name]?.total || 0) * (1000 / 60)) { name = o.anim.name; ms = (game.t - o.anim.t0) * 1000; once = true; }
  const confused = !mine && game.t < (o.confusedUntil || 0);
  const f = frameOf(e, name, name === 'Sleep' ? 0 : mine || confused ? 4 : 0, ms, once);
  let s = T / 28;
  if (e.anims.Idle.fh * s > T * 1.6) s = (T * 1.6) / e.anims.Idle.fh;
  if (o.boss) { // goldene, pulsierende Aura unter dem Boss
    s *= CFG.defense.chaos.boss.scale;
    const pr = T * (0.55 + Math.sin(now / 160) * 0.05);
    const gr = x.createRadialGradient(X, Y, 0, X, Y, pr); gr.addColorStop(0, 'rgba(255,200,60,.45)'); gr.addColorStop(1, 'rgba(255,200,60,0)');
    x.fillStyle = gr; x.beginPath(); x.arc(X, Y, pr, 0, 7); x.fill();
  }
  if (o.fast && !o.eating) { // Tempo-Streifen hinter flinken Gegnern
    x.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 3; i++) { const off = ((now / 80 + i * 7) % 10) / 10; x.fillRect(X - T * 0.25 + i * T * 0.22, Y - T * (0.65 + off * 0.3), 2, T * 0.25); }
  }
  // Rückstoß nach Treffern (Gegner werden kurz nach oben gedrückt), Pop beim Einsetzen
  const since = o.hurtT != null ? game.t - o.hurtT : 9;
  const knock = !mine && since < 0.15 ? -(1 - since / 0.15) * T * 0.12 : 0;
  const shake = since < 0.15 ? (Math.random() - 0.5) * T * 0.08 : 0;
  const pop = mine && o.placedAt != null && game.t - o.placedAt < 0.25 ? 1 + (1 - (game.t - o.placedAt) / 0.25) * 0.35 : 1;
  const w = f.fw * s * pop, hh = f.fh * s * pop, dx = Math.round(X - w / 2 + shake), dy = Math.round(Y - T * 0.1 - hh / 2 + knock);
  if (dead) x.globalAlpha = 0.4;
  x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, dx, dy, Math.round(w), Math.round(hh));
  // weißes Aufblitzen bei Treffern, bläulicher Schimmer wenn verlangsamt
  if (since < 0.09 || (!mine && game.t < o.slowUntil)) {
    x.globalCompositeOperation = 'lighter';
    x.globalAlpha = since < 0.09 ? 0.75 : 0.25;
    x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, dx, dy, Math.round(w), Math.round(hh));
    x.globalCompositeOperation = 'source-over';
  }
  x.globalAlpha = 1;
  if (dead) return;
  if (!mine && o.poison && game.t < o.poison.until && Math.random() < 0.15) ui.fx.push({ x: o.x + (Math.random() - 0.5) * 0.4, y: o.y - 0.2, vx: 0, vy: -0.8, g: -0.5, drag: 0, color: Math.random() < 0.5 ? '#a33ea1' : '#d79ae0', shape: 'ring', size: 0.6, life: 0.6 }); // Giftblasen
  if (asleep) { // kleine "z", die aus dem schlafenden Pokémon aufsteigen
    x.font = `600 ${Math.round(T * 0.22)}px 'Ziffern', 'Pixelify Sans', sans-serif`; x.textAlign = 'center';
    for (let i = 0; i < 3; i++) { const k = ((now / 900) + i / 3) % 1; x.globalAlpha = 1 - k; x.fillStyle = '#e8f0ff'; x.strokeStyle = 'rgba(30,30,60,.8)'; x.lineWidth = 2;
      const zx = X + T * (0.15 + k * 0.25), zy = Y - T * (0.3 + k * 0.55); x.strokeText('z', zx, zy); x.fillText('z', zx, zy); }
    x.globalAlpha = 1;
  }
  if (confused) { // kreisende Sternchen über dem Kopf
    for (let i = 0; i < 3; i++) { const a = now / 180 + (i * Math.PI * 2) / 3; x.fillStyle = i % 2 ? '#f95587' : '#ffe066'; x.fillRect(X + Math.cos(a) * T * 0.28 - 2, Y - T * 0.62 + Math.sin(a) * T * 0.08 - 2, 4, 4); }
  }
  if (o.role === 'explosiv' && game.t < o.armAt) { x.fillStyle = 'rgba(40,30,25,.6)'; x.fillRect(X - T * 0.3, Y + T * 0.3, T * 0.6 * (1 - (o.armAt - game.t) / (CFG.defense.roles.explosiv.armSeconds || 1)), 3); }
  if (o.hp < o.maxHp || o.boss) {
    const bw = T * (o.boss ? 1.2 : 0.7), bh = Math.max(3, T / (o.boss ? 9 : 14)), bx = X - bw / 2, by = Y - T * (o.boss ? 0.85 : 0.55);
    x.fillStyle = '#2f2622'; x.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    x.fillStyle = mine ? '#4f9ff0' : o.boss ? '#ffb02e' : '#ef5d5d'; x.fillRect(bx, by, bw * o.hp / o.maxHp, bh);
    if (o.boss) { x.font = `600 ${Math.round(T * 0.22)}px 'Ziffern', 'Pixelify Sans', sans-serif`; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = 'rgba(40,25,20,.9)'; x.strokeText('BOSS', X, by - 3); x.fillStyle = '#ffd23f'; x.fillText('BOSS', X, by - 3); }
  }
  // Wetter: grüner Pfeil nach oben = Vorteil, roter Pfeil nach unten = Nachteil
  const wb = weatherBoost(o.dex, game.weather);
  if (wb !== 1) weatherArrow(x, X + T * 0.32, Y - T * 0.42, T, wb > 1);
}
function weatherArrow(x, X, Y, T, up) {
  const q = Math.max(2, Math.round(T / 16)), d = up ? 1 : -1;
  // Pixel-Pfeil: Spitze (3 Reihen) und Schaft, mit dunklem Rand
  const px = [[0, -2], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [0, 1], [0, 2]];
  x.fillStyle = 'rgba(30,25,20,.85)';
  for (const [i, j] of px) x.fillRect(Math.round(X + i * q - q), Math.round(Y + j * d * q - q), q * 3, q * 3);
  x.fillStyle = up ? '#5fdc5a' : '#ef4b4b';
  for (const [i, j] of px) x.fillRect(Math.round(X + i * q), Math.round(Y + j * d * q), q, q);
}

// Strahl in Pixeln: Ranke (grün, peitscht), Feuer (flackernd), Wasser (Strom mit Glanz)
function drawBeam(x, b, [X, Y], T, now) {
  const k = b.t / 0.32, len = b.length * T, grow = Math.min(1, b.t / 0.08), fade = 1 - Math.max(0, (b.t - 0.2) / 0.12);
  const top = Y - T * 0.35 - len * grow, px = Math.max(3, Math.round(T / 9));
  x.globalAlpha = fade;
  if (b.fx === 'ranke') {
    for (let y = Y - T * 0.35; y > top; y -= px) {
      const wob = Math.sin((y / px) * 0.9 + now / 40) * px * 1.4;
      x.fillStyle = '#2f6b25'; x.fillRect(X - px + wob, y, px * 2, px);
      x.fillStyle = '#7ac74c'; x.fillRect(X - px / 2 + wob, y, px, px);
      if (Math.round(y / px) % 4 === 0) { x.fillStyle = '#bde58f'; x.fillRect(X + wob + px, y, px * 1.5, px); x.fillRect(X + wob - px * 2.5, y + px, px * 1.5, px); }
    }
  } else {
    const pal = b.fx === 'feuer' ? ['#ff6a3a', '#ffb84a', '#fff3a0'] : ['#3d7be0', '#6fb7ff', '#e8f6ff'];
    const w = T * 0.42 * (0.85 + Math.sin(now / 30) * 0.15);
    for (let y = Y - T * 0.35; y > top; y -= px) {
      const jit = b.fx === 'feuer' ? (Math.random() - 0.5) * px * 2 : Math.sin(y / 9 + now / 50) * px;
      x.fillStyle = pal[0]; x.fillRect(X - w / 2 + jit, y, w, px);
      x.fillStyle = pal[1]; x.fillRect(X - w / 3 + jit, y, (w * 2) / 3, px);
      x.fillStyle = pal[2]; x.fillRect(X - w / 8 + jit, y, w / 4, px);
    }
    // Funken/Tropfen am Ende des Strahls
    x.fillStyle = pal[2];
    for (let i = 0; i < 5; i++) x.fillRect(X + (Math.random() - 0.5) * T * 0.7, top + (Math.random() - 0.5) * T * 0.3, px, px);
  }
  x.globalAlpha = 1;
  if (k < 0.1) return;
}
// rotierender Knochen
function drawBone(x, [X, Y], T, spin) {
  const L = T * 0.42, w = Math.max(3, T / 10);
  x.save(); x.translate(X, Y); x.rotate(spin);
  x.fillStyle = '#4a3b33'; x.fillRect(-L / 2 - 1, -w / 2 - 1, L + 2, w + 2);
  x.fillStyle = '#f4ecd8'; x.fillRect(-L / 2, -w / 2, L, w);
  for (const sx of [-1, 1]) { x.fillStyle = '#4a3b33'; x.fillRect(sx * L / 2 - w - 1, -w - 1, w * 2 + 2, w * 2 + 2); x.fillStyle = '#f4ecd8'; x.fillRect(sx * L / 2 - w, -w, w * 2, w * 2); }
  x.restore();
}

// Hintergrund-Bild für das aktuelle Thema: überall Rand-Kacheln, im Feld Boden-Kacheln, feine Rasterlinien
function buildBackground() {
  const U = ui, T = U.tile, G = D().grid, th = CFG.defenseThemes.themes[U.themeId], S = 24;
  const c = document.createElement('canvas');
  c.width = Math.round(U.w * U.dpr); c.height = Math.round(U.h * U.dpr);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.scale(U.dpr, U.dpr);
  const hash = (a, b) => (((a * 73856093) ^ (b * 19349663)) >>> 0) % 997;
  const tile = (i, X, Y) => x.drawImage(U.tiles, i * S, 0, S, S, Math.floor(X), Math.floor(Y), Math.ceil(T) + 1, Math.ceil(T) + 1);
  const c0 = Math.floor(-U.ox / T) - 1, r0 = Math.floor(-U.oy / T) - 1;
  for (let r = r0; r * T + U.oy < U.h; r++) for (let col = c0; col * T + U.ox < U.w; col++) {
    const SR = game.chaos ? D().chaos.side.rows : null; // Chaos: Seitenfelder bekommen ebenfalls Boden
    const inField = (col >= 0 && col < G.cols && r >= 0 && r < G.rows + 2) || (SR && (col === -1 || col === G.cols) && r >= SR[0] && r <= SR[1]);
    const i = inField ? th.wall + (hash(col + 3, r + 7) % th.floor) : hash(col, r) % th.wall;
    tile(i, U.ox + col * T, U.oy + r * T);
  }
  x.fillStyle = 'rgba(0,0,0,.08)';
  for (let col = 1; col < G.cols; col++) x.fillRect(U.ox + col * T, U.oy, 1, G.rows * T);
  for (let r = 1; r < G.rows; r++) x.fillRect(U.ox, U.oy + r * T, G.cols * T, 1);
  // weiche Schatten am Feldrand
  x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(U.ox - 2, U.oy, 2, (G.rows + 1.1) * T); x.fillRect(U.ox + G.cols * T, U.oy, 2, (G.rows + 1.1) * T);
  return c;
}

// ---------- Effekte ----------
// Pixel-Partikel je Attackentyp: Tropfen/Blasen, Flämmchen, Blitze, Blätter, Sternchen, Flocken, Federn …
const FX = {
  Feuer: { c: ['#ffe066', '#ffb84a', '#ff6a3a'], g: -2.5, shape: 'flame' }, Wasser: { c: ['#bfe3ff', '#6fb7ff', '#3d7be0'], g: 6, shape: ['drop', 'drop', 'bubble'] },
  Elektro: { c: ['#fff6a0', '#ffe066', '#8fd8ff'], g: 0, shape: 'bolt' }, Pflanze: { c: ['#bde58f', '#7ac74c', '#4f8f30'], g: 1.2, shape: 'leaf' },
  Eis: { c: ['#ffffff', '#bff4ff', '#96d9d6'], g: 2, shape: 'flake' }, Gestein: { c: ['#c9b07a', '#a08050', '#6d5a3a'], g: 9, shape: 'sq' },
  Boden: { c: ['#e2bf65', '#a08050'], g: 8, shape: 'sq' }, Geist: { c: ['#b89ae0', '#735797'], g: -1.5, shape: 'ring' },
  Psycho: { c: ['#ffb3d0', '#f95587'], g: -1, shape: 'ring' }, Gift: { c: ['#d79ae0', '#a33ea1'], g: -1.8, shape: 'bubble' },
  Unlicht: { c: ['#8a7464', '#3b2f28'], g: 2, shape: 'sq' }, Fee: { c: ['#ffd6ec', '#ff9ccf', '#ffffff'], g: -1, shape: 'star' },
  Flug: { c: ['#ffffff', '#dfe8ff', '#a98ff3'], g: 1, shape: 'feather' }, Käfer: { c: ['#c8d84a', '#a6b91a', '#6d7a12'], g: 4, shape: 'sq' },
  Stahl: { c: ['#ffffff', '#d0d4e0', '#b7b7ce'], g: 3, shape: 'spark' }, Drache: { c: ['#a08cff', '#6f35fc', '#4fd0ff'], g: -2, shape: 'flame' },
  Kampf: { c: ['#ffffff', '#ffb070', '#c22e28'], g: 2, shape: 'spark' }, Normal: { c: ['#ffffff', '#e8e2d0', '#c6c0a8'], g: 2, shape: 'sq' },
};
function burst(o, type, n, power = 1, size = 1) {
  const st = FX[type] || { c: [typeColor(type), '#ffffff'], g: 4, shape: 'sq' };
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (1 + Math.random() * 2.2) * power;
    const shape = Array.isArray(st.shape) ? st.shape[Math.floor(Math.random() * st.shape.length)] : st.shape;
    ui.fx.push({ x: o.x, y: o.y - 0.15, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.8 * power, g: st.g, drag: 2, color: st.c[Math.floor(Math.random() * st.c.length)], shape, size: (0.6 + Math.random() * 0.8) * size, life: 0.35 + Math.random() * 0.35, rot: Math.random() * 4 });
  }
}
const burstAt = (p, type, n, power, size) => burst({ x: p.x, y: p.y + 0.15 }, type, n, power, size);
// ein Partikel als kleine Pixelform zeichnen
function drawParticle(x, f, X, Y, s, now) {
  const q = Math.max(1, Math.round(s / 3)); // Pixelgröße
  switch (f.shape) {
    case 'spark': x.strokeStyle = f.color; x.lineWidth = Math.max(1.5, s / 2); x.beginPath(); x.moveTo(X, Y); x.lineTo(X - f.vx * ui.tile * 0.05, Y - f.vy * ui.tile * 0.05); x.stroke(); break;
    case 'ring': x.strokeStyle = f.color; x.lineWidth = 1.5; x.beginPath(); x.arc(X, Y, s, 0, 7); x.stroke(); break;
    case 'bubble': x.strokeStyle = f.color; x.lineWidth = Math.max(1, q); x.strokeRect(X - s / 2, Y - s / 2, s, s); x.fillStyle = '#ffffff'; x.fillRect(X - s / 2 + q, Y - s / 2 + q, q, q); break;
    case 'drop': x.fillRect(X - q / 2, Y - q * 1.5, q, q); x.fillRect(X - q, Y - q / 2, q * 2, q * 1.5); break; // Tropfen: Spitze oben, rund unten
    case 'flame': { const fl = (Math.floor(now / 70 + f.rot * 10) % 2) * q; x.fillStyle = '#ff6a3a'; x.fillRect(X - q, Y - q / 2, q * 2, q * 1.5); x.fillStyle = f.color; x.fillRect(X - q / 2, Y - q * 1.5 - fl, q, q * 1.5); break; }
    case 'bolt': x.fillRect(X, Y - q * 2, q, q); x.fillRect(X - q, Y - q, q * 2, q); x.fillRect(X - q, Y, q, q); x.fillRect(X - q * 2, Y + q, q, q); break; // Zickzack
    case 'leaf': { const o = Math.round(Math.sin(now / 120 + f.rot) * q); x.fillRect(X - q + o, Y - q / 2, q * 2, q); x.fillRect(X + o, Y - q * 1.5, q, q); x.fillStyle = '#2f6b25'; x.fillRect(X - q + o, Y + q / 2, q, q / 2); break; }
    case 'star': x.fillRect(X - q * 1.5, Y - q / 2, q * 3, q); x.fillRect(X - q / 2, Y - q * 1.5, q, q * 3); break; // Pluszeichen-Stern
    case 'flake': x.fillRect(X - q * 1.5, Y - q / 2, q * 3, q); x.fillRect(X - q / 2, Y - q * 1.5, q, q * 3); x.fillRect(X - q * 1.5, Y - q * 1.5, q, q); x.fillRect(X + q / 2, Y + q / 2, q, q); break;
    case 'feather': x.fillRect(X - q * 1.5, Y, q * 3, q); x.fillRect(X - q / 2, Y - q, q * 2, q); break;
    default: x.fillRect(X - s / 2, Y - s / 2, s, s);
  }
}
const ring = (o, color, r0 = 0.2, grow = 0.7, dur = 0.3) => ui.rings.push({ x: o.x, y: o.y - 0.1, color, r0, grow, dur, t: 0 });
const say = (o, text, color, size = 0.32, dur = 0.8, dy = -0.45) => ui.texts.push({ x: o.x, y: o.y + dy, text, color, size, dur, t: 0 });
const shake = (amount) => { ui.shakeAmt = Math.max(ui.shakeAmt, amount); };
// Haptik, gedrosselt (sonst brummt das Handy bei vielen Treffern dauernd)
let lastBuzz = 0;
function buzz(kind) {
  const t = performance.now();
  if (t - lastBuzz < (kind === 'tick' ? 110 : 60)) return;
  lastBuzz = t;
  haptic(kind);
}

function handleEvents() {
  for (const ev of game.events) {
    if (ev.type === 'shoot') { if (!ev.melee) sfx.attack(ev.moveType); burstAt({ x: ev.u.x + (ev.u.dir || 0) * 0.3, y: ev.u.y - (ev.u.dir ? 0.15 : 0.45) }, ev.moveType, 3, 0.5, 0.6); continue; }
    if (ev.type === 'go') { message(game.chaos ? 'Los! Fang die Pokébälle und setz die Pokémon ein.' : 'Los!'); haptic('medium'); continue; }
    if (ev.type === 'lifeLost') {
      banner(game.lives + 1 > 1 ? `♥ −1 · noch ${game.lives + 1}` : '♥ −1 · letztes Leben!', true);
      burst(ev.e, 'Unlicht', 16, 1.4); ui.flash = Math.max(ui.flash, 0.25); shake(T() * 0.15); haptic('strong'); sfx.lose();
      continue;
    }
    if (ev.type === 'lifeBought') { message(`♥ Leben gekauft – du hast jetzt ${game.lives + 1}.`); sfx.levelUp(); continue; }
    if (ev.type === 'statusArea') { // 3×3-Fläche um das Pokémon kurz aufleuchten lassen
      const a = ev.area, u = ev.u, sleep = ev.kind === 'sleep';
      ui.areas.push({ x: u.x - a - 0.5, y: u.y - a - 0.5, w: 2 * a + 1, h: 2 * a + 1, color: sleep ? '#cfe0ff' : '#f95587', t: 0, dur: 0.6 });
      for (let i = 0; i < 10; i++) burstAt({ x: u.x + (Math.random() - 0.5) * (2 * a + 1), y: u.y + (Math.random() - 0.5) * (2 * a + 1) }, sleep ? 'Fee' : 'Psycho', 1, 0.4, 0.8);
      continue;
    }
    if (ev.type === 'cloud') { // Giftwolke: Fläche vor dem Pokémon
      const u = ev.u, r = ev.range, w = ev.width, d = u.dir;
      const rect = d ? { x: d > 0 ? u.x + 0.3 : u.x - 0.3 - r, y: u.y - w / 2, w: r, h: w } : { x: u.x - w / 2, y: u.y - 0.3 - r, w, h: r };
      ui.areas.push({ ...rect, color: typeColor(ev.moveType), t: 0, dur: 0.7 });
      for (let i = 0; i < 14; i++) burstAt({ x: rect.x + Math.random() * rect.w, y: rect.y + Math.random() * rect.h }, ev.moveType, 1, 0.3, 1);
      continue;
    }
    if (ev.type === 'level') { say(ev.u, `Lv ${ev.level}!`, '#ffd23f', 0.3, 1, -0.75); ring(ev.u, '#ffd23f', 0.2, 0.6, 0.4); sfx.levelUp(); continue; }
    if (ev.type === 'evolve') { evolveFx(ev); continue; }
    if (ev.type === 'poison') { say(ev.e, String(ev.dmg), '#d48ae0', 0.24, 0.6, -0.3); burst(ev.e, 'Gift', 4, 0.6, 0.7); continue; }
    if (ev.type === 'handFull') { toast(`Höchstens ${D().chaos.handMax} Karten – setz erst eins ein.`); continue; }
    if (ev.type === 'collect' && ev.drop.dex) { const p = dropPos(ev.drop); say({ x: p.x, y: p.y }, species(ev.drop.dex).name + '!', '#ffffff', 0.28, 1); }
    if (ev.type === 'beam') { ui.beams.push({ u: ev.u, length: ev.length, fx: ev.fx, t: 0 }); sfx.attack({ ranke: 'Pflanze', feuer: 'Feuer', wasser: 'Wasser' }[ev.fx] || 'Normal'); shake(T() * 0.03); continue; }
    if (ev.type === 'heal') { ring(ev.u, '#7dff9a', 0.2, ev.radius, 0.6); for (const { o, amt } of ev.healed) { say(o, '+' + amt, '#7dff9a', 0.3); burst(o, 'Pflanze', 6, 0.8, 0.8); } if (ev.healed.length) sfx.levelUp(); continue; }
    if (ev.type === 'remove') { burst(ev.u, species(ev.u.dex).types[0], 10, 0.8); continue; }
    if (ev.type === 'boss') { banner('BOSS!', true); shake(T() * 0.08); haptic('strong'); sfx.wave(true); continue; }
    if (ev.type === 'sleep') { say(ev.e, 'schläft ein!', '#cfe0ff', 0.26, 1, -0.9); burst(ev.e, 'Fee', 8, 0.8); continue; }
    if (ev.type === 'confuse') { say(ev.e, 'verwirrt!', '#f95587', 0.28, 1, -0.9); burst(ev.e, 'Psycho', 10, 1.2); sfx.attack('Psycho'); continue; }
    if (ev.type === 'hit') {
      const o = ev.target, type = ev.move?.type || 'Normal';
      if (!ev.mine && ev.melee) sfx.attack(type);
      if (ev.crit && !ev.mine) sfx.crit();
      if (ev.mine) { burst(o, 'Unlicht', 4, 0.7, 0.8); sfx.bite(); continue; } // eigenes Pokémon wird gebissen
      sfx.hit();
      burst(o, type, ev.crit ? 18 : ev.eff > 1 ? 12 : 7, ev.crit ? 1.6 : 1, ev.crit ? 1.3 : 1);
      ring(o, typeColor(type), 0.15, ev.crit ? 1.1 : 0.6, ev.crit ? 0.4 : 0.25);
      if (ev.melee) ui.slashes.push({ x: o.x, y: o.y, color: typeColor(type), t: 0 });
      if (ev.crit) { say(o, 'VOLLTREFFER!', '#ffe066', 0.36, 1, -0.95); say(o, String(ev.dmg), '#ffe066', 0.55, 0.9); shake(T() * 0.12); ui.freeze = 0.07; ui.flash = Math.max(ui.flash, 0.12); buzz('medium'); }
      else { say(o, String(ev.dmg), ev.eff > 1 ? '#ffd23f' : ev.eff < 1 ? '#d0c8bc' : '#ffffff', ev.eff > 1 ? 0.42 : 0.32); if (ev.eff > 1) { shake(T() * 0.05); buzz('tick'); } }
    } else if (ev.type === 'defeat') {
      const e = ev.e, type = species(e.dex).types[0];
      burst(e, type, 20, 1.6, 1.2); burst(e, 'Fee', 8, 1.2, 0.8);
      ring(e, '#ffffff', 0.2, 1.3, 0.45);
      shake(T() * 0.07); buzz('tick'); sfx.ko();
    } else if (ev.type === 'explode') {
      sfx.explosion();
      ui.booms.push({ u: ev.u, r: ev.radius, t: 0, square: ev.square });
      burst(ev.u, 'Feuer', 34, 2.6, 1.5); burst(ev.u, 'Gestein', 16, 2.2, 1.2);
      shake(T() * 0.3); ui.flash = 0.3; ui.freeze = 0.1; haptic('strong');
    } else if (ev.type === 'wave') {
      if (game.endless) saveChaosBest(ev.wave + 1);
      banner(ev.final ? 'LETZTE WELLE!' : `WELLE ${ev.wave + 1}`, ev.final); sfx.wave(ev.final);
      if (ev.wave > 0 && ev.minRow >= D().grid.placeRows[0]) message('Eine weitere Reihe ist frei!');
      shake(T() * (ev.final ? 0.12 : 0.05)); haptic(ev.final ? 'strong' : 'medium');
    } else if (ev.type === 'weather') { renderWeatherChip(); message('Wetter: ' + weatherText(game.weather)); }
    else if (ev.type === 'lost') { burst(ev.u, 'Normal', 14, 1.2); say(ev.u, 'K.O.', '#ffb0b0', 0.34); shake(T() * 0.06); buzz('medium'); }
    else if (ev.type === 'place') { sfx.place(); burst(ev.u, 'Boden', 10, 1, 0.9); ring(ev.u, '#fff6c0', 0.2, 0.6, 0.3); }
    else if (ev.type === 'collect') { sfx.star(); const d = ev.drop, p = dropPos(d); const o = { x: p.x, y: p.y + 0.15 }; burst(o, 'Fee', 10, 1.2); burst(o, 'Elektro', 6, 1); ring(o, '#ffe066', 0.2, 0.8, 0.35); }
  }
  game.events.length = 0;
}
const T = () => ui.tile;
// Entwicklung: Lichtsäule, Funkenregen, Nachricht und Klang
function evolveFx(ev) {
  const u = ev.u;
  loadSprites(ev.to, u.gender);
  ring(u, '#ffffff', 0.1, 1.6, 0.7); ring(u, '#ffe066', 0.3, 1.2, 0.9);
  burst(u, 'Fee', 26, 1.8, 1.2);
  ui.flash = Math.max(ui.flash, 0.18); shake(T() * 0.06);
  message(`${species(ev.from).name} hat sich zu ${species(ev.to).name} entwickelt!`);
  sfx.evolve(); haptic('medium');
}
function banner(text, big) {
  const el = h('div.d-banner' + (big ? '.final' : ''), text);
  ui.root.append(el);
  setTimeout(() => el.remove(), 1900);
}
function renderWeatherChip() { const el = ui.root.querySelector('.d-weather'); el.textContent = weatherInfo(game.weather).icon; el.title = weatherText(game.weather); }

async function giveUp() {
  if (!game || game.over) return;
  if (await confirmDialog('Runde aufgeben?', 'Aufgeben')) game.over = { won: false, gaveUp: true };
}

function end() {
  ui.ended = true;
  const won = game.over.won;
  haptic(won ? 'medium' : 'strong');
  if (won) sfx.win(); else sfx.lose();
  const lv = chosen, tour = game.tournament, infinity = game.endless;
  const next = tour ? CFG.tournament.levels.find((x) => x.n === lv.n + 1) : game.chaos ? null : levelsList().find((x) => x.n === lv.n + 1);
  const reached = game.wave + 1, best = chaosBestBefore;
  if (infinity) saveChaosBest(reached);
  if (won && tour) app.act((s) => { s.defense ||= {}; s.defense.tournament = Math.max(s.defense.tournament || 0, lv.n); return { ok: true }; }, true);
  if (won && !game.chaos) app.act((s) => { s.defense ||= {}; s.defense.cleared = Math.max(s.defense.cleared || 0, lv.n); s.stats.defenseCleared = s.defense.cleared; return { ok: true }; }, true);
  const leave = (to) => { closeField(); game = null; pick = []; chosen = to; app.refresh(); document.dispatchEvent(new Event('defense-closed')); };
  const tourLv = (n) => CFG.tournament.levels.find((x) => x.n === n);
  const lostText = game.over.gaveUp ? 'Du hast aufgegeben.' : `Ein Gegner hat deinen Trainer erreicht (Welle ${game.wave + 1}).`;
  ui.root.append(h('div.b-result' + (won ? '.won' : ''),
    h('h2', infinity ? `Welle ${reached}` : won ? `Level ${lv.n} geschafft!` : 'Niederlage'),
    h('p', infinity ? `Du hast bis Welle ${reached} durchgehalten${reached > best ? ' – neuer Rekord!' : ` (Rekord: Welle ${best})`}.` : won ? `Du hast alle ${game.waves.length} Wellen abgewehrt.` : lostText),
    h('div.row', h('button.btn', { onclick: () => leave(null) }, tour ? 'Übersicht' : 'Roadmap'),
      infinity ? h('button.btn.primary.big', { onclick: () => { leave(null); startInfinity(); } }, '∞ Neuer Infinity Run')
        : tour ? (won && next ? h('button.btn.primary.big', { onclick: () => { leave(null); startTournament(next); } }, `Level ${next.n} ›`) : h('button.btn.primary.big', { onclick: () => { leave(null); startTournament(tourLv(lv.n)); } }, won ? 'Nochmal' : 'Nochmal versuchen'))
          : won && next ? h('button.btn.primary.big', { onclick: () => leave(next) }, `Level ${next.n} ›`) : h('button.btn.primary.big', { onclick: () => leave(lv) }, won ? 'Nochmal' : 'Nochmal versuchen'))));
}
