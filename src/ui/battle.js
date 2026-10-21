// Kampfmodus-Oberfläche: Team wählen (15), drei Verteidiger bestimmen, Gegner wählen – dann Echtzeit-Kampf im Vollbild.
// Handkarten werden aufs Spielfeld gezogen (oder antippen + Feld antippen). Kampf-Level/Entwicklungen gelten nur im Kampf.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { Battle, fromPokemon, fromCpu, towerRole, movesOf, moveOf, calcStats, STAT_NAMES, stonesFor, stoneName, stoneEvolution, canBattle } from '../game/battle.js';
import { typeColor, typeChip } from '../game/types.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { iconImg } from '../gfx/icons.js';
import { $, h, toast, modal, confirmDialog } from './dom.js';
import { trainContest, gainLines } from '../game/contest.js';
import { haptic } from '../haptics.js';

const B = () => CFG.battle;
const base = import.meta.env.BASE_URL;
const SIDE_COL = { p: '#4f9ff0', c: '#ef5d5d' };

let step = 'team';
let sel = [];
let towers = [];
let battle = null;
let arena = null; // DOM + Zeichenzustand während eines Kampfs
let oppNames = {}; // zufällige Namen der Computergegner (neu nach jedem Kampf)
const oppName = (o) => (oppNames[o.id] ||= pickName());
function pickName() {
  const used = new Set(Object.values(oppNames)), list = B().names.filter((n) => !used.has(n));
  return list[Math.floor(Math.random() * list.length)] || B().names[0];
}

// ================= Vorbereitung =================
export function initBattle() {
  if (import.meta.env.DEV) app.battle = { get b() { return battle; }, step: (dt) => frame(dt), start: (o) => startBattle(o) };
}

const owned = () => (app.state?.pokemon || []).filter((p) => canBattle(p.dex)).sort((a, b) => a.dex - b.dex || a.uid - b.uid);
const byUid = (uid) => app.state.pokemon.find((p) => p.uid === uid);
const moveName = (dex) => moveOf(CFG.battleData.pokemon[dex].move)?.name || '';
// Attacke mit Kategorie (physisch/speziell) und Reichweite (Nah/Fern)
const moveKind = (mv) => `${mv.cat === 'phys' ? 'Physisch' : 'Speziell'} · ${mv.range === 'nah' ? 'Nahkampf' : 'Fernkampf'}`;
const moveInfo = (dex) => { const mv = moveOf(CFG.battleData.pokemon[dex].move); return mv ? `${mv.name} (${moveKind(mv)})` : ''; };
const ROLE_COL = { heiler: '#78e68c', anfeuerer: '#ff9650', beschuetzer: '#8fa8ff' };
const lv5 = (p) => calcStats(p.dex, B().startLevel, p.ivs, p.evs);

export function renderBattleSetup() {
  const el = $('#scr-battle');
  if (!el || !app.state) return;
  const mons = owned();
  const N = B().teamSize, T = B().towerCount;
  // gespeicherte Auswahl übernehmen (nur noch vorhandene Pokémon)
  if (!sel.length && app.state.battle?.team?.length) sel = app.state.battle.team.filter((u) => mons.some((p) => p.uid === u)).slice(0, N);
  sel = sel.filter((u) => mons.some((p) => p.uid === u));
  if (!towers.length && app.state.battle?.towers?.length) towers = app.state.battle.towers.filter((u) => sel.includes(u));
  towers = towers.filter((u) => sel.includes(u)).slice(0, T);
  if (step !== 'team' && sel.length !== N) step = 'team';

  const portrait = (p) => h('img.bs-por', { src: portraitUrl(p.dex), alt: '', loading: 'lazy' });
  if (step === 'team') {
    const toggle = (p) => {
      const i = sel.indexOf(p.uid);
      if (i >= 0) sel.splice(i, 1); else if (sel.length < N) sel.push(p.uid); else { toast(`Höchstens ${N} Pokémon.`); return; }
      haptic('tick');
      renderBattleSetup();
    };
    el.replaceChildren(h('div.bs',
      h('div.bs-head', h('h2', 'Kampfteam'), h('span.bs-count' + (sel.length === N ? '.full' : ''), `${sel.length}/${N}`)),
      mons.length < N
        ? h('p.note.warn', `Du brauchst ${N} Pokémon für ein Kampfteam – du hast ${mons.length}. Ziehe am Automaten weitere!`)
        : h('p.note', `Wähle ${N} Pokémon. Im Kampf starten alle auf Level ${B().startLevel} und haben eine Attacke.`),
      h('div.bs-grid', mons.map((p) => h('button.bs-mon' + (sel.includes(p.uid) ? '.on' : ''), { onclick: () => toggle(p) },
        portrait(p), h('b', p.nick || species(p.dex).name), h('small', moveName(p.dex))))),
      h('div.bs-bar', h('button.btn.primary.big', { disabled: sel.length !== N, onclick: () => { step = 'towers'; if (!towers.length) towers = recommendTowers(); renderBattleSetup(); el.scrollTop = 0; } }, 'Weiter'))));
    return;
  }
  if (step === 'towers') {
    const toggle = (uid) => {
      const i = towers.indexOf(uid);
      if (i >= 0) towers.splice(i, 1); else if (towers.length < T) towers.push(uid); else { toast(`Genau ${T} Verteidiger – tippe erst einen anderen ab.`); return; }
      haptic('tick');
      renderBattleSetup();
    };
    const list = sel.map(byUid).sort((a, b) => towers.includes(b.uid) - towers.includes(a.uid));
    el.replaceChildren(h('div.bs',
      h('div.bs-head', h('h2', 'Verteidiger'), h('span.bs-count' + (towers.length === T ? '.full' : ''), `${towers.length}/${T}`)),
      h('p.note', `Wähle ${T} Verteidiger. Sie stehen fest auf dem Feld – fallen alle ${T}, ist die Runde verloren. Gut geeignet: viel KP und Verteidigung.`),
      h('div.bs-list', list.map((p) => {
        const role = B().towerRoles[towerRole(p.dex)];
        const st = lv5(p);
        return h('button.bs-row' + (towers.includes(p.uid) ? '.on' : ''), { onclick: () => toggle(p.uid) },
          portrait(p),
          h('div.bs-row-text',
            h('div', h('b', p.nick || species(p.dex).name), ' ', h('span.type-chips.left.inline', species(p.dex).types.map((t) => typeChip(t)))),
            h('small', `${role.icon} ${role.name} – ${role.text}`),
            h('small.bs-stats', st.map((v, i) => `${STAT_NAMES[i]} ${v}`).join(' · ')),
            h('small', `Attacke: ${moveInfo(p.dex)}`)),
          h('span.bs-check', towers.includes(p.uid) ? '🛡' : ''));
      })),
      h('div.bs-bar',
        h('button.btn', { onclick: () => { step = 'team'; renderBattleSetup(); } }, 'Zurück'),
        h('button.btn.primary.big', { disabled: towers.length !== T, onclick: () => { step = 'opponent'; renderBattleSetup(); el.scrollTop = 0; } }, 'Weiter'))));
    return;
  }
  // Gegnerwahl
  el.replaceChildren(h('div.bs',
    h('div.bs-head', h('h2', 'Gegner')),
    h('p.note', 'Wähle deinen Gegner.'),
    h('div.bs-list', B().opponents.map((o) => h('button.bs-row.opp', { onclick: () => startBattle(o) },
      trainerCanvas(o.trainer, 1),
      h('div.bs-row-text', h('b', oppName(o)), h('small', o.level),
        h('div.bs-mini', o.towers.map((d) => h('img', { src: portraitUrl(d), alt: species(d)?.name || '' })))),
      h('span.bs-go', '⚔')))),
    h('div.bs-bar', h('button.btn', { onclick: () => { step = 'towers'; renderBattleSetup(); } }, 'Zurück'))));
}

