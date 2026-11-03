// Ausgrabung: Auswahl mit Inventar, Radarschätzung und das Spiel im Hochformat – oben der Riss in der Wand, darunter das Feld, unten die Werkzeuge.
import { CFG } from '../config.js';
import { app } from '../app.js';
import * as DG from '../game/dig.js';
import { species } from '../config.js';
import { now } from '../time.js';
import { portraitUrl } from '../gfx/sprites.js';
import { h, confirmDialog, modal } from './dom.js';
import { setMusic, playFile } from '../audio.js';
import { haptic } from '../haptics.js';
import { startRevive } from './revive.js';

const D = () => CFG.dig;
const ART = `${import.meta.env.BASE_URL}art/dig/`, CELL = 32, WALL = 56, SAND = 6, IRON = 7, HARD = 8;
const pic = (f) => { const i = new Image(); i.src = ART + f; return i; };
const sound = (k) => { const s = D().sounds[k]; playFile(s.file, s.vol); };
const sheet = pic('items.png');
// Bild eines Fundstücks als kleine Leinwand
function itemPic(it) {
  const c = h('canvas.dig-item', { width: it.w * CELL, height: it.h * CELL }), draw = () => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(sheet, it.x, it.y, it.w * CELL, it.h * CELL, 0, 0, it.w * CELL, it.h * CELL); };
  if (sheet.complete) draw(); else sheet.addEventListener('load', draw, { once: true });
  return c;
}

export function renderDigSetup(el, back) {
  const inv = DG.inventory(app.state), again = () => renderDigSetup(el, back), left = DG.digsLeft(app.state, now()), max = DG.digsMax(app.state), P = D().perDay;
  const revive = (name, it) => startRevive([itemPic(it)], (s, t) => DG.revive(s, t, name), again);
  const combine = (name) => {
    const I = app.state.dig?.inventory || {}, pic = (n) => itemPic(D().items.find((i) => i.name === n));
    modal((m, close) => m.append(h('h3', `${name} zusammensetzen`), h('div.dig-combos', DG.combosOf(name).map((c) => {
      const other = c.a === name ? c.b : c.a;
      return h('button.btn', { disabled: !(I[other] > 0), onclick: () => { close(); startRevive([pic(c.a), pic(c.b)], (s, t) => DG.combine(s, t, c), again); } }, h('img', { src: portraitUrl(c.dex), alt: '' }), h('span', `+ ${other} = ${species(c.dex).name}`));
    })), h('button.btn', { onclick: close }, 'Schließen')));
  };
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: back }, '‹ Zurück'),
    h('div.bs-head', h('h2', '⛏ Ausgrabung')),
    h('button.btn.primary.big.dig-setup-go', { disabled: left <= 0, onclick: () => startDig(again) }, 'Ausgraben'),
    h('p.note', `Heute noch ${left} von ${max} – jedes Boden- oder Gesteins-Pokémon mit mindestens ${P.minSatisfaction} % Zufriedenheit gräbt einmal am Tag.`),
    h('h3', `🎒 Inventar (${inv.reduce((n, e) => n + e.count, 0)})`),
    inv.length ? h('div.dig-inv', inv.map((e) => h('div.dig-slot', h('span.n', `×${e.count}`), itemPic(e.it), h('span', e.it.name), DG.fossilOf(e.it.name) ? h('button.btn.small.gold', { onclick: () => revive(e.it.name, e.it) }, 'Wiederbeleben') : DG.combosOf(e.it.name).length ? h('button.btn.small.gold', { onclick: () => combine(e.it.name) }, 'Zusammensetzen') : '')))  : h('p.note', 'Noch leer – alles, was du ausgräbst, landet hier.')));
}

