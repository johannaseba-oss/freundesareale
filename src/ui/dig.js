// Ausgrabung im Vollbild: oben die Wand mit dem wachsenden Riss, darunter das Feld, unten Hacke und Hammer.
import { CFG } from '../config.js';
import { app } from '../app.js';
import * as DG from '../game/dig.js';
import { now } from '../time.js';
import { h } from './dom.js';
import { setMusic, playFile } from '../audio.js';
import { haptic } from '../haptics.js';

const D = () => CFG.dig;
const ART = `${import.meta.env.BASE_URL}art/dig/`, CELL = 32, WALL = 72, SAND = 6, IRON = 7;
const pic = (f) => { const i = new Image(); i.src = ART + f; return i; };
const sound = (k) => { const s = D().sounds[k]; playFile(s.file, s.vol); };

export function startDig(onClose) {
  const tiles = pic('tiles.png'), sheet = pic('items.png'), site = DG.newSite(), { cols, rows } = D();
  const W = cols * CELL, H = rows * CELL + WALL;
  const canvas = h('canvas.dig-cv', { width: W, height: H }), ctx = canvas.getContext('2d');
  let tool = 'hacke', raf = 0, shake = 0, ended = false, fall = -1;
  const fx = [], marks = [];
  const btnImg = { hacke: h('img', { alt: 'Hacke' }), hammer: h('img', { alt: 'Hammer' }) };
  const setTool = (id) => {
    tool = id;
    btnImg.hacke.src = ART + (id === 'hacke' ? 'hacke_an.png' : 'hacke_aus.png');
    btnImg.hammer.src = ART + (id === 'hammer' ? 'hammer_an.png' : 'hammer_aus.png');
    updateInfo();
  };
  const info = h('div.dig-info');
  const updateInfo = () => {
    const got = site.items.filter((e) => e.got).length, T = D().tools[tool];
    info.textContent = `${got}/${site.items.length} gefunden · ${T.name}: ${T.damage === 1 ? 'genau, schont die Stelle' : 'breit, schwächt die Stelle stärker'}`;
  };
  const root = h('div.dig',
    h('button.fp-close', { onclick: () => finish(), title: 'Beenden' }, '✕'),
    h('div.dig-board', canvas), info,
    h('div.dig-tools', ['hacke', 'hammer'].map((id) => h('button.dig-tool', { onclick: () => { if (tool !== id) { sound('tool'); haptic('tick'); setTool(id); } } }, btnImg[id]))));
  document.body.append(root); document.body.classList.add('in-battle'); setMusic('menu');
  setTool('hacke');

  canvas.addEventListener('pointerdown', (e) => {
    if (ended || site.over) return;
    const r = canvas.getBoundingClientRect(), k = W / r.width;
    const x = Math.floor(((e.clientX - r.left) * k) / CELL), y = Math.floor((((e.clientY - r.top) * k) - WALL) / CELL);
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const res = DG.strike(site, x, y, tool);
    if (res.noop) return;
    marks.push({ x, y, t: performance.now(), tool });
    shake = tool === 'hammer' ? 5 : 2.5;
    for (let i = 0; i < (tool === 'hammer' ? 14 : 7); i++) fx.push({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL + WALL, vx: (Math.random() - 0.5) * 170, vy: -40 - Math.random() * 130, life: 0.5 });
    sound(res.iron ? 'iron' : 'hit'); haptic(tool === 'hammer' ? 'medium' : 'tick');
    if (res.found.length) { sound('found'); haptic('strong'); }
    updateInfo();
    if (res.done) { sound('win'); setTimeout(() => finish(), 1100); }
    if (res.collapsed) { sound('collapse'); fall = 0; shake = 12; haptic('strong'); setTimeout(() => finish(), 1300); }
  });

  // Riss in der Wand: läuft von rechts nach links und wird breiter, je schwächer die Stelle ist
  const crackY = Array.from({ length: Math.ceil(W / 14) + 2 }, (_, i) => (i % 2 ? -9 : 9) + (Math.random() - 0.5) * 8);
  function drawWall() {
    ctx.fillStyle = '#b89f6e'; ctx.fillRect(0, 0, W, WALL);
    ctx.fillStyle = '#a58c5e'; for (let x = 6; x < W; x += 34) ctx.fillRect(x, 8 + (x % 3) * 12, 10, 3);
    ctx.fillStyle = '#6e5a43'; ctx.fillRect(0, WALL - 6, W, 6);
    const share = 1 - site.health / D().health;
    if (share <= 0) return;
    const reach = W * share;
    ctx.strokeStyle = '#3a2a1e'; ctx.lineJoin = 'miter'; ctx.lineWidth = 3 + share * 14;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i * 14 <= reach + 14; i++) { const x = W - i * 14, y = WALL / 2 + crackY[i]; if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y); first = false; }
    ctx.stroke();
  }
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
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const d = site.cell[y][x]; if (d > 0) tile(d - 1, x, y); }
      // Funde leuchten kurz auf, bleiben aber sichtbar
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
    // Einsturz: Erde fällt von oben über das Feld
    if (fall >= 0) { fall = Math.min(1, fall + dt * 1.1); ctx.fillStyle = '#3a2a1e'; ctx.fillRect(0, 0, W, H * fall); }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  function finish() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    const res = app.act((s) => DG.claim(s, site, now()), true), rewards = res.rewards || [];
    const done = site.items.every((e) => e.got), collapsed = site.health <= 0 && !done;
    const row = (r) => {
      const c = h('canvas.dig-item', { width: r.it.w * CELL, height: r.it.h * CELL });
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(sheet, r.it.x, r.it.y, r.it.w * CELL, r.it.h * CELL, 0, 0, r.it.w * CELL, r.it.h * CELL);
      return h('div.dig-row', c, h('b', r.it.name), h('small', r.stone ? 'im Beutel' : r.coins ? `+${r.coins} Münzen` : 'Tagesgrenze erreicht'));
    };
    const close = () => { root.remove(); document.body.classList.remove('in-battle'); onClose(); };
    root.replaceChildren(h('div.fp-end',
      h('h2', collapsed ? '💥 Die Stelle ist eingestürzt!' : done ? '✨ Alles ausgegraben!' : 'Ausgrabung beendet'),
      rewards.length ? h('div.dig-list', rewards.map(row)) : h('p', 'Diesmal hast du nichts mitgenommen.'),
      h('div.row', h('button.btn.primary', { onclick: () => { root.remove(); document.body.classList.remove('in-battle'); startDig(onClose); } }, 'Nochmal'), h('button.btn', { onclick: close }, 'Fertig'))));
  }
  if (import.meta.env.DEV) app.dig = { site, finish, DG, canvas, get tool() { return tool; }, setTool };
}
