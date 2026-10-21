// Sternenverteidigung – Oberfläche: Team (6) mit Blick auf die angekündigten Gegner-Typen wählen (ohne Zeitlimit),
// dann das vertikale Spielfeld: Sterne einsammeln, Karten antippen und Pokémon auf das untere Feld setzen.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { Defense, roleOf, costOf, rechargeOf, abilityText, rollTheme } from '../game/defense.js';
import { fromPokemon, canBattle, moveOf, bdata } from '../game/battle.js';
import { typeColor, typeChip } from '../game/types.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { $, h, toast, confirmDialog } from './dom.js';
import { haptic } from '../haptics.js';

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
const starImg = () => { const i = h('img.star-ico', { src: starCanvas().toDataURL(), alt: '★' }); return i; };

// ================= Vorbereitung =================
export function renderDefenseSetup(el, back) {
  const s = app.state;
  theme ||= rollTheme();
  const mons = s.pokemon.filter((p) => canBattle(p.dex)).sort((a, b) => costOf(a.dex) - costOf(b.dex) || a.dex - b.dex);
  const N = Math.min(D().teamSize, mons.length);
  if (!pick.length && s.defense?.team?.length) pick = s.defense.team.filter((u) => mons.some((p) => p.uid === u)).slice(0, N);
  pick = pick.filter((u) => mons.some((p) => p.uid === u));
  const toggle = (p) => {
    const i = pick.indexOf(p.uid);
    if (i >= 0) pick.splice(i, 1); else if (pick.length < N) pick.push(p.uid); else { toast(`Höchstens ${N} Pokémon.`); return; }
    haptic('tick');
    renderDefenseSetup(el, back);
  };
  el.replaceChildren(h('div.bs',
    h('div.bs-head', h('h2', '★ Sternenverteidigung'), h('span.bs-count' + (pick.length === N ? '.full' : ''), `${pick.length}/${N}`)),
    h('div.d-theme', h('b', 'Erwartete Gegner: '), h('span.type-chips.inline', theme.map((t) => typeChip(t))), h('small', ' – hauptsächlich diese Typen, in 5 Wellen')),
    h('p.note', `Wähle ${N} Pokémon – du hast beliebig Zeit. Sterne fallen vom Himmel, Sternensammler (★) erzeugen weitere. Setze damit deine Pokémon aufs Feld, bevor die Gegner unten beim Trainer ankommen.`),
    h('div.bs-list', mons.map((p) => {
      const role = D().roles[roleOf(p.dex)], mv = moveOf(bdata(p.dex).move);
      return h('button.bs-row' + (pick.includes(p.uid) ? '.on' : ''), { onclick: () => toggle(p) },
        h('img.bs-por', { src: portraitUrl(p.dex), alt: '', loading: 'lazy' }),
        h('div.bs-row-text',
          h('div', h('b', p.nick || species(p.dex).name), ' ', h('span.type-chips.left.inline', species(p.dex).types.map((t) => typeChip(t)))),
          h('small', `${role.icon} ${role.name} · ${abilityText(p.dex)}`),
          h('small', `Attacke-Typ: `, h('span', { style: { color: typeColor(mv.type), fontWeight: 600 } }, mv.type), ` · Aufladen ${rechargeOf(p.dex)} s`)),
        h('span.d-cost', starImg(), String(costOf(p.dex))));
    })),
    h('div.bs-bar',
      h('button.btn', { onclick: back }, 'Zurück'),
      h('button.btn.primary.big', { disabled: !pick.length || pick.length < N, onclick: start }, 'Kampf starten'))));
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
  const top = h('div.b-top', starsEl, waveEl, h('span.type-chips.inline', theme.map((t) => typeChip(t))), h('button.b-btn', { onclick: giveUp, title: 'Aufgeben' }, '🏳'));
  // Vorbereitung ohne Zeitlimit: erst mit „Los!“ beginnen Sternenregen und Wellen
  const go = h('button.btn.primary.big.d-go', { onclick: () => { go.remove(); game.started = true; message('Los! Sammle Sterne und verteidige deinen Trainer.'); haptic('medium'); } }, 'Los!');
  const root = h('div.battle.defense', top, h('div.b-field', canvas, go), cards, msg);
  document.body.append(root);
  document.body.classList.add('in-battle');
  ui = { root, canvas, ctx: canvas.getContext('2d'), cards, starsEl, waveEl, msg, sel: null, fx: [], texts: [], booms: [], cardEls: [], last: performance.now(), raf: 0, hover: null };
  for (const c of game.cards) loadSprites(c.dex, c.src.gender);
  const tr = new Image(); tr.src = `${base}art/trainers/${app.state.profile?.sprite || 1}.png`; ui.trainer = tr;
  ui.ro = new ResizeObserver(() => layout()); ui.ro.observe(canvas.parentElement);
  canvas.addEventListener('pointerdown', onField);
  canvas.addEventListener('pointermove', (e) => { ui.hover = ui.sel ? cellAt(e.clientX, e.clientY) : null; });
  buildCards();
  layout();
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
  game.update(dt);
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
  if (d) { const p = dropPos(d); game.collect(d); flyStar(toScreen(p.x, p.y)); haptic('tick'); return; }
  if (!ui.sel) return;
  const c = cellAt(e.clientX, e.clientY);
  if (!c) return;
  if (!game.canPlace(c[0], c[1])) { toast('Hier kannst du nichts hinsetzen.'); return; }
  if (game.place(ui.sel, c[0], c[1])) { haptic('medium'); ui.sel = null; }
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
    const el = h('button.d-card', { style: { '--tc': typeColor(species(c.dex).types[0]) } },
      h('img', { src: portraitUrl(c.dex), alt: '', draggable: false }),
      h('span.d-card-cost', starImg(), String(c.cost)),
      h('span.d-card-role', D().roles[c.role].icon),
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
  x.setTransform(U.dpr, 0, 0, U.dpr, 0, 0);
  x.imageSmoothingEnabled = false;
  x.fillStyle = '#5e9a46'; x.fillRect(0, 0, U.w, U.h);
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
    x.font = `600 ${Math.round(T * 0.26)}px 'Pixelify Sans', sans-serif`; x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,.75)';
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
  // Geschosse
  for (const p of game.projectiles) {
    const [X, Y] = P(p), s = Math.max(4, Math.round(T / 7)), col = typeColor(p.type);
    x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(X - s / 2, Y - s / 2 + s, s, s * 0.8);
    x.fillStyle = '#fff'; x.fillRect(X - s / 2 - 1, Y - s / 2 - 1, s + 2, s + 2);
    x.fillStyle = col; x.fillRect(X - s / 2, Y - s / 2, s, s);
  }
  // Explosionen
  U.booms = U.booms.filter((b) => {
    b.t += dt; if (b.t > 0.6) return false;
    const [X, Y] = P(b.u), k = b.t / 0.6;
    x.globalAlpha = 1 - k; x.fillStyle = '#ffe066'; x.beginPath(); x.arc(X, Y, (b.r + 0.3) * T * (0.4 + k * 0.8), 0, 7); x.fill();
    x.fillStyle = '#ff7b3a'; x.beginPath(); x.arc(X, Y, (b.r + 0.3) * T * (0.2 + k * 0.5), 0, 7); x.fill(); x.globalAlpha = 1;
    return true;
  });
  // Partikel
  U.fx = U.fx.filter((f) => {
    f.life -= dt; if (f.life <= 0) return false;
    f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 3 * dt;
    x.globalAlpha = Math.min(1, f.life / 0.25); x.fillStyle = f.color;
    const s = Math.max(3, T / 9); x.fillRect(U.ox + f.x * T - s / 2, U.oy + f.y * T - s / 2, s, s);
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
  // schwebende Texte
  U.texts = U.texts.filter((t) => {
    t.t += dt; if (t.t > 0.8) return false;
    x.globalAlpha = Math.min(1, (0.8 - t.t) / 0.3);
    x.font = `600 ${Math.round(T * 0.3)}px 'Pixelify Sans', sans-serif`; x.textAlign = 'center';
    x.lineWidth = 3; x.strokeStyle = 'rgba(40,25,20,.9)';
    const X = U.ox + t.x * T, Y = U.oy + t.y * T - t.t * T * 0.6;
    x.strokeText(t.text, X, Y); x.fillStyle = t.color; x.fillText(t.text, X, Y);
    x.globalAlpha = 1;
    return true;
  });
}

function drawMon(x, o, mine, [X, Y], T, now) {
  const e = loadSprites(o.dex, o.gender);
  const dead = o.hp <= 0;
  x.fillStyle = 'rgba(0,0,0,.2)'; x.beginPath(); x.ellipse(X, Y + T * 0.25, T * 0.3, T * 0.12, 0, 0, 7); x.fill();
  if (e.ready) {
    let name = mine ? 'Idle' : (o.eating ? 'Idle' : 'Walk'), ms = now, once = false;
    if (o.anim && (game.t - o.anim.t0) * 1000 < (e.anims[o.anim.name]?.total || 0) * (1000 / 60)) { name = o.anim.name; ms = (game.t - o.anim.t0) * 1000; once = true; }
    else if (o.hurtT != null && game.t - o.hurtT < 0.2) { name = 'Hurt'; ms = (game.t - o.hurtT) * 1000; once = true; }
    const f = frameOf(e, name, mine ? 4 : 0, ms, once);
    const idle = e.anims.Idle;
    let s = T / 28;
    if (idle.fh * s > T * 1.6) s = (T * 1.6) / idle.fh;
    if (dead) x.globalAlpha = 0.4;
    if (!mine && game.t < o.slowUntil) x.filter = 'hue-rotate(160deg) saturate(1.4)';
    x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(X - (f.fw * s) / 2), Math.round(Y - T * 0.1 - (f.fh * s) / 2), Math.round(f.fw * s), Math.round(f.fh * s));
    x.filter = 'none'; x.globalAlpha = 1;
  }
  if (dead) return;
  if (o.role === 'explosiv' && game.t < o.armAt) { x.fillStyle = 'rgba(40,30,25,.6)'; x.fillRect(X - T * 0.3, Y + T * 0.3, T * 0.6 * (1 - (o.armAt - game.t) / (CFG.defense.roles.explosiv.armSeconds || 1)), 3); }
  if (o.hp < o.maxHp) {
    const bw = T * 0.7, bh = Math.max(3, T / 14), bx = X - bw / 2, by = Y - T * 0.55;
    x.fillStyle = '#2f2622'; x.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    x.fillStyle = mine ? '#4f9ff0' : '#ef5d5d'; x.fillRect(bx, by, bw * o.hp / o.maxHp, bh);
  }
}

function handleEvents() {
  for (const ev of game.events) {
    if (ev.type === 'hit') {
      const o = ev.target;
      for (let i = 0; i < 5; i++) ui.fx.push({ x: o.x, y: o.y - 0.1, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 1.5, color: ev.move ? typeColor(ev.move.type) : '#ffb84a', life: 0.35 });
      if (!ev.mine) ui.texts.push({ x: o.x, y: o.y - 0.4, text: String(ev.dmg), color: ev.eff > 1 ? '#ffe066' : '#fff', t: 0 });
    } else if (ev.type === 'explode') { ui.booms.push({ u: ev.u, r: ev.radius, t: 0 }); haptic('strong'); }
    else if (ev.type === 'wave') { message(ev.final ? '★ Letzte Welle! ★' : `Welle ${ev.wave + 1} kommt!`); if (ev.wave > 0 && ev.minRow >= D().grid.placeRows[0]) message('Eine weitere Reihe ist frei!'); haptic('medium'); }
    else if (ev.type === 'lost') ui.texts.push({ x: ev.u.x, y: ev.u.y - 0.4, text: 'K.O.', color: '#ffb0b0', t: 0 });
    else if (ev.type === 'place') { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ui.fx.push({ x: ev.u.x, y: ev.u.y + 0.2, vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 0.6, color: '#efe3c0', life: 0.35 }); } }
  }
  game.events.length = 0;
}

async function giveUp() {
  if (!game || game.over) return;
  if (await confirmDialog('Runde aufgeben?', 'Aufgeben')) game.over = { won: false, gaveUp: true };
}

function end() {
  ui.ended = true;
  const won = game.over.won;
  haptic(won ? 'medium' : 'strong');
  ui.root.append(h('div.b-result' + (won ? '.won' : ''),
    h('h2', won ? 'Geschafft!' : 'Niederlage'),
    h('p', won ? 'Du hast alle fünf Wellen abgewehrt.' : game.over.gaveUp ? 'Du hast aufgegeben.' : `Ein Gegner hat deinen Trainer erreicht (Welle ${game.wave + 1}).`),
    h('button.btn.primary.big', { onclick: () => { closeField(); game = null; theme = null; app.refresh(); document.dispatchEvent(new Event('defense-closed')); } }, 'Weiter')));
}