// Empfehlung: die drei Pokémon mit den höchsten Abwehrwerten (KP + Vert + SpVert)
function recommendTowers() {
  return sel.map(byUid).map((p) => { const s = lv5(p); return { uid: p.uid, v: s[0] + s[2] + s[4] }; })
    .sort((a, b) => b.v - a.v).slice(0, B().towerCount).map((x) => x.uid);
}

// Trainer-Sprite (64-px-Laufsheet, Blick nach unten)
const trainerImgs = new Map();
function trainerCanvas(n, scale = 1) {
  const c = h('canvas.trainer', { width: 64, height: 64 });
  c.style.width = c.style.height = 64 * scale * 0.75 + 'px';
  let img = trainerImgs.get(n);
  if (!img) { img = new Image(); img.src = `${base}art/trainer/${n}.png`; trainerImgs.set(n, img); }
  const draw = () => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, 64, 64); x.drawImage(img, 0, 0, 64, 64, 0, 0, 64, 64); };
  if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
  return c;
}

// ================= Kampf =================
function startBattle(o) {
  const N = B().teamSize;
  if (sel.length !== N || towers.length !== B().towerCount) { step = 'team'; renderBattleSetup(); return; }
  app.act((s) => { s.battle = { team: [...sel], towers: [...towers] }; return { ok: true }; });
  const player = {
    towers: towers.map((u) => fromPokemon(byUid(u))),
    team: sel.filter((u) => !towers.includes(u)).map((u) => fromPokemon(byUid(u))),
  };
  const cpu = { towers: o.towers.map((d, i) => fromCpu(d, o, i)), team: o.team.map((d, i) => fromCpu(d, o, i + 3)) };
  battle = new Battle({ player, cpu, opponent: o });
  openArena(o);
}

function openArena(o) {
  closeArena();
  const canvas = h('canvas.arena-canvas');
  const hand = h('div.b-hand');
  const ghost = h('img.b-ghost.hidden', { alt: '' });
  const msg = h('div.b-msg');
  const stoneBtn = h('button.b-btn', { onclick: openStoneShop, title: 'Entwicklungssteine', 'aria-label': 'Entwicklungssteine' }, '💎');
  const count = h('span.b-count');
  const top = h('div.b-top',
    trainerCanvas(o.trainer, 0.85),
    h('div.b-name', h('b', oppName(o)), h('small', o.level)),
    count,
    h('span.b-weather'),
    stoneBtn,
    h('button.b-btn', { onclick: giveUp, title: 'Aufgeben', 'aria-label': 'Aufgeben' }, '🏳'));
  const root = h('div.battle', top, h('div.b-field', canvas), hand, ghost, msg);
  document.body.append(root);
  document.body.classList.add('in-battle');
  arena = { root, canvas, ctx: canvas.getContext('2d'), hand, ghost, msg, fx: [], texts: [], flashes: [], sel: null, drag: null, hover: null, cards: null, count, pulses: [], wx: [], wxKind: null, last: performance.now(), raf: 0, opp: o };
  for (const u of [...battle.units, ...battle.roster('p'), ...battle.roster('c')]) loadSprites(u.dex, u.gender);
  renderWeather();
  message(`Wetter: ${battle.weatherInfo().icon} ${battle.weatherInfo().name}${battle.weatherInfo().types.length ? ' – ' + battle.weatherInfo().types.join(' & ') + ' stärker' : ''}`);
  arena.ro = new ResizeObserver(() => layout());
  arena.ro.observe(canvas.parentElement);
  canvas.addEventListener('pointerdown', onFieldDown);
  layout();
  const loop = (t) => {
    if (!arena) return;
    const dt = Math.min(0.1, (t - arena.last) / 1000);
    arena.last = t;
    frame(dt);
    arena.raf = requestAnimationFrame(loop);
  };
  arena.raf = requestAnimationFrame(loop);
}

