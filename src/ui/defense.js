// PokeDefense – Oberfläche: Team (6) mit Blick auf die angekündigten Gegner-Typen wählen (ohne Zeitlimit),
// dann das vertikale Spielfeld: Sterne einsammeln, Karten antippen und Pokémon auf das untere Feld setzen.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { Defense, roleOf, costOf, rechargeOf, abilityText, rollTheme } from '../game/defense.js';
import { fromPokemon, canBattle, moveOf, bdata } from '../game/battle.js';
import { typeColor, typeChip } from '../game/types.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { $, h, toast, confirmDialog, modal } from './dom.js';
import { teamPicker } from './teampick.js';
import { haptic } from '../haptics.js';
import { drawWeather } from './weatherfx.js';
import { sfx } from '../audio.js';
import { weatherInfo, weatherText } from '../game/weather.js';

const D = () => CFG.defense;
const base = import.meta.env.BASE_URL;
let theme = null;
let pick = [];
let game = null;
let ui = null;

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
  const s = app.state;
  theme ||= rollTheme();
  const mons = s.pokemon.filter((p) => canBattle(p.dex)).sort((a, b) => costOf(a.dex) - costOf(b.dex) || a.dex - b.dex);
  const N = Math.min(D().teamSize, mons.length);
  // Rolle als farbiges Etikett, Kosten als schlichte Zahl in der Ecke (kein Stern – sonst sieht alles nach Sternensammler aus)
  const hint = (p) => [roleTag(roleOf(p.dex)), h('span.d-price', String(costOf(p.dex)))];
  const picker = teamPicker({ mons, N, hint, onFull: (uids) => confirmTeam(uids, () => picker.clear()) });
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: back }, '‹ Zurück'),
    h('div.bs-head', h('h2', '★ PokeDefense'), picker.count),
    h('div.d-theme', h('b', 'Erwartete Gegner: '), h('span.type-chips.inline', theme.map((t) => typeChip(t)))),
    h('p.note', `Tippe ${N} Pokémon an. Die Zahl in der Ecke sind die Sternenkosten. Nur ★ Sammler erzeugen Sterne.`),
    picker.grid));
}