export function startDig(onClose) {
  const tiles = pic('tiles.png'), site = DG.newSite(), { cols, rows } = D();
  const W = cols * CELL, H = rows * CELL + WALL;
  const canvas = h('canvas.dig-cv', { width: W, height: H }), ctx = canvas.getContext('2d');
  let tool = 'hacke', raf = 0, shake = 0, ended = false, fall = -1;
  const fx = [], marks = [];
  const btnImg = { hacke: h('img', { alt: 'Hacke' }), hammer: h('img', { alt: 'Hammer' }) };
  const info = h('div.dig-info');
  const updateInfo = () => { info.textContent = `${site.items.filter((e) => e.got).length}/${site.items.length} gefunden`; };
  const setTool = (id) => {
    tool = id;
    // _aus = gedrückte Variante: zeigt das aktive Werkzeug
    btnImg.hacke.src = ART + (id === 'hacke' ? 'hacke_aus.png' : 'hacke_an.png');
    btnImg.hammer.src = ART + (id === 'hammer' ? 'hammer_aus.png' : 'hammer_an.png');
  };
  const wall = pic(D().walls[Math.floor(Math.random() * D().walls.length)]);
  const root = h('div.dig', { style: { backgroundImage: `url(${wall.src})` } });
  document.body.append(root); document.body.classList.add('in-battle'); setMusic('track:' + D().music.track, D().music.volume);
  setTool('hacke');

  // Radar zuerst: Anzahl der Fundstücke
  root.replaceChildren(h('div.fp-end',
    h('div.dig-radar'),
    h('h2', 'Radar'),
    h('p.dig-num', `${site.items.length} ${site.items.length === 1 ? 'Fundstück' : 'Fundstücke'}`),
    h('div.dig-start', h('button.btn.primary', { onclick: () => { if (app.act((s) => DG.useDig(s, now()), true)?.ok === false) return; sound('tool'); play(); } }, 'Graben'), h('button.btn', { onclick: leave }, 'Zurück'))));

  function leave() { cancelAnimationFrame(raf); root.remove(); document.body.classList.remove('in-battle'); setMusic('menu'); onClose(); }

  function play() {
    const board = h('div.dig-board', canvas);
    // Feld so groß wie möglich: füllt die Breite des Handys, solange die Höhe reicht
    new ResizeObserver(() => {
      const k = Math.min(board.clientWidth / W, board.clientHeight / H);
      canvas.style.width = W * k + 'px'; canvas.style.height = H * k + 'px';
    }).observe(board);
    root.replaceChildren(
      board,
      h('div.dig-foot', h('div.dig-left', info, h('button.btn.small', { onclick: async () => {
        const n = site.items.filter((e) => e.got).length;
        if (await confirmDialog(n ? `Ausgrabung beenden und ${n === 1 ? 'das freigelegte Fundstück' : `die ${n} freigelegten Fundstücke`} einsammeln?` : 'Ausgrabung beenden? Du hast noch nichts freigelegt.', 'Beenden')) finish();
      } }, 'Beenden & einsammeln')),
      h('div.dig-tools', ['hacke', 'hammer'].map((id) => h('button.dig-tool', { onclick: () => { if (tool !== id) { sound('tool'); haptic('tick'); setTool(id); } } }, btnImg[id])))));
    updateInfo();
    raf = requestAnimationFrame(loop);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (ended || site.over) return;
    const r = canvas.getBoundingClientRect(), k = W / r.width;
    const x = Math.floor(((e.clientX - r.left) * k) / CELL), y = Math.floor((((e.clientY - r.top) * k) - WALL) / CELL);
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const res = DG.strike(site, x, y, tool);
    if (res.noop) return;
    marks.push({ x, y, t: performance.now(), tool });
    shake = tool === 'hammer' ? 7 : 2.5;
    for (let i = 0; i < (tool === 'hammer' ? 18 : 7); i++) fx.push({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL + WALL, vx: (Math.random() - 0.5) * 170, vy: -40 - Math.random() * 130, life: 0.5 });
    sound(res.iron ? 'iron' : 'hit'); haptic(tool === 'hammer' ? 'medium' : 'tick');
    if (res.found.length) { sound('found'); haptic('strong'); }
    updateInfo();
    if (res.done) { sound('win'); setTimeout(finish, 1100); }
    if (res.collapsed) { sound('collapse'); fall = 0; shake = 12; haptic('strong'); root.classList.add('quake'); setTimeout(() => haptic('strong'), 500); setTimeout(() => { root.classList.remove('quake'); finish(); }, 1500); }
  });

  // Riss in der Wand: läuft von rechts nach links und wird breiter, je schwächer die Stelle ist
  const crackY = Array.from({ length: Math.ceil(W / 14) + 2 }, (_, i) => (i % 2 ? -8 : 8) + (Math.random() - 0.5) * 7);
  function drawWall() {
    if (wall.complete) for (let y = 0; y < WALL; y += 48) for (let x = 0; x < W; x += 48) ctx.drawImage(wall, x, y, 48, 48);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, WALL - 5, W, 5);
    const share = 1 - site.health / D().health;
    if (share <= 0) return;
    const reach = W * share;
    ctx.strokeStyle = '#120b08'; ctx.lineJoin = 'miter'; ctx.lineWidth = 3 + share * 12;
    ctx.beginPath();
    for (let i = 0; i * 14 <= reach + 14; i++) { const x = W - i * 14, y = (WALL - 5) / 2 + crackY[i]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  }
  // Zacken der einstürzenden Wand; sie wird beim Fallen immer schneller
  const jag = Array.from({ length: Math.ceil(W / 24) }, () => 8 + Math.floor(Math.random() * 4) * 8);
  const fall_speed = (f) => 0.45 + f * 1.5;
  const tile = (i, x, y) => ctx.drawImage(tiles, i * CELL, 0, CELL, CELL, x * CELL, y * CELL + WALL, CELL, CELL);
  let last = performance.now();
  const loop = (ms) => {
    if (ended) return;
    const dt = Math.min(0.05, (ms - last) / 1000); last = ms;
    shake = Math.max(0, shake - dt * 28);
    ctx.setTransform(1, 0, 0, 1, shake ? (Math.random() - 0.5) * shake : 0, shake ? (Math.random() - 0.5) * shake : 0);
    ctx.imageSmoothingEnabled = false;
    drawWall();
    if (tiles.complete && sheet.complete) {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) tile(DG.isIron(site, x, y) ? IRON : SAND, x, y);
      for (const e of site.items) ctx.drawImage(sheet, e.it.x, e.it.y, e.it.w * CELL, e.it.h * CELL, e.x * CELL, e.y * CELL + WALL, e.it.w * CELL, e.it.h * CELL);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const d = site.cell[y][x]; if (d > 0) tile(d >= 7 ? HARD : d - 1, x, y); }
      // Funde leuchten kurz auf
      for (const e of site.items) {
        const age = e.got ? (ms - e.gotAt) / 900 : 2;
        if (age >= 0 && age < 1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(age * Math.PI); ctx.drawImage(sheet, e.it.x, e.it.y, e.it.w * CELL, e.it.h * CELL, e.x * CELL, e.y * CELL + WALL, e.it.w * CELL, e.it.h * CELL); ctx.restore(); }
      }
    }
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i], a = (ms - m.t) / 160;
      if (a >= 1) { marks.splice(i, 1); continue; }
      const r = m.tool === 'hammer' ? 1 : 0;
      ctx.strokeStyle = m.tool === 'hammer' ? '#ff5a4a' : '#4a7dff'; ctx.lineWidth = 4; ctx.globalAlpha = 1 - a;
      ctx.strokeRect((m.x - r) * CELL + 2, (m.y - r) * CELL + WALL + 2, (2 * r + 1) * CELL - 4, (2 * r + 1) * CELL - 4);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#8a7558';
    for (let i = fx.length - 1; i >= 0; i--) { const p = fx[i]; p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.life <= 0) fx.splice(i, 1); else ctx.fillRect(Math.round(p.x), Math.round(p.y), 4, 4); }
    // Einsturz: die Felswand rutscht von oben über das Feld, die Unterkante ist zerklüftet
    if (fall >= 0) {
      fall = Math.min(1, fall + dt * fall_speed(fall));
      const bottom = (H + 48) * fall;
      for (let y = bottom - 48; y > -48; y -= 48) for (let x = 0; x < W; x += 48) ctx.drawImage(wall, x, y, 48, 48);
      for (let i = 0; i < jag.length; i++) { const x = i * 24, h = jag[i]; ctx.drawImage(wall, 0, 0, 24, h / 2, x, bottom, 24, h); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, bottom + h - 4, 24, 4); }
    }
    raf = requestAnimationFrame(loop);
  };

  function finish() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    const res = app.act((s) => DG.claim(s, site), true), items = res.items || [];
    const done = site.items.every((e) => e.got), collapsed = site.health <= 0 && !done;
    root.replaceChildren(h('div.fp-end',
      h('h2', collapsed ? '💥 Die Stelle ist eingestürzt!' : done ? '✨ Alles ausgegraben!' : 'Ausgrabung beendet'),
      items.length ? [h('p', 'Das kommt ins Inventar:'), h('div.dig-list', items.map((it) => h('div.dig-row', itemPic(it), h('b', it.name))))] : h('p', 'Diesmal hast du nichts mitgenommen.'),
      h('div.row', DG.digsLeft(app.state, now()) > 0 ? h('button.btn.primary', { onclick: () => { root.remove(); startDig(onClose); } }, 'Nochmal') : '', h('button.btn', { onclick: leave }, 'Fertig'))));
  }
  if (import.meta.env.DEV) app.dig = { site, finish, DG, canvas, get tool() { return tool; }, setTool };
}