function closeArena() {
  if (!arena) return;
  cancelAnimationFrame(arena.raf);
  arena.ro.disconnect();
  arena.root.remove();
  document.body.classList.remove('in-battle');
  arena = null;
}

function layout() {
  const { canvas } = arena;
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px';
  canvas.style.height = r.height + 'px';
  const G = B().grid;
  const tile = Math.floor(Math.min(r.width / G.cols, r.height / G.rows));
  Object.assign(arena, { dpr, w: r.width, h: r.height, tile, ox: Math.floor((r.width - tile * G.cols) / 2), oy: Math.floor((r.height - tile * G.rows) / 2) });
  arena.map = drawMap(tile);
}

// Ein Simulationsschritt + Zeichnen (auch als Testhaken nutzbar)
function frame(dt) {
  if (!arena || !battle) return;
  if (battle.paused && $('#modal').classList.contains('hidden')) battle.paused = false;
  battle.update(dt);
  handleEvents();
  draw(dt);
  renderHand();
  if (battle.over && !arena.ended) endBattle();
}

// ---------- Spielfeld (statisch, einmal pro Größe) ----------
function drawMap(tile) {
  const G = B().grid;
  const c = document.createElement('canvas');
  c.width = G.cols * tile; c.height = G.rows * tile;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  const px = Math.max(2, Math.round(tile / 12)); // "Pixel"-Größe für Details
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lanes = new Set(G.lanes);
  for (let r = 0; r < G.rows; r++) for (let col = 0; col < G.cols; col++) {
    const X = col * tile, Y = r * tile;
    if (r === G.riverRow) {
      if (lanes.has(col)) { // Brücke
        x.fillStyle = '#b07a45'; x.fillRect(X, Y, tile, tile);
        x.fillStyle = '#8a5a30';
        for (let k = 0; k < tile; k += px * 3) x.fillRect(X, Y + k, tile, px);
        x.fillStyle = '#6b4424'; x.fillRect(X, Y, px, tile); x.fillRect(X + tile - px, Y, px, tile);
      } else {
        x.fillStyle = '#5aa6de'; x.fillRect(X, Y, tile, tile);
        x.fillStyle = '#4b93cc'; x.fillRect(X, Y, tile, px); x.fillRect(X, Y + tile - px, tile, px);
      }
      continue;
    }
    x.fillStyle = (r + col) % 2 ? '#8fcd68' : '#97d36f';
    x.fillRect(X, Y, tile, tile);
    if (lanes.has(col)) { // Laufweg
      x.fillStyle = '#dcc48d'; x.fillRect(X + px * 2, Y, tile - px * 4, tile);
      x.fillStyle = '#ccb27a'; x.fillRect(X + px * 2, Y, px, tile); x.fillRect(X + tile - px * 3, Y, px, tile);
    } else if (rnd() < 0.45) { // Blümchen / Grasbüschel
      const fx = X + Math.floor(rnd() * (tile - px * 3)), fy = Y + Math.floor(rnd() * (tile - px * 3));
      if (rnd() < 0.5) { x.fillStyle = ['#fff3a8', '#ffc4d8', '#ffffff'][Math.floor(rnd() * 3)]; x.fillRect(fx, fy, px, px); x.fillRect(fx - px, fy + px, px * 3, px); x.fillRect(fx, fy + px * 2, px, px); }
      else { x.fillStyle = '#76b955'; x.fillRect(fx, fy, px, px * 2); x.fillRect(fx + px * 2, fy - px, px, px * 3); }
    }
  }
  // feines Raster für die Platzierung
  x.fillStyle = 'rgba(40,60,30,.10)';
  for (let col = 1; col < G.cols; col++) x.fillRect(col * tile, 0, 1, c.height);
  for (let r = 1; r < G.rows; r++) x.fillRect(0, r * tile, c.width, 1);
  // Sockel der Verteidiger
  for (const side of ['p', 'c']) for (const [cx, cy] of G.towerCells) {
    const r = side === 'p' ? cy : G.rows - 1 - cy;
    const X = (cx + 0.5) * tile, Y = (r + 0.5) * tile;
    x.fillStyle = '#7d7462'; x.beginPath(); x.ellipse(X, Y + tile * 0.12, tile * 0.62, tile * 0.42, 0, 0, 7); x.fill();
    x.fillStyle = '#c9c2b0'; x.beginPath(); x.ellipse(X, Y + tile * 0.06, tile * 0.56, tile * 0.36, 0, 0, 7); x.fill();
    x.strokeStyle = SIDE_COL[side]; x.lineWidth = px; x.beginPath(); x.ellipse(X, Y + tile * 0.06, tile * 0.46, tile * 0.28, 0, 0, 7); x.stroke();
  }
  return c;
}