// Bestätigung mit Rollen, Kosten und Fähigkeit – dann geht es aufs Feld
function confirmTeam(uids, reset) {
  pick = uids;
  modal((el, close) => {
    el.append(h('h3', 'Dein PokeDefense-Team'),
      h('div.d-theme', h('b', 'Gegner: '), h('span.type-chips.inline', theme.map((t) => typeChip(t)))),
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
  app.act((s) => { s.defense = { team: [...pick] }; return { ok: true }; });
  game = new Defense({ team: team.map(fromPokemon), theme });
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
  const top = h('div.b-top', starsEl, waveEl, h('span.b-weather.d-weather'), h('button.b-btn', { onclick: giveUp, title: 'Aufgeben' }, '🏳'));
  // Vorbereitung ohne Zeitlimit: erst mit „Los!“ beginnen Sternenregen und Wellen
  const go = h('button.btn.primary.big.d-go', { onclick: () => { go.remove(); game.started = true; message('Los! Sammle Sterne und verteidige deinen Trainer.'); haptic('medium'); } }, 'Los!');
  const root = h('div.battle.defense', top, h('div.b-field', canvas, go), cards, msg);
  document.body.append(root);
  document.body.classList.add('in-battle');
  ui = { root, canvas, ctx: canvas.getContext('2d'), cards, starsEl, waveEl, msg, sel: null, fx: [], texts: [], booms: [], rings: [], slashes: [], shakeAmt: 0, freeze: 0, flash: 0, wx: [], wxKind: null, cardEls: [], last: performance.now(), raf: 0, hover: null };
  for (const c of game.cards) loadSprites(c.dex, c.src.gender);
  const tr = new Image(); tr.src = `${base}art/trainers/${app.state.profile?.sprite || 1}.png`; ui.trainer = tr;
  ui.ro = new ResizeObserver(() => layout()); ui.ro.observe(canvas.parentElement);
  canvas.addEventListener('pointerdown', onField);
  canvas.addEventListener('pointermove', (e) => { ui.hover = ui.sel ? cellAt(e.clientX, e.clientY) : null; });
  buildCards();
  layout();
  renderWeatherChip();
  message('Stell in Ruhe dein erstes Team auf – dann „Los!“');
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
}

function layout() {
  const { canvas } = ui, r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1), G = D().grid;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  const tile = Math.floor(Math.min(r.width / G.cols, r.height / (G.rows + 1.1)));
  Object.assign(ui, { dpr, w: r.width, h: r.height, tile, ox: Math.floor((r.width - tile * G.cols) / 2), oy: Math.max(0, Math.floor((r.height - tile * (G.rows + 1.1)) / 2)) });
}

function frame(dt) {
  if (!ui || !game) return;
  if (ui.freeze > 0) ui.freeze -= dt; // kurzer Trefferstopp bei Volltreffern/Explosionen
  else game.update(dt);
  handleEvents();
  draw(dt);
  renderTop();
  updateCards();
  if (game.over && !ui.ended) end();
}

const cellAt = (cx, cy) => {
  const r = ui.canvas.getBoundingClientRect(), G = D().grid;
  const col = Math.floor((cx - r.left - ui.ox) / ui.tile), row = Math.floor((cy - r.top - ui.oy) / ui.tile);
  return col >= 0 && col < G.cols && row >= 0 && row < G.rows ? [col, row] : null;
};
const toGrid = (cx, cy) => { const r = ui.canvas.getBoundingClientRect(); return { x: (cx - r.left - ui.ox) / ui.tile, y: (cy - r.top - ui.oy) / ui.tile }; };
const toScreen = (x, y) => { const r = ui.canvas.getBoundingClientRect(); return { x: r.left + ui.ox + x * ui.tile, y: r.top + ui.oy + y * ui.tile }; };
const dropPos = (d) => { const k = Math.min(1, (game.t - d.born) / 1.2); return { x: d.x + Math.sin((game.t - d.born) * 3) * 0.08 * (1 - k), y: d.fromY + (d.y - d.fromY) * (1 - Math.pow(1 - k, 2)) }; };

function onField(e) {
  if (!game || game.over) return;
  // Sterne haben Vorrang
  const g = toGrid(e.clientX, e.clientY);
  const d = game.drops.find((x) => { const p = dropPos(x); return Math.hypot(p.x - g.x, p.y - g.y) < 0.65; });
  if (d) { const p = dropPos(d); game.collect(d); flyStar(toScreen(p.x, p.y)); haptic('tick'); handleEvents(); return; }
  if (!ui.sel) return;
  const c = cellAt(e.clientX, e.clientY);
  if (!c) return;
  if (!game.canPlace(c[0], c[1])) { toast('Hier kannst du nichts hinsetzen.'); return; }
  if (game.place(ui.sel, c[0], c[1])) { haptic('medium'); shake(ui.tile * 0.04); ui.sel = null; handleEvents(); }
}

function flyStar(from) {
  const to = ui.starsEl.getBoundingClientRect();
  const el = h('img.flyer', { src: starCanvas().toDataURL(), alt: '' });
  document.body.append(el);
  el.animate([{ transform: `translate(${from.x - 14}px, ${from.y - 14}px) scale(1.4)` }, { transform: `translate(${to.left}px, ${to.top}px) scale(.8)` }], { duration: 450, easing: 'ease-in' }).onfinish = () => el.remove();
}

// ---------- Karten ----------
function buildCards() {
  ui.cards.replaceChildren(...game.cards.map((c) => {
    const el = h('button.d-card.r-' + c.role, { style: { '--tc': typeColor(species(c.dex).types[0]) } },
      h('img', { src: portraitUrl(c.dex), alt: '', draggable: false }),
      h('span.d-card-cost', String(c.cost)),
      h('span.d-card-role.r-' + c.role, D().roles[c.role].icon),
      h('i.d-card-cool'));
    el.addEventListener('click', () => {
      if (game.over) return;
      if (game.t < c.readyAt) { toast(`Lädt noch ${Math.ceil(c.readyAt - game.t)} s.`); return; }
      if (game.stars < c.cost) { toast(`Zu wenig Sterne (${c.cost} nötig).`); return; }
      ui.sel = ui.sel === c ? null : c; haptic('tick');
    });
    ui.cardEls.push({ c, el });
    return el;
  }));
}
function updateCards() {
  for (const { c, el } of ui.cardEls) {
    const left = Math.max(0, c.readyAt - game.t);
    el.classList.toggle('sel', ui.sel === c);
    el.classList.toggle('poor', game.stars < c.cost);
    el.lastChild.style.height = (left > 0 ? (left / c.recharge) * 100 : 0) + '%';
  }
}
function renderTop() {
  const k = `${game.stars}|${game.wave}`;
  if (ui.topKey === k) return;
  ui.topKey = k;
  ui.starsEl.replaceChildren(starImg(), String(game.stars));
  const w = game.waveProgress();
  ui.waveEl.firstChild.textContent = w.wave ? `Welle ${w.wave}/${w.total}` : 'Vorbereitung';
  ui.waveEl.lastChild.firstChild.style.width = (w.wave / w.total) * 100 + '%';
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
  // Rasen in Streifen (wie PvZ), Gegner-Bereich oben etwas dunkler
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const own = r >= G.placeRows[0];
    x.fillStyle = (r + c) % 2 ? (own ? '#8fcd68' : '#7ab65a') : (own ? '#99d571' : '#84bf62');
    x.fillRect(U.ox + c * T, U.oy + r * T, T, T);
  }
  // noch gesperrte Reihen des eigenen Bereichs
  const minRow = game.minRow();
  if (minRow > G.placeRows[0]) {
    x.fillStyle = 'rgba(40,30,25,.22)';
    x.fillRect(U.ox, U.oy + G.placeRows[0] * T, G.cols * T, (minRow - G.placeRows[0]) * T);
    x.font = `600 ${Math.round(T * 0.26)}px 'Ziffern', 'Pixelify Sans', sans-serif`; x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,.75)';
    x.fillText('🔒 wird mit den Wellen frei', U.ox + (G.cols * T) / 2, U.oy + (minRow - 0.45) * T);
  }
  x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(U.ox, U.oy + minRow * T - 1, G.cols * T, 2);
  // Grenze zum eigenen Bereich + Ziellinie
  x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(U.ox, U.oy + G.placeRows[0] * T - 1, G.cols * T, 2);
  const goalY = U.oy + G.rows * T;
  x.fillStyle = '#d9c08a'; x.fillRect(U.ox, goalY, G.cols * T, T * 1.1);
  x.fillStyle = '#e0606a';
  for (let i = 0; i < G.cols * 4; i++) if (i % 2 === 0) x.fillRect(U.ox + i * T / 4, goalY, T / 4, Math.max(2, T / 14));
  // Trainer (von hinten, schaut nach oben)
  if (U.trainer.complete && U.trainer.naturalWidth) {
    const fr = Math.floor(now / 400) % 2 === 0 ? 0 : 1;
    const sz = T * 1.1;
    x.drawImage(U.trainer, fr * 64, 3 * 64, 64, 64, U.ox + (G.cols * T) / 2 - sz / 2, goalY + T * 0.02, sz, sz);
  }
  // Platzierungshilfe
  if (U.sel) {
    x.fillStyle = 'rgba(255,255,255,.18)';
    for (let r = G.placeRows[0]; r <= G.placeRows[1]; r++) for (let c = 0; c < G.cols; c++) if (game.canPlace(c, r)) x.fillRect(U.ox + c * T + 2, U.oy + r * T + 2, T - 4, T - 4);
    if (U.hover) { x.strokeStyle = game.canPlace(...U.hover) ? '#fff' : 'rgba(255,90,90,.9)'; x.lineWidth = 2; x.strokeRect(U.ox + U.hover[0] * T + 1, U.oy + U.hover[1] * T + 1, T - 2, T - 2); }
  }
  const P = (o) => [U.ox + o.x * T, U.oy + o.y * T];
  // eigene Pokémon und Gegner (nach Tiefe)
  const all = [...game.units.map((u) => ({ o: u, mine: true })), ...game.enemies.map((e) => ({ o: e, mine: false }))].sort((a, b) => a.o.y - b.o.y);
  for (const { o, mine } of all) drawMon(x, o, mine, P(o), T, now);
  // Geschosse: leuchtender Kern mit Schweif in Typfarbe
  for (const p of game.projectiles) {
    const [X, Y] = P(p), col = typeColor(p.type), s = Math.max(4, Math.round(T / 6.5));
    (p.trail ||= []).push([X, Y]); if (p.trail.length > 7) p.trail.shift();
    p.trail.forEach(([tx, ty], i) => { const k = (i + 1) / p.trail.length; x.globalAlpha = k * 0.5; x.fillStyle = col; const q = s * (0.4 + k * 0.6); x.fillRect(tx - q / 2, ty - q / 2, q, q); });
    x.globalAlpha = 0.35; x.fillStyle = col; x.beginPath(); x.arc(X, Y, s * 1.3, 0, 7); x.fill();
    x.globalAlpha = 1; x.fillStyle = '#fff'; x.fillRect(X - s / 2 - 1, Y - s / 2 - 1, s + 2, s + 2);
    x.fillStyle = col; x.fillRect(X - s / 2, Y - s / 2, s, s);
    x.fillStyle = '#fff'; x.fillRect(X - s / 4, Y - s / 4, s / 3, s / 3);
  }
  // Explosionen: Feuerball + Schockwelle
  U.booms = U.booms.filter((b) => {
    b.t += dt; if (b.t > 0.7) return false;
    const [X, Y] = P(b.u), k = b.t / 0.7, R = (b.r + 0.4) * T;
    x.globalAlpha = 1 - k;
    x.fillStyle = '#fff6c0'; x.beginPath(); x.arc(X, Y, R * (0.3 + k * 0.9), 0, 7); x.fill();
    x.fillStyle = '#ffb84a'; x.beginPath(); x.arc(X, Y, R * (0.25 + k * 0.6), 0, 7); x.fill();
    x.fillStyle = '#ff6a3a'; x.beginPath(); x.arc(X, Y, R * (0.15 + k * 0.35), 0, 7); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = Math.max(2, T / 10) * (1 - k); x.beginPath(); x.arc(X, Y, R * (0.5 + k * 1.3), 0, 7); x.stroke();
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
    if (f.shape === 'spark') { x.strokeStyle = f.color; x.lineWidth = Math.max(1.5, s / 2); x.beginPath(); x.moveTo(X, Y); x.lineTo(X - f.vx * T * 0.05, Y - f.vy * T * 0.05); x.stroke(); }
    else if (f.shape === 'ring') { x.strokeStyle = f.color; x.lineWidth = 1.5; x.beginPath(); x.arc(X, Y, s, 0, 7); x.stroke(); }
    else x.fillRect(X - s / 2, Y - s / 2, s, f.shape === 'leaf' ? s / 2 : s);
    return true;
  });
  x.globalAlpha = 1;
  // Sterne (fallen herab, pulsieren, blinken kurz vor dem Verschwinden)
  const star = starCanvas(), ss = T * 0.62;
  for (const d of game.drops) {
    const p = dropPos(d), age = game.t - d.born, life = D().stars.lifetime;
    if (age > life - 2.5 && Math.floor(age * 6) % 2) continue;
    const pulse = 1 + Math.sin(now / 200 + d.id) * 0.08;
    x.fillStyle = 'rgba(255,230,120,.35)'; x.beginPath(); x.arc(U.ox + p.x * T, U.oy + p.y * T, ss * 0.75 * pulse, 0, 7); x.fill();
    x.drawImage(star, U.ox + p.x * T - (ss * pulse) / 2, U.oy + p.y * T - (ss * pulse) / 2, ss * pulse, ss * pulse);
  }
  drawWeather(x, U, game.weather, U.w, U.h, T, dt, now);
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
  let name = mine ? 'Idle' : (o.eating ? 'Idle' : 'Walk'), ms = now, once = false;
  if (o.anim && (game.t - o.anim.t0) * 1000 < (e.anims[o.anim.name]?.total || 0) * (1000 / 60)) { name = o.anim.name; ms = (game.t - o.anim.t0) * 1000; once = true; }
  else if (o.hurtT != null && game.t - o.hurtT < 0.2) { name = 'Hurt'; ms = (game.t - o.hurtT) * 1000; once = true; }
  const f = frameOf(e, name, mine ? 4 : 0, ms, once);
  let s = T / 28;
  if (e.anims.Idle.fh * s > T * 1.6) s = (T * 1.6) / e.anims.Idle.fh;
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
  if (o.role === 'explosiv' && game.t < o.armAt) { x.fillStyle = 'rgba(40,30,25,.6)'; x.fillRect(X - T * 0.3, Y + T * 0.3, T * 0.6 * (1 - (o.armAt - game.t) / (CFG.defense.roles.explosiv.armSeconds || 1)), 3); }
  if (o.hp < o.maxHp) {
    const bw = T * 0.7, bh = Math.max(3, T / 14), bx = X - bw / 2, by = Y - T * 0.55;
    x.fillStyle = '#2f2622'; x.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    x.fillStyle = mine ? '#4f9ff0' : '#ef5d5d'; x.fillRect(bx, by, bw * o.hp / o.maxHp, bh);
  }
}