// ---------- Zeichnen ----------
function draw(dt) {
  const A = arena, x = A.ctx, T = A.tile, G = B().grid;
  const now = performance.now();
  x.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
  x.imageSmoothingEnabled = false;
  x.fillStyle = '#6aa84f'; x.fillRect(0, 0, A.w, A.h);
  x.drawImage(A.map, A.ox, A.oy);
  const P = (u) => [A.ox + u.x * T, A.oy + u.y * T];
  // Wasser glitzert
  x.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 10; i++) {
    const col = (i * 37 + Math.floor(now / 900)) % G.cols;
    if (G.lanes.includes(col)) continue;
    const fx = ((now / 30 + i * 53) % T);
    x.fillRect(A.ox + col * T + fx, A.oy + G.riverRow * T + T * (0.3 + (i % 3) * 0.2), Math.max(2, T / 10), 2);
  }
  // Platzierung: erlaubte Felder hervorheben
  if (A.drag || A.sel) {
    x.fillStyle = 'rgba(255,255,255,.16)';
    for (let r = 0; r < G.rows; r++) for (let col = 0; col < G.cols; col++) if (battle.canPlace('p', col, r)) x.fillRect(A.ox + col * T + 1, A.oy + r * T + 1, T - 2, T - 2);
    if (A.hover) {
      const ok = battle.canPlace('p', A.hover[0], A.hover[1]);
      x.strokeStyle = ok ? '#fff' : 'rgba(255,90,90,.9)'; x.lineWidth = 2;
      x.strokeRect(A.ox + A.hover[0] * T + 1, A.oy + A.hover[1] * T + 1, T - 2, T - 2);
    }
  }
  // Wirkungskreise unterstützender Verteidiger
  for (const t of battle.units) {
    if (!t.tower || t.hp <= 0) continue;
    const R = B().towerRoles[t.role];
    if (!R?.radius) continue;
    const [X, Y] = P(t);
    x.fillStyle = t.role === 'heiler' ? 'rgba(120,230,140,.10)' : t.role === 'anfeuerer' ? 'rgba(255,150,80,.10)' : 'rgba(150,170,255,.10)';
    x.beginPath(); x.arc(X, Y, R.radius * T, 0, 7); x.fill();
    // Rand des Wirkungsbereichs (gestrichelt, in der Farbe der Fähigkeit)
    x.save(); x.setLineDash([Math.max(3, T / 8), Math.max(3, T / 8)]); x.lineDashOffset = -now / 60;
    x.strokeStyle = ROLE_COL[t.role]; x.globalAlpha = 0.55; x.lineWidth = 2;
    x.beginPath(); x.arc(X, Y, R.radius * T, 0, 7); x.stroke(); x.restore();
  }
  // Impuls, wenn ein Verteidiger seine Fähigkeit ausführt: Ring breitet sich bis zum Rand aus
  A.pulses = A.pulses.filter((pl) => {
    pl.age += dt;
    if (pl.age > 0.8 || pl.f.hp <= 0) return false;
    const [X, Y] = P(pl.f), k = pl.age / 0.8;
    x.globalAlpha = 1 - k; x.strokeStyle = ROLE_COL[pl.role]; x.lineWidth = Math.max(2, T / 10);
    x.beginPath(); x.arc(X, Y, pl.radius * T * (0.25 + 0.75 * k), 0, 7); x.stroke();
    x.globalAlpha = 1;
    return true;
  });
  // Pokémon (nach Tiefe sortiert)
  const list = battle.units.slice().sort((a, b) => a.y - b.y);
  for (const u of list) drawUnit(x, u, P(u), T, now);
  // Geschosse
  for (const p of battle.projectiles) {
    const X = A.ox + p.x * T, Y = A.oy + p.y * T - T * 0.2, s = Math.max(3, Math.round(T / 9));
    const col = typeColor(p.type);
    const d = Math.hypot(p.to.x - p.x, p.to.y - p.y) || 1, ux = (p.x - p.to.x) / d, uy = (p.y - p.to.y) / d;
    for (let k = 3; k >= 1; k--) { x.globalAlpha = 0.25 * (4 - k) / 3; x.fillStyle = col; x.fillRect(X + ux * k * s * 1.3 - s / 2, Y + uy * k * s * 1.3 - s / 2, s * 0.8, s * 0.8); }
    x.globalAlpha = 1;
    x.fillStyle = '#fff'; x.fillRect(X - s / 2 - 1, Y - s / 2 - 1, s + 2, s + 2);
    x.fillStyle = col; x.fillRect(X - s / 2, Y - s / 2, s, s);
  }
  // Partikel
  A.fx = A.fx.filter((f) => {
    f.life -= dt;
    if (f.life <= 0) return false;
    f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.g || 0) * dt;
    x.globalAlpha = Math.min(1, f.life / 0.25);
    x.fillStyle = f.color;
    const s = f.size * T / 40;
    x.fillRect(A.ox + f.x * T - s / 2, A.oy + f.y * T - s / 2, s, s);
    return true;
  });
  x.globalAlpha = 1;
  // Entwicklungs-Blitze
  A.flashes = A.flashes.filter((f) => {
    f.t += dt;
    if (f.t > 1.1) return false;
    const [X, Y] = P(f.u);
    const k = f.t / 1.1;
    x.globalAlpha = 1 - k;
    x.fillStyle = '#fff';
    x.beginPath(); x.arc(X, Y - T * 0.2, T * (0.4 + k * 1.4), 0, 7); x.fill();
    x.globalAlpha = 1;
    return true;
  });
  drawWeather(x, dt, now);
  // schwebende Texte
  A.texts = A.texts.filter((t) => {
    t.t += dt;
    if (t.t > t.dur) return false;
    const X = A.ox + t.x * T, Y = A.oy + t.y * T - t.t * T * 0.7;
    x.globalAlpha = Math.min(1, (t.dur - t.t) / 0.3);
    x.font = `600 ${Math.round(T * (t.size || 0.34))}px 'Pixelify Sans', sans-serif`;
    x.textAlign = 'center';
    x.lineWidth = 3; x.strokeStyle = 'rgba(40,25,20,.9)';
    x.strokeText(t.text, X, Y);
    x.fillStyle = t.color; x.fillText(t.text, X, Y);
    x.globalAlpha = 1;
    return true;
  });
}

// Sichtbare Höhe der Figur in der Ruhe-Animation (ohne leeren Bildrand), einmal pro Sprite gemessen
const bodyCache = new WeakMap();
function bodyHeight(e) {
  const a = e.anims.Idle;
  if (bodyCache.has(a)) return bodyCache.get(a);
  let top = a.fh, bottom = -1;
  try {
    const c = document.createElement('canvas');
    c.width = a.img.width; c.height = a.fh;
    const x = c.getContext('2d');
    x.drawImage(a.img, 0, 0, a.img.width, a.fh, 0, 0, a.img.width, a.fh); // Blickrichtung unten, alle Frames
    const d = x.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < a.fh; y++) for (let i = 0; i < c.width; i++) if (d[(y * c.width + i) * 4 + 3] > 20) { top = Math.min(top, y); bottom = Math.max(bottom, y); break; }
  } catch { /* ohne Messung: ganze Bildhöhe */ }
  const hgt = bottom >= top ? bottom - top + 1 : a.fh;
  bodyCache.set(a, hgt);
  return hgt;
}

// ---------- Wetter-Effekte ----------
function drawWeather(x, dt, now) {
  const A = arena, w = battle.weather, W = A.w, H = A.h, T = A.tile;
  if (A.wxKind !== w) { // Partikel für das neue Wetter
    A.wxKind = w;
    const n = { regen: 70, schnee: 55, wind: 34, sonne: 6, bewoelkt: 4, nacht: 18 }[w] || 0;
    A.wx = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.5 + Math.random() * 0.8, s: Math.random() }));
  }
  const tint = { sonne: 'rgba(255,200,80,.10)', regen: 'rgba(50,80,150,.13)', schnee: 'rgba(225,235,255,.16)', wind: 'rgba(230,240,220,.06)', nacht: 'rgba(15,25,70,.34)', bewoelkt: 'rgba(110,115,130,.16)' }[w];
  if (tint) { x.fillStyle = tint; x.fillRect(0, 0, W, H); }
  const px = Math.max(2, Math.round(T / 14));
  for (const p of A.wx) {
    if (w === 'regen') { p.y += H * 1.6 * p.v * dt; p.x += H * 0.25 * dt; x.fillStyle = 'rgba(200,220,255,.65)'; for (let k = 0; k < 4; k++) x.fillRect(p.x - k * px * 0.3, p.y - k * px, px * 0.7, px); }
    else if (w === 'schnee') { p.y += H * 0.12 * p.v * dt; p.x += Math.sin(now / 700 + p.s * 9) * 12 * dt; x.fillStyle = '#ffffff'; x.fillRect(p.x, p.y, px, px); }
    else if (w === 'wind') { p.x += W * 0.9 * p.v * dt; p.y += Math.sin(now / 300 + p.s * 7) * 8 * dt; x.fillStyle = p.s < 0.3 ? '#5fae3a' : 'rgba(255,255,255,.7)'; if (p.s < 0.3) x.fillRect(p.x, p.y, px * 2, px * 1.5); else x.fillRect(p.x, p.y, T * 1.1, Math.max(2, px * 0.7)); }
    else if (w === 'sonne') { p.x += 6 * dt; x.fillStyle = 'rgba(255,240,170,.08)'; x.save(); x.translate(p.x, 0); x.rotate(0.35); x.fillRect(0, -H * 0.2, T * (0.5 + p.s), H * 1.6); x.restore(); }
    else if (w === 'bewoelkt') { p.x += 10 * p.v * dt; x.fillStyle = 'rgba(40,40,60,.07)'; x.beginPath(); x.ellipse(p.x, p.y, T * 2.5, T * 1.2, 0, 0, 7); x.fill(); }
    else if (w === 'nacht') { const a = 0.4 + 0.4 * Math.sin(now / 400 + p.s * 20); x.fillStyle = `rgba(255,250,170,${a})`; x.fillRect(p.x, p.y, px, px); } // Glühwürmchen
    if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W; }
    if (p.x > W + T * 3) { p.x = -T * 3; p.y = Math.random() * H; }
  }
}
function renderWeather() {
  const wi = battle.weatherInfo(), el = arena.root.querySelector('.b-weather');
  el.textContent = wi.icon;
  el.title = wi.name + (wi.types.length ? ': ' + wi.types.join(' & ') + ' stärker' : '');
}