// ---------- Effekte ----------
const FX = {
  Feuer: { c: ['#ffe066', '#ffb84a', '#ff6a3a'], g: -2.5, shape: 'sq' }, Wasser: { c: ['#bfe3ff', '#6fb7ff', '#3d7be0'], g: 6, shape: 'sq' },
  Elektro: { c: ['#ffffff', '#ffe066', '#f7d02c'], g: 0, shape: 'spark' }, Pflanze: { c: ['#bde58f', '#7ac74c', '#4f8f30'], g: 1.2, shape: 'leaf' },
  Eis: { c: ['#ffffff', '#bff4ff', '#96d9d6'], g: 3, shape: 'spark' }, Gestein: { c: ['#c9b07a', '#a08050', '#6d5a3a'], g: 9, shape: 'sq' },
  Boden: { c: ['#e2bf65', '#a08050'], g: 8, shape: 'sq' }, Geist: { c: ['#b89ae0', '#735797'], g: -1.5, shape: 'ring' },
  Psycho: { c: ['#ffb3d0', '#f95587'], g: -1, shape: 'ring' }, Gift: { c: ['#d79ae0', '#a33ea1'], g: -1.8, shape: 'ring' },
  Unlicht: { c: ['#8a7464', '#3b2f28'], g: 2, shape: 'sq' }, Fee: { c: ['#ffd6ec', '#d685ad', '#ffffff'], g: -1, shape: 'spark' },
};
function burst(o, type, n, power = 1, size = 1) {
  const st = FX[type] || { c: [typeColor(type), '#ffffff'], g: 4, shape: 'sq' };
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (1 + Math.random() * 2.2) * power;
    ui.fx.push({ x: o.x, y: o.y - 0.15, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.8 * power, g: st.g, drag: 2, color: st.c[Math.floor(Math.random() * st.c.length)], shape: st.shape, size: (0.6 + Math.random() * 0.8) * size, life: 0.35 + Math.random() * 0.35 });
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
    if (ev.type === 'shoot') { if (!ev.melee) sfx.attack(ev.moveType); continue; }
    if (ev.type === 'level') { say(ev.u, `Lv ${ev.level}!`, '#ffd23f', 0.3, 1, -0.75); ring(ev.u, '#ffd23f', 0.2, 0.6, 0.4); sfx.levelUp(); continue; }
    if (ev.type === 'evolve') { evolveFx(ev); continue; }
    if (ev.type === 'hit') {
      const o = ev.target, type = ev.move?.type || 'Normal';
      if (!ev.mine && ev.melee) sfx.attack(type);
      if (ev.crit && !ev.mine) sfx.crit();
      if (ev.mine) { burst(o, 'Unlicht', 4, 0.7, 0.8); continue; } // eigenes Pokémon wird gebissen
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
      ui.booms.push({ u: ev.u, r: ev.radius, t: 0 });
      burst(ev.u, 'Feuer', 34, 2.6, 1.5); burst(ev.u, 'Gestein', 16, 2.2, 1.2);
      shake(T() * 0.3); ui.flash = 0.3; ui.freeze = 0.1; haptic('strong');
    } else if (ev.type === 'wave') {
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
  ui.root.append(h('div.b-result' + (won ? '.won' : ''),
    h('h2', won ? 'Geschafft!' : 'Niederlage'),
    h('p', won ? `Du hast alle ${D().waves.length} Wellen abgewehrt.` : game.over.gaveUp ? 'Du hast aufgegeben.' : `Ein Gegner hat deinen Trainer erreicht (Welle ${game.wave + 1}).`),
    h('button.btn.primary.big', { onclick: () => { closeField(); game = null; theme = null; pick = []; app.refresh(); document.dispatchEvent(new Event('defense-closed')); } }, 'Weiter')));
}