function drawUnit(x, u, [X, Y], T, now) {
  const tower = u.tower;
  const down = u.hp <= 0;
  if (down && tower) { // besiegter Verteidiger: nur noch Trümmer
    x.fillStyle = '#6d6556';
    for (let k = 0; k < 5; k++) x.fillRect(X - T * 0.35 + k * T * 0.15, Y - T * 0.05 + ((k * 7) % 3) * T * 0.05, T * 0.12, T * 0.1);
    return;
  }
  if (!tower) { // Schatten in Teamfarbe
    x.fillStyle = 'rgba(0,0,0,.18)'; x.beginPath(); x.ellipse(X, Y + T * 0.22, T * 0.34, T * 0.14, 0, 0, 7); x.fill();
    x.strokeStyle = SIDE_COL[u.side]; x.lineWidth = 2; x.beginPath(); x.ellipse(X, Y + T * 0.22, T * 0.34, T * 0.14, 0, 0, 7); x.stroke();
  }
  const e = loadSprites(u.dex, u.gender);
  let topY = Infinity;
  if (e.ready) {
    const bt = battle.t;
    let name = u.moving ? 'Walk' : 'Idle', ms = now, once = false;
    if (down) { name = 'Hurt'; ms = (bt - u.faintT) * 1000; once = true; }
    else if (u.anim && (bt - u.anim.t0) * 1000 < (e.anims[u.anim.name]?.total || 0) * (1000 / 60)) { name = u.anim.name; ms = (bt - u.anim.t0) * 1000; once = true; }
    else if (u.hurtT != null && bt - u.hurtT < 0.25) { name = 'Hurt'; ms = (bt - u.hurtT) * 1000; once = true; }
    const f = frameOf(e, name, u.dir ?? 0, ms, once);
    const SP = B().sprite, body = bodyHeight(e);
    let s = T / SP.pixelsPerTile;
    if (body * s > T * SP.maxHeight) s = (T * SP.maxHeight) / body; // sehr große Pokémon begrenzen (nach sichtbarer Figur, nicht Bildrand)
    if (tower) s *= B().tower.scale;
    topY = Y - T * 0.12 - (body * s) / 2; // Oberkante der sichtbaren Figur (ungefähr)
    if (down) x.globalAlpha = Math.max(0, 1 - (battle.t - u.faintT) / 0.7);
    if (u.spawnT != null && battle.t - u.spawnT < 0.3) x.globalAlpha = (battle.t - u.spawnT) / 0.3;
    x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(X - (f.fw * s) / 2), Math.round(Y - T * 0.12 - (f.fh * s) / 2), Math.round(f.fw * s), Math.round(f.fh * s));
    x.globalAlpha = 1;
  }
  if (down) return;
  // KP-Balken in Teamfarbe + Level
  const bw = T * (tower ? 1.3 : 0.8), bh = Math.max(4, Math.round(T * (tower ? 0.14 : 0.1)));
  const by = Math.min(Y - T * (tower ? 1.05 : 0.72), topY - bh - 2), bx = X - bw / 2;
  x.fillStyle = '#2f2622'; x.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  x.fillStyle = '#5a4d45'; x.fillRect(bx, by, bw, bh);
  x.fillStyle = SIDE_COL[u.side]; x.fillRect(bx, by, Math.max(0, bw * u.hp / u.maxHp), bh);
  x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(bx, by, Math.max(0, bw * u.hp / u.maxHp), Math.max(1, bh / 3));
  x.font = `600 ${Math.round(T * 0.26)}px 'Pixelify Sans', sans-serif`;
  x.textAlign = 'right';
  x.lineWidth = 3; x.strokeStyle = 'rgba(40,25,20,.9)';
  const lv = tower ? `${B().towerRoles[u.role]?.icon || ''} ${u.level}` : String(u.level);
  x.strokeText(lv, bx - 2, by + bh); x.fillStyle = '#fff'; x.fillText(lv, bx - 2, by + bh);
  if (!tower) { // Symbole aktiver Verteidiger-Boni rechts neben dem Balken
    const au = battle.auraOf(u), marks = [];
    if (au.atk > 1) marks.push(['▲', ROLE_COL.anfeuerer]);
    if (au.def > 1) marks.push(['◆', ROLE_COL.beschuetzer]);
    if (u.healFx && battle.t - u.healFx < 1) marks.push(['✚', ROLE_COL.heiler]);
    x.textAlign = 'left';
    marks.forEach(([ic, col], i) => { const mx = bx + bw + 2 + i * T * 0.24; x.strokeText(ic, mx, by + bh); x.fillStyle = col; x.fillText(ic, mx, by + bh); });
  }
}

// ---------- Ereignisse -> Effekte ----------
function burst(u, color, n = 8, speed = 2.2, size = 5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
    arena.fx.push({ x: u.x, y: u.y - 0.15, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, g: 3, color, life: 0.35 + Math.random() * 0.25, size });
  }
}
const say = (u, text, color, size, dur = 0.9, dy = -0.6) => arena.texts.push({ x: u.x, y: u.y + dy, text, color, size, dur, t: 0 });
const nameOf = (u) => u.nick || species(u.dex).name;
function message(text) {
  const el = h('div', text);
  arena.msg.append(el);
  setTimeout(() => el.remove(), 2600);
}

function handleEvents() {
  for (const ev of battle.events) {
    const u = ev.f;
    if (ev.type === 'hit') {
      const mv = moveOf(ev.move);
      burst(u, typeColor(mv.type), mv.cat === 'phys' ? 7 : 10, mv.cat === 'phys' ? 1.8 : 2.4);
      say(u, `-${ev.dmg}`, '#fff', 0.32, 0.7);
      if (ev.eff > 1) say(u, 'Sehr effektiv!', '#ffe066', 0.26, 1, -0.95);
      else if (ev.eff === 0) say(u, 'Keine Wirkung', '#cfcfcf', 0.24, 1, -0.95);
      else if (ev.eff < 1) say(u, 'Nicht sehr effektiv', '#d8d0c0', 0.22, 1, -0.95);
      if (u.tower && u.side === 'p') haptic('tick');
    } else if (ev.type === 'miss') say(u, 'Daneben!', '#e8e8e8', 0.26, 0.8);
    else if (ev.type === 'faint') {
      burst(u, '#ffffff', u.tower ? 22 : 10, u.tower ? 3.2 : 2, u.tower ? 7 : 5);
      if (u.tower) { haptic('strong'); message(u.side === 'p' ? `Dein Verteidiger ${nameOf(u)} wurde besiegt!` : `${nameOf(u)} (Verteidiger) besiegt!`); }
    } else if (ev.type === 'level') {
      say(u, `Lv ${ev.level}!`, '#ffd23f', 0.3, 1.1, -0.9);
      if (u.side === 'p') haptic('tick');
    } else if (ev.type === 'evolve') {
      arena.flashes.push({ u, t: 0 });
      loadSprites(ev.to, u.gender);
      burst(u, '#fff6c0', 18, 3, 6);
      message(`${u.side === 'p' ? '' : 'Gegnerisches '}${species(ev.from).name} hat sich zu ${species(ev.to).name} entwickelt!`);
      if (u.side === 'p') haptic('medium');
    } else if (ev.type === 'pulse') {
      arena.pulses.push({ f: u, role: ev.role, radius: ev.radius, age: 0 });
      say(u, B().towerRoles[ev.role].icon, ROLE_COL[ev.role], 0.42, 0.8, -1.25);
    } else if (ev.type === 'weather') {
      const wi = battle.weatherInfo();
      renderWeather();
      message(`Wetter: ${wi.icon} ${wi.name}${wi.types.length ? ' – ' + wi.types.join(' & ') + ' stärker' : ''}`);
    } else if (ev.type === 'heal') {
      u.healFx = battle.t;
      say(u, `+${ev.amt}`, '#7dff9a', 0.28, 0.8);
      for (let i = 0; i < 4; i++) arena.fx.push({ x: u.x + (Math.random() - 0.5) * 0.5, y: u.y, vx: 0, vy: -1.2, color: '#7dff9a', life: 0.6, size: 5 });
    } else if (ev.type === 'place') {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; arena.fx.push({ x: u.x, y: u.y + 0.2, vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 0.6, color: '#efe3c0', life: 0.35, size: 5 }); }
      loadSprites(u.dex, u.gender);
    }
  }
  battle.events.length = 0;
}

// ---------- Kartenleiste (wischbar, frei wählbar) ----------
// Karten werden einmal pro Kampf gebaut und nur bei Änderungen aktualisiert (damit die Scroll-Position bleibt).
function renderHand() {
  const A = arena, S = battle.sides.p, full = battle.activeCount('p') >= B().maxActive;
  A.count.textContent = `${battle.activeCount('p')}/${B().maxActive} aktiv`;
  A.count.classList.toggle('full', full);
  if (!A.cards) {
    A.cards = new Map();
    A.hand.replaceChildren(...S.bench.map((f) => {
      const card = h('div.bcard');
      card.addEventListener('pointerdown', (e) => onCardDown(e, f));
      A.cards.set(f.id, { el: card, key: '' });
      return card;
    }));
  }
  for (const f of S.bench) {
    const c = A.cards.get(f.id);
    const cool = f.state === 'bench' && !battle.isReady(f) ? Math.ceil(f.readyAt - battle.t) : 0;
    const st = f.state === 'field' ? 'field' : cool ? 'cool' : full ? 'blocked' : 'ready';
    const key = `${f.dex}|${f.level}|${st}|${cool}|${A.sel === f}|${A.drag?.f === f}`;
    if (key === c.key) continue;
    c.key = key;
    const sp = species(f.dex), mv = moveOf(movesOf(f)[0]);
    c.el.className = 'bcard ' + st + (A.sel === f ? ' sel' : '') + (A.drag?.f === f ? ' dragging' : '');
    c.el.style.setProperty('--tc', typeColor(sp.types[0]));
    c.el.style.setProperty('--tc2', typeColor(sp.types[1] || sp.types[0]));
    c.el.replaceChildren(
      h('span.bcard-lv', `Lv ${f.level}`),
      h('img', { src: portraitUrl(f.dex), alt: '', draggable: false }),
      h('b', f.nick || sp.name),
      h('small', h('i.tdot', { style: { background: typeColor(mv.type) } }), mv.name, h('span.rng', mv.range === 'nah' ? ' ✊' : ' ➶')),
      ...(st === 'cool' ? [h('span.bcard-cool', `${cool} s`)] : st === 'field' ? [h('span.bcard-cool.on', 'im Kampf')] : []));
  }
}

function cellAt(clientX, clientY) {
  const A = arena, r = A.canvas.getBoundingClientRect();
  const col = Math.floor((clientX - r.left - A.ox) / A.tile), row = Math.floor((clientY - r.top - A.oy) / A.tile);
  const G = B().grid;
  return col >= 0 && row >= 0 && col < G.cols && row < G.rows ? [col, row] : null;
}
// Eingesetzt wird immer in der hintersten eigenen Reihe – die Spalte bestimmt der Finger
const spawnCell = (c) => (c ? [c[0], B().grid.spawnRow] : null);

function blockedMsg(f) {
  if (f.state === 'field') return 'Ist schon im Kampf.';
  if (!battle.isReady(f)) return `Erholt sich noch ${Math.ceil(f.readyAt - battle.t)} s.`;
  if (battle.activeCount('p') >= B().maxActive) return `Höchstens ${B().maxActive} Pokémon gleichzeitig auf dem Feld.`;
  return '';
}

// Waagerecht wischen = Leiste scrollen, nach oben ziehen = Pokémon aufs Feld ziehen, antippen = auswählen
function onCardDown(e, f) {
  if (battle.over) return;
  const A = arena;
  const sx = e.clientX, sy = e.clientY;
  let mode = null; // null | 'drag' | 'scroll'
  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!mode) {
      if (Math.hypot(dx, dy) < 8) return;
      if (dy < 0 && Math.abs(dy) > Math.abs(dx)) {
        const why = blockedMsg(f);
        if (why) { toast(why); mode = 'scroll'; return; }
        mode = 'drag'; A.drag = { f }; A.ghost.src = portraitUrl(f.dex); A.ghost.classList.remove('hidden'); haptic('tick');
      } else { mode = 'scroll'; return; }
    }
    if (mode !== 'drag') return;
    ev.preventDefault();
    A.ghost.style.transform = `translate(${ev.clientX - 28}px, ${ev.clientY - 60}px)`;
    A.hover = spawnCell(cellAt(ev.clientX, ev.clientY - 30));
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    A.ghost.classList.add('hidden');
    if (mode === 'drag') {
      const c = ev.type === 'pointerup' ? spawnCell(cellAt(ev.clientX, ev.clientY - 30)) : null;
      A.drag = null; A.hover = null;
      if (c && tryPlace(f, c)) A.sel = null;
    } else if (!mode) { // Antippen: Karte wählen, dann eine Spalte auf dem Feld antippen
      const why = blockedMsg(f);
      if (why) toast(why); else A.sel = A.sel === f ? null : f;
    }
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function onFieldDown(e) {
  const A = arena;
  if (!A.sel || battle.over) return;
  const c = spawnCell(cellAt(e.clientX, e.clientY));
  if (c && tryPlace(A.sel, c)) A.sel = null;
}

function tryPlace(f, [col, row]) {
  const why = blockedMsg(f);
  if (why) { toast(why); return false; }
  const ok = battle.place('p', f, col, row);
  if (ok) haptic('medium');
  return ok;
}

// ---------- Kampf-Shop: Entwicklungssteine ----------
function openStoneShop() {
  if (!battle || battle.over) return;
  const price = B().stones.price;
  battle.paused = true;
  modal((el, close) => {
    const offers = [];
    for (const f of battle.roster('p')) for (const st of stonesFor(f)) offers.push({ f, st, to: stoneEvolution(f, st).to });
    const where = (f) => (f.tower ? 'Verteidiger' : f.state === 'field' ? 'auf dem Feld' : 'in der Leiste');
    el.append(h('h3', '💎 Entwicklungssteine'),
      h('p.note', `Entwickelt ein Pokémon sofort – nur für diesen Kampf. Du hast `, iconImg('coin', 2), ` ${app.state.coins}.`),
      offers.length
        ? h('div.inv', offers.map(({ f, st, to }) => h('div.stone-row',
          h('img', { src: portraitUrl(f.dex), alt: '' }),
          h('div', h('b', `${species(f.dex).name} → ${species(to).name}`), h('small', `${stoneName(st)} · ${where(f)}`)),
          h('button.btn.gold.small', {
            disabled: app.state.coins < price,
            onclick: () => {
              const r = app.act((s) => (s.coins < price ? { ok: false, msg: 'Nicht genug Glücksmünzen.' } : ((s.coins -= price), { ok: true })), true);
              if (r.ok === false) return;
              battle.useStone(f, st);
              handleEvents();
              close();
            },
          }, iconImg('coin', 2), String(price)))))
        : h('p', 'Gerade kann sich keines deiner Pokémon durch einen Stein entwickeln.'),
      h('div.row', h('button.btn', { onclick: close }, 'Zurück zum Kampf')));
  });
}

async function giveUp() {
  if (!battle || battle.over) return;
  battle.paused = true;
  if (await confirmDialog('Kampf aufgeben? Die Runde zählt als verloren.', 'Aufgeben')) {
    battle.over = { winner: 'c', t: battle.t, gaveUp: true };
  }
}

// ---------- Kampfende ----------
function endBattle() {
  arena.ended = true;
  const won = battle.over.winner === 'p';
  haptic(won ? 'medium' : 'tick');
  // EVs dauerhaft übernehmen (Level und Entwicklungen verfallen)
  const gains = [];
  const all = [...battle.sides.p.towers, ...battle.roster('p'), ...battle.sides.p.bench];
  const seen = new Set();
  for (const f of all) {
    if (seen.has(f.id) || f.uid == null) continue;
    seen.add(f.id);
    if (f.evGain.some((v) => v > 0)) gains.push(f);
  }
  if (B().stats.evsPersist && gains.length) {
    app.act((s) => {
      for (const f of gains) {
        const p = s.pokemon.find((q) => q.uid === f.uid);
        if (!p) continue;
        const S = B().stats;
        for (let i = 0; i < 6; i++) {
          const total = p.evs.reduce((a, b) => a + b, 0);
          p.evs[i] += Math.max(0, Math.min(f.evGain[i], S.evMaxStat - p.evs[i], S.evMaxTotal - total));
        }
      }
      return { ok: true };
    }, true);
  }
  // Siege zählen (Erfolge) und Kampf als Training: eingesetzte Pokémon und Verteidiger steigern Wettbewerbswerte
  const trained = [];
  app.act((s, t) => {
    s.stats.battlesPlayed = (s.stats.battlesPlayed || 0) + 1;
    if (won) { s.stats.battlesWon = (s.stats.battlesWon || 0) + 1; s.stats.beaten ||= {}; s.stats.beaten[battle.opponent.id] = true; }
    const used = new Set();
    for (const f of [...battle.sides.p.towers, ...battle.sides.p.bench]) if (f.uid != null && (f.tower || f.deployed) && !used.has(f.uid)) {
      used.add(f.uid);
      const p = s.pokemon.find((q) => q.uid === f.uid);
      const g = p && trainContest(p, 'kampf', t);
      if (g && Object.keys(g).length) trained.push(`${p.nick || species(p.dex).name}: ${gainLines(g).join(', ')}`);
    }
    return { ok: true };
  }, true);
  const best = all.filter((f, i, a) => a.indexOf(f) === i && f.uid != null).sort((a, b) => b.level - a.level || b.kos - a.kos).slice(0, 3);
  const box = h('div.b-result' + (won ? '.won' : ''),
    h('h2', won ? 'Sieg!' : 'Niederlage'),
    h('p', won ? `Du hast alle Verteidiger von ${oppName(battle.opponent)} besiegt.` : battle.over.gaveUp ? 'Du hast aufgegeben.' : 'Alle deine Verteidiger wurden besiegt.'),
    best.length ? h('div.b-best', best.map((f) => h('div', h('img', { src: portraitUrl(f.dex), alt: '' }), h('small', `${species(f.dex).name} · Lv ${f.level}`)))) : null,
    B().stats.evsPersist && gains.length ? h('p.note', `${gains.length} Pokémon haben EVs gesammelt (bleiben erhalten).`) : null,
    trained.length ? h('div.b-trained', trained.slice(0, 6).map((l) => h('div', '✦ ' + l)), trained.length > 6 ? h('div', `… und ${trained.length - 6} weitere`) : null) : null,
    h('p.note', 'Level und Entwicklungen aus dem Kampf verfallen jetzt wieder.'),
    h('button.btn.primary.big', { onclick: () => { closeArena(); battle = null; oppNames = {}; step = 'opponent'; renderBattleSetup(); } }, 'Weiter'));
  arena.root.append(box);
}
