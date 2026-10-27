// Spielautomat-Oberfläche (Vollbild): Einsatz-Bälle antippen, START drücken, Walzen mit Y/B/A stoppen.
// Das Ergebnis steht schon beim Start fest (und ist sofort gutgeschrieben) – die Walzen rutschen beim Stoppen bis zum passenden Symbol.
// Piepi steht vor dem Automaten und fiebert mit; Gewinne werden groß gefeiert (Strahlen, Konfetti, Feuerwerk).
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { SYMBOLS, chances, spin, claim, stoneTargets, useStone } from '../game/slots.js';
import { itemById, itemSprite, giveItem, takeItem } from '../game/items.js';
import { favFirst } from '../game/actions.js';
import { canBattle } from '../game/battle.js';
import { stoneName } from '../game/battle.js';
import { portraitUrl } from '../gfx/sprites.js';
import { $, h, toast, modal, confirmDialog } from './dom.js';
import { iconImg } from '../gfx/icons.js';
import { reveal } from './gacha.js';
import { sfx, setMusic } from '../audio.js';
import { haptic } from '../haptics.js';

const SL = () => CFG.slots;
const base = import.meta.env.BASE_URL;
// Ausschnitte aus public/art/slots/sheet.png (siehe tools/build_slots.mjs)
const RECT = {
  machine: [2, 11, 256, 183],
  seven: [265, 5, 44, 26], g: [268, 36, 38, 28], replay: [266, 69, 42, 26], cherry: [269, 99, 35, 30], pika: [263, 132, 48, 28], gem: [267, 167, 38, 26],
  cloudS: [93, 204, 53, 46], cloudL: [87, 260, 64, 61],
  pippi: [[155, 199, 58, 60], [220, 199, 58, 60], [152, 263, 64, 60], [217, 263, 64, 60], [155, 326, 58, 61], [220, 326, 58, 61], [152, 389, 65, 62], [217, 389, 65, 62], [152, 453, 65, 62], [217, 453, 65, 62]],
  ball: (c, r) => [3 + 17 * c, 196 + 16 * r, 14, 14],
  digit: (d) => [290, 202 + 32 * d, 16, 26],
};
// Szene in Sheet-Koordinaten: Automat x 2–258, y 11–194; darüber das Leuchtschild, darunter Boden mit START und Einsatz
const WIN = [[44, 34], [104, 34], [164, 34]], WIN_W = 52, CELL = 32;
const BTN = [[70, 146], [130, 146], [190, 146]];
const LAMPS = [27, 50, 82, 113, 137];
const SCENE = { x0: -6, x1: 266, y0: -34, y1: 282 }, FLOOR = 262;
const START = [130, 226, 21], BETS = [[106, 262], [130, 262], [154, 262]];
let ui = null, sheet = null, stonesImg = null;
// Reihenfolge in public/art/slots/stones.png (je 52×52)
const STONE_ORDER = ['water-stone', 'dusk-stone', 'fire-stone', 'ice-stone', 'moon-stone', 'leaf-stone', 'shiny-stone', 'sun-stone', 'thunder-stone', 'dawn-stone'];
function loadStones() { if (!stonesImg) { stonesImg = new Image(); stonesImg.src = `${base}art/slots/stones.png`; } return stonesImg; }
export function stoneIcon(key, size = 32) {
  const c = h('canvas.stone-ico', { width: 52, height: 52, style: { width: size + 'px', height: size + 'px' } }), img = loadStones(), i = STONE_ORDER.indexOf(key);
  const draw = () => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; if (i >= 0) x.drawImage(img, i * 52, 0, 52, 52, 0, 0, 52, 52); };
  if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
  return c;
}

// Walzenstreifen: jedes Symbol mind. zweimal, fest gemischt je Walze
function strip(i) {
  const s = [...SYMBOLS, ...SYMBOLS, 'cherry', 'pika', 'replay'];
  let r = 1234 + i * 777;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let k = s.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [s[k], s[j]] = [s[j], s[k]]; }
  return s;
}
const mod = (a, n) => ((a % n) + n) % n;
function spriteCanvas(rect, scale = 2) {
  const c = h('canvas', { width: rect[2] * scale, height: rect[3] * scale });
  const draw = () => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(sheet, rect[0], rect[1], rect[2], rect[3], 0, 0, rect[2] * scale, rect[3] * scale); };
  if (sheet.complete && sheet.naturalWidth) draw(); else sheet.addEventListener('load', draw, { once: true });
  return c;
}

// ================= Öffnen =================
export function openSlots() {
  if (ui) return;
  if (!sheet) { sheet = new Image(); sheet.src = `${base}art/slots/sheet.png`; }
  loadStones();
  const canvas = h('canvas.sl-canvas');
  const btn = (cls, label, title, fn) => h('button.sl-fab' + cls, { onclick: fn, title, 'aria-label': title }, label);
  // große Münzanzeige oben: zählt beim Einsatz sichtbar herunter
  const coinNum = h('b'), coinBox = h('div.sl-coins', iconImg('coin', 3), coinNum);
  const root = h('div.sl-full', canvas, coinBox,
    btn('.left', '?', 'Gewinne', showHelp), btn('.left2', '🎒', 'Beutel', () => openBag()), btn('.right', '✕', 'Schließen', close));
  document.body.append(root);
  document.body.classList.add('in-battle');
  setMusic('arena');
  ui = { root, canvas, ctx: canvas.getContext('2d'), bet: 0, reels: [0, 1, 2].map((i) => ({ strip: strip(i), pos: i * 3, spinning: false })),
    phase: 'idle', t: 0, time: 0, last: performance.now(), raf: 0, flash: 0, puffs: [], sparks: [], pippi: 'idle', pippiT: 0, hop: 0, press: 0, win: null, confetti: [], fireworks: [], shake: 0, msg: '', msgT: 0, coinBox, coinNum, coinShown: app.state.coins, tickAt: 0 };
  ui.ro = new ResizeObserver(layout); ui.ro.observe(root);
  canvas.addEventListener('pointerdown', onTap);
  layout();
  const loop = (t) => { if (!ui) return; const dt = Math.min(0.05, (t - ui.last) / 1000); ui.last = t; frame(dt); ui.raf = requestAnimationFrame(loop); };
  ui.raf = requestAnimationFrame(loop);
  if (import.meta.env.DEV) app.slots = { get ui() { return ui; }, spin: startSpin };
}
function close() {
  if (!ui) return;
  if (ui.phase !== 'idle') { toast('Warte, bis die Walzen stehen.'); return; }
  cancelAnimationFrame(ui.raf); ui.ro.disconnect(); ui.root.remove();
  document.body.classList.remove('in-battle');
  ui = null; setMusic('menu'); app.refresh();
}
function layout() {
  const { canvas, root } = ui, r = root.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  const sw = SCENE.x1 - SCENE.x0, sh = SCENE.y1 - SCENE.y0, top = 52; // oben Platz für die Knöpfe
  const fit = Math.min((r.width - 8) / sw, (r.height - top - 16) / sh);
  let S = Math.max(1, Math.floor(fit * dpr)) / dpr; // ganzzahlige Gerätepixel = scharfe Pixel
  if (S < fit * 0.85) S = fit;
  const snap = (v) => Math.round(v * dpr) / dpr;
  Object.assign(ui, { dpr, w: r.width, h: r.height, S, ox: snap((r.width - sw * S) / 2 - SCENE.x0 * S), oy: snap(top + (r.height - top - sh * S) / 2 - SCENE.y0 * S) });
}
function showHelp() {
  const ch = chances(ui.bet);
  modal((m, close) => {
    m.append(h('h3', '🎰 Gewinne'),
      h('p.note', `Einsatz ${SL().bets[ui.bet]} Münzen (antippen der Bälle unten ändert ihn). Drei gleiche: Pokémon, Steine oder Items. Zwei gleiche: Replay = Gratisspiel, sonst 20 % des Einsatzes zurück. Mehr Einsatz = bessere Chancen auf die Hauptgewinne.`),
      h('div.sl-legend', ch.map(({ o, p }) => h('div.sl-row', h('span.sl-syms', spriteCanvas(RECT[o.symbol], 1), spriteCanvas(RECT[o.symbol], 1), spriteCanvas(RECT[o.symbol], 1)), h('span', o.label), h('small', `${(p * 100).toFixed(p < 0.01 ? 2 : 1)} %`)))),
      h('div.sl-row', h('span.sl-syms', spriteCanvas(RECT.replay, 1), spriteCanvas(RECT.replay, 1)), h('span', 'Zwei Replay: Gratisspiel'), h('small', `${Math.round((SL().pairs?.replayChance || 0) * 100)} %`)),
      h('div.sl-row', h('span.sl-syms', spriteCanvas(RECT.cherry, 1), spriteCanvas(RECT.cherry, 1)), h('span', `Zwei gleiche: ${SL().pairs?.refundPct || 20} % zurück`), h('small', `${Math.round((SL().pairs?.refundChance || 0) * 100)} %`)),
      h('p.note', 'Alles andere: leider nichts.'),
      h('div.row', h('button.btn.primary', { onclick: close }, 'OK')));
  });
}

// ================= Spielen =================
function startSpin() {
  if (!ui || ui.phase !== 'idle') return;
  const free = (app.state.slots?.free || 0) > 0, betIdx = free ? app.state.slots.freeBet ?? ui.bet : ui.bet;
  const r = app.act((s, t) => {
    if (free) s.slots.free--;
    const sp = spin(s, betIdx, free);
    if (!sp.ok) { if (free) s.slots.free++; return sp; }
    return { ...sp, prize: sp.outcome ? claim(s, t, sp.outcome) : null };
  }, true);
  if (r.ok === false) return;
  haptic('medium');
  if (free) { floatText('GRATIS!', '#7dff6a'); sfx.place(); } else { sfx.coin(); payFx(r.bet || SL().bets[betIdx]); }
  ui.result = r; ui.phase = 'spin'; ui.t = 0; ui.pippi = 'spin'; ui.pippiT = 0; ui.msg = ''; ui.press = 0.25;
  // Zielsymbole: Gewinn = dreimal dasselbe, Niete = nie drei gleiche (manchmal zwei gleiche als Spannung)
  // Zielsymbole: Hauptgewinn = dreimal dasselbe; Paar = zwei gleiche + ein anderes; Niete = drei verschiedene
  let targets;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  if (r.outcome) targets = [0, 1, 2].map(() => r.outcome.symbol);
  else if (r.pair) {
    const sym = r.pair === 'replay' ? 'replay' : r.sym, other = shuffle(SYMBOLS.filter((x) => x !== sym))[0];
    const odd = Math.floor(Math.random() * 3); targets = [0, 1, 2].map((i) => (i === odd ? other : sym));
  } else targets = shuffle([...SYMBOLS]).slice(0, 3);
  ui.reels.forEach((rl, i) => Object.assign(rl, { spinning: true, target: targets[i], ease: null, speed: 14 + i * 1.5 }));
}
// Walze i anhalten: rutscht bis zum nächsten Feld, auf dem das Zielsymbol in der Mitte steht
function stopReel(i) {
  const rl = ui.reels[i];
  if (!rl.spinning || rl.ease) return;
  const L = rl.strip.length;
  let n = Math.floor(rl.pos) - 1;
  for (let k = 0; k < L; k++, n--) if (rl.strip[mod(n + 1, L)] === rl.target) break;
  rl.ease = { from: rl.pos, to: n, t: 0, dur: 0.18 + (rl.pos - n) * 0.035 };
  sfx.place(); haptic('tick');
}
function onTap(e) {
  if (!ui) return;
  const r = ui.canvas.getBoundingClientRect(), x = (e.clientX - r.left - ui.ox) / ui.S, y = (e.clientY - r.top - ui.oy) / ui.S;
  if (ui.phase === 'spin') {
    BTN.forEach(([bx, by], i) => { if (Math.hypot(x - bx, y - by) < 14 || (x >= WIN[i][0] && x < WIN[i][0] + WIN_W && y >= WIN[i][1] && y < WIN[i][1] + 96)) stopReel(i); });
    return;
  }
  if (ui.phase !== 'idle') return;
  const bi = BETS.findIndex(([bx, by]) => Math.hypot(x - bx, y - by) < 11);
  if (bi >= 0) { ui.bet = bi; haptic('tick'); sfx.place(); return; }
  if (x >= 2 && x <= 46 && y >= 155 && y <= 192) { ui.bet = (ui.bet + 1) % SL().bets.length; haptic('tick'); return; } // Einsatz-Tafel
  if (Math.hypot(x - START[0], y - START[1]) < START[2] + 6 || (y >= 34 && y < 130 && x >= 44 && x < 216)) startSpin();
}

function frame(dt) {
  if (!ui) return;
  ui.t += dt; ui.time += dt; ui.pippiT += dt;
  // Münzanzeige rollt zum echten Stand (beim Einsatz schnell herunter, mit Klicken)
  const target = app.state.coins;
  if (ui.coinShown !== target) {
    const d = target - ui.coinShown, step = Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * Math.min(1, dt * 3.2)));
    ui.coinShown = Math.abs(step) >= Math.abs(d) ? target : ui.coinShown + step;
    if (ui.time >= ui.tickAt) { ui.tickAt = ui.time + 0.06; sfx.coin(); }
    ui.coinBox.classList.toggle('drop', d < 0); ui.coinBox.classList.toggle('rise', d > 0);
  } else ui.coinBox.classList.remove('drop', 'rise');
  ui.coinNum.textContent = ui.coinShown.toLocaleString('de-DE');
  for (const [i, rl] of ui.reels.entries()) {
    if (!rl.spinning) continue;
    if (rl.ease) {
      rl.ease.t += dt;
      const k = Math.min(1, rl.ease.t / rl.ease.dur), o = 1 - Math.pow(1 - k, 3);
      rl.pos = rl.ease.from + (rl.ease.to - rl.ease.from) * o - Math.sin(k * Math.PI) * 0.08;
      if (k >= 1) { rl.pos = rl.ease.to; rl.spinning = false; rl.ease = null; afterStop(); }
    } else {
      rl.pos -= rl.speed * dt;
      if (ui.t > SL().autoStop + i * 0.5) stopReel(i); // stoppt von selbst
    }
  }
  draw(dt);
}
function afterStop() {
  const stopped = ui.reels.filter((r) => !r.spinning);
  if (stopped.length === 2 && stopped[0].target === stopped[1].target) { ui.pippi = 'reach'; ui.pippiT = 0; } // zwei gleiche: Spannung!
  if (stopped.length < 3) return;
  ui.phase = 'result';
  const r = ui.result;
  if (!r.outcome && r.pair) { // Paar: kleiner Gewinn (Gratisspiel oder 20 % zurück)
    ui.flash = 1.2; ui.pippi = 'win'; ui.pippiT = 0; ui.hop = 0.01; sfx.win(); haptic('medium');
    ui.reels.forEach((rl, i) => { if (rl.target === (r.pair === 'replay' ? 'replay' : r.sym)) setTimeout(() => ui?.puffs.push({ x: WIN[i][0] + WIN_W / 2, y: WIN[i][1] + 48, t: 0 }), i * 120); });
    if (r.pair === 'replay') { ui.msg = 'GRATISSPIEL!'; floatText('GRATISSPIEL!', '#7dff6a'); }
    else { ui.msg = `+${r.back} MÜNZEN`; floatText(`+${r.back}`, '#7dff6a'); }
    ui.msgT = 0; burstConfetti(25);
    setTimeout(() => { if (ui) { ui.phase = 'idle'; ui.pippi = 'idle'; ui.msg = ''; } }, 1500);
    return;
  }
  if (!r.outcome) {
    ui.pippi = 'lose'; ui.pippiT = 0; ui.msg = 'Leider nichts …'; ui.msgT = 0; sfx.bite();
    setTimeout(() => { if (ui) { ui.phase = 'idle'; ui.pippi = 'idle'; ui.msg = ''; } }, 1300);
    return;
  }
  // Gewinn: Lampen blinken, Lichtstrahlen, Konfetti, Feuerwerk, pulsierende Gewinnsymbole, Piepi hüpft vor Freude
  const big = r.outcome.symbol === 'seven' || r.prize.kind === 'pokemon';
  ui.win = { t: 0, big, dur: big ? 3.2 : 2.4 };
  ui.flash = ui.win.dur; ui.pippi = 'win'; ui.pippiT = 0; ui.hop = 0.01; ui.shake = big ? 9 : 5; sfx.win(); haptic('strong');
  burstConfetti(big ? 150 : 80);
  if (big) setTimeout(() => { if (ui) { sfx.win(); burstConfetti(90); haptic('strong'); } }, 900);
  WIN.forEach(([wx, wy], i) => setTimeout(() => ui?.puffs.push({ x: wx + WIN_W / 2, y: wy + 48, t: 0 }), i * 160));
  const p = r.prize;
  if (p.kind === 'held') { ui.itemImg = new Image(); ui.itemImg.src = itemSprite(p.item); }
  ui.msg = p.kind === 'stone' || p.kind === 'held' ? `${p.name}!` : r.outcome.symbol === 'seven' ? 'JACKPOT!!!' : 'POKéMON!'; ui.msgT = 0;
  setTimeout(() => {
    if (!ui) return;
    if (p.kind === 'pokemon') reveal({ pokemon: p.pokemon, ball: { ball: p.ball, key: Math.floor(Math.random() * 1e9), dex: p.pokemon.dex } });
    else if (p.kind === 'stone') stoneWon(p.stone);
    else if (p.kind === 'held') itemWon(p.item);
    ui.phase = 'idle'; ui.pippi = 'idle'; ui.msg = ''; ui.win = null;
  }, big ? 3300 : 2500);
}

// ================= Zeichnen =================
function draw(dt) {
  const { ctx: x, dpr, w, h: H, S, ox, oy } = ui, T = ui.time;
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.imageSmoothingEnabled = false;
  // Spielhalle: dunkler Teppich mit Muster, Lichtkegel hinter dem Automaten
  x.fillStyle = '#24132f'; x.fillRect(0, 0, w, H);
  x.fillStyle = 'rgba(255,200,90,.05)';
  for (let yy = 0; yy < H; yy += 20) for (let xx = (yy / 20) % 2 ? 10 : 0; xx < w; xx += 20) { x.fillRect(xx + 4, yy, 4, 12); x.fillRect(xx, yy + 4, 12, 4); }
  const glow = x.createRadialGradient(ox + 130 * S, oy + 100 * S, 10, ox + 130 * S, oy + 100 * S, 260 * S);
  glow.addColorStop(0, ui.flash > 0 ? 'rgba(255,220,120,.35)' : 'rgba(255,180,90,.18)'); glow.addColorStop(1, 'rgba(255,180,90,0)');
  x.fillStyle = glow; x.fillRect(0, 0, w, H);
  if (!sheet?.complete || !sheet.naturalWidth) return;
  const B = (rect, dx, dy, k = 1, flip = false) => {
    if (!flip) return x.drawImage(sheet, rect[0], rect[1], rect[2], rect[3], dx, dy, rect[2] * k, rect[3] * k);
    x.save(); x.translate(dx + rect[2] * k, dy); x.scale(-1, 1); x.drawImage(sheet, rect[0], rect[1], rect[2], rect[3], 0, 0, rect[2] * k, rect[3] * k); x.restore();
  };
  if (ui.shake > 0.1) ui.shake *= Math.pow(0.02, dt); else ui.shake = 0;
  const shx = ui.shake ? (Math.random() - 0.5) * ui.shake : 0, shy = ui.shake ? (Math.random() - 0.5) * ui.shake : 0;
  x.save(); x.translate(ox + shx, oy + shy); x.scale(S, S); // ab hier Sheet-Koordinaten
  // Boden (Bühne) unter dem Automaten
  x.fillStyle = '#3a2148'; x.fillRect(SCENE.x0 - 40, 192, SCENE.x1 - SCENE.x0 + 80, FLOOR - 192 + 30);
  x.fillStyle = '#4b2c5c'; x.fillRect(SCENE.x0 - 40, 192, SCENE.x1 - SCENE.x0 + 80, 3);
  x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.ellipse(130, 196, 132, 6, 0, 0, 7); x.fill();
  // Gewinn: drehende Lichtstrahlen hinter dem Automaten
  if (ui.win) {
    ui.win.t += dt;
    const k = Math.min(1, ui.win.t * 3), n = 16;
    x.save(); x.translate(130, 90); x.rotate(T * (ui.win.big ? 0.9 : 0.5));
    for (let i = 0; i < n; i++) {
      x.rotate((Math.PI * 2) / n);
      x.fillStyle = i % 2 ? `rgba(255,226,120,${0.22 * k})` : `rgba(255,150,200,${0.16 * k})`;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(-22, -330); x.lineTo(22, -330); x.closePath(); x.fill();
    }
    x.restore();
  }
  // Leuchtschild über dem Automaten mit Lauflicht
  drawMarquee(x, T);
  // Automat mit Walzen
  B(RECT.machine, 2, 11);
  for (const [i, rl] of ui.reels.entries()) drawReel(x, B, i, rl);
  x.fillStyle = ui.flash > 0 && Math.floor(ui.flash * 8) % 2 ? 'rgba(255,60,60,.9)' : 'rgba(255,60,60,.45)';
  x.fillRect(40, 34 + 48 - 0.5, 180, 1); // Gewinnlinie
  if (ui.phase === 'result' && ui.result?.pair && ui.flash > 0) {
    const sym = ui.result.pair === 'replay' ? 'replay' : ui.result.sym, rr = RECT[sym], z = 1.08 + Math.sin(T * 10) * 0.08;
    WIN.forEach(([wx, wy], i) => {
      if (ui.reels[i].target !== sym) return;
      x.strokeStyle = `hsl(${(T * 300 + i * 60) % 360}, 95%, 65%)`; x.lineWidth = 2; x.strokeRect(wx + 1.5, wy + 32.5, WIN_W - 3, 31);
      x.drawImage(sheet, rr[0], rr[1], rr[2], rr[3], wx + WIN_W / 2 - (rr[2] * z) / 2, wy + 48 - (rr[3] * z) / 2, rr[2] * z, rr[3] * z);
    });
  }
  if (ui.win && ui.result?.outcome) {
    const sym = RECT[ui.result.outcome.symbol], z = 1.12 + Math.sin(T * 10) * 0.12;
    WIN.forEach(([wx, wy], i) => {
      const cx = wx + WIN_W / 2, cy = wy + 48, hue = (T * 300 + i * 60) % 360;
      x.strokeStyle = `hsl(${hue}, 95%, 65%)`; x.lineWidth = 2.5; x.strokeRect(wx + 1.5, wy + 32.5, WIN_W - 3, 31);
      x.fillStyle = 'rgba(255,255,220,.55)'; x.fillRect(wx + 3, wy + 34, WIN_W - 6, 28);
      const zz = z + (i === Math.floor(T * 6) % 3 ? 0.08 : 0);
      x.drawImage(sheet, sym[0], sym[1], sym[2], sym[3], cx - (sym[2] * zz) / 2, cy - (sym[3] * zz) / 2, sym[2] * zz, sym[3] * zz);
    });
  }
  if (ui.flash > 0) ui.flash -= dt;
  LAMPS.forEach((ly, i) => {
    const on = ui.flash > 0 ? Math.floor(ui.flash * 10 + i) % 2 === 0 : ui.phase === 'spin' ? Math.floor(T * 6 + i) % 5 === 0 : i === 2;
    if (!on) return;
    for (const lx of [21, 239]) { const g = x.createRadialGradient(lx, ly, 1, lx, ly, 16); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.4, 'rgba(255,240,150,.6)'); g.addColorStop(1, 'rgba(255,240,150,0)'); x.fillStyle = g; x.fillRect(lx - 16, ly - 16, 32, 32); }
  });
  BTN.forEach(([bx, by], i) => { if (ui.reels[i].spinning && !ui.reels[i].ease) { x.strokeStyle = `rgba(255,255,255,${0.5 + Math.sin(T * 8) * 0.4})`; x.lineWidth = 2; x.beginPath(); x.arc(bx, by, 9, 0, 7); x.stroke(); } });
  // Anzeigen: CREDIT = Münzen, PAYOUT = Einsatz; Seitentafeln: Einsatz & Chance
  x.font = "9px 'Ziffern', monospace"; x.textAlign = 'right'; x.fillStyle = '#7dff6a';
  x.fillText(String(app.state.coins % 100000), 116, 186);
  x.fillText(String(SL().bets[ui.bet]), 186, 186);
  x.textAlign = 'center'; x.fillStyle = '#5a2a08'; x.font = "7px 'Ziffern', monospace";
  x.fillText('EINSATZ', 23, 169); x.fillText('CHANCE', 237, 169);
  x.font = "11px 'Ziffern', monospace"; x.fillStyle = '#fff';
  x.fillText(String(SL().bets[ui.bet]), 23, 182); x.fillText('×' + SL().betMult[ui.bet], 237, 182);
  // Sterne-Wolken und Funken
  for (const p of ui.puffs) { p.t += dt; const k = p.t / 0.7, r = k < 0.35 ? RECT.cloudS : RECT.cloudL; x.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.5) * 2); B(r, p.x - r[2] / 2, p.y - r[3] / 2 - k * 10); x.globalAlpha = 1; }
  ui.puffs = ui.puffs.filter((p) => p.t < 0.7);
  const won = ui.phase === 'result' && ui.result?.prize?.kind === 'stone' ? STONE_ORDER.indexOf(ui.result.prize.stone) : -1;
  if (ui.phase === 'result' && ui.result?.prize?.kind === 'held' && ui.itemImg?.complete) { const k = Math.min(1, ui.msgT * 3), bob = Math.sin(T * 5) * 3, sz = 20 + k * 30; x.globalAlpha = k; x.drawImage(ui.itemImg, 130 - sz / 2, 82 - sz / 2 + bob, sz, sz); x.globalAlpha = 1; }
  if (won >= 0 && stonesImg?.complete) { const k = Math.min(1, ui.msgT * 3), bob = Math.sin(T * 5) * 3, sz = 26 + k * 30; x.globalAlpha = k; x.drawImage(stonesImg, won * 52, 0, 52, 52, 130 - sz / 2, 82 - sz / 2 + bob, sz, sz); x.globalAlpha = 1; }
  if (ui.flash > 0 && Math.random() < 0.5) ui.sparks.push({ x: 20 + Math.random() * 220, y: 20 + Math.random() * 110, t: 0 });
  for (const s of ui.sparks) { s.t += dt; s.y -= dt * 20; const a = 1 - s.t / 0.6; x.fillStyle = `rgba(255,236,120,${a})`; x.fillRect(s.x - 1, s.y - 3, 2, 6); x.fillRect(s.x - 3, s.y - 1, 6, 2); }
  ui.sparks = ui.sparks.filter((s) => s.t < 0.6);
  // vorne auf dem Boden: Piepi links, START-Knopf + Einsatz-Bälle in der Mitte
  drawPippi(x, B, dt, T);
  drawStart(x, T, dt);
  drawCelebration(x, dt, T);
  BETS.forEach(([bx, by], i) => {
    const on = ui.bet === i, r = RECT.ball(i, on ? 0 : 2), k = on ? 1.25 + Math.sin(T * 5) * 0.06 : 1;
    if (on) { x.fillStyle = 'rgba(255,220,120,.35)'; x.beginPath(); x.arc(bx, by, 11, 0, 7); x.fill(); }
    B(r, bx - 7 * k, by - 7 * k, k);
    x.font = "7px 'Ziffern', monospace"; x.textAlign = 'center'; x.fillStyle = on ? '#ffe066' : '#bba8c8'; x.fillText(String(SL().bets[i]), bx, by + 15);
  });
  x.restore();
}
function drawMarquee(x, T) {
  const L = 22, R = 238, Tp = -30, Bt = 6;
  x.fillStyle = '#7a1f3d'; x.beginPath(); x.roundRect(L, Tp, R - L, Bt - Tp, 8); x.fill();
  x.fillStyle = '#b8325e'; x.beginPath(); x.roundRect(L + 3, Tp + 3, R - L - 6, Bt - Tp - 6, 6); x.fill();
  // Lauflicht-Birnchen am Rand
  const n = 26, per = 2 * (R - L) + 2 * (Bt - Tp);
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per, bx, by;
    if (d < R - L) { bx = L + d; by = Tp; } else if ((d -= R - L) < Bt - Tp) { bx = R; by = Tp + d; } else if ((d -= Bt - Tp) < R - L) { bx = R - d; by = Bt; } else { d -= R - L; bx = L; by = Bt - d; }
    const on = ui.flash > 0 ? Math.floor(T * 12) % 2 === i % 2 : (i + Math.floor(T * (ui.phase === 'spin' ? 14 : 5))) % 4 === 0;
    x.fillStyle = on ? '#fff6b0' : '#c9875a'; x.beginPath(); x.arc(bx, by, on ? 2.2 : 1.6, 0, 7); x.fill();
  }
  // Schrift: normal „SPIELAUTOMAT“, beim Ergebnis die Nachricht (blinkend bei Gewinn)
  ui.msgT += 0.016;
  const text = ui.msg || 'SPIELAUTOMAT', win = ui.msg && ui.result?.outcome;
  x.textAlign = 'center'; x.font = `700 ${ui.msg ? 15 : 13}px 'Ziffern', sans-serif`; x.lineWidth = 3; x.strokeStyle = '#3a0c1e';
  x.strokeText(text, 130, -7); x.fillStyle = win ? (Math.floor(T * 8) % 2 ? '#ffe066' : '#ffffff') : ui.msg ? '#e8d8f0' : '#ffd9a0'; x.fillText(text, 130, -7);
}
function drawReel(x, B, i, rl) {
  const [wx, wy] = WIN[i], L = rl.strip.length;
  x.save(); x.beginPath(); x.rect(wx, wy, WIN_W, 96); x.clip();
  x.fillStyle = '#f8f8f8'; x.fillRect(wx, wy, WIN_W, 96);
  const b = Math.floor(rl.pos), frac = rl.pos - b;
  for (let k = -1; k <= 3; k++) {
    const r = RECT[rl.strip[mod(b + k, L)]], cy = wy + (k - frac) * CELL + CELL / 2;
    if (rl.spinning && !rl.ease) { x.globalAlpha = 0.85; B(r, wx + (WIN_W - r[2]) / 2, cy - r[3] / 2 - 3); x.globalAlpha = 0.5; B(r, wx + (WIN_W - r[2]) / 2, cy - r[3] / 2 + 3); x.globalAlpha = 1; } // Bewegungsunschärfe
    else B(r, wx + (WIN_W - r[2]) / 2, cy - r[3] / 2);
  }
  const g = x.createLinearGradient(0, wy, 0, wy + 96);
  g.addColorStop(0, 'rgba(0,0,0,.35)'); g.addColorStop(0.22, 'rgba(0,0,0,0)'); g.addColorStop(0.78, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
  x.fillStyle = g; x.fillRect(wx, wy, WIN_W, 96);
  x.restore();
}
// Piepi: atmet im Stehen, streckt beim Drehen die Arme aus, staunt bei zwei gleichen, hüpft beim Gewinn, ist bei Nieten traurig
function drawPippi(x, B, dt, T) {
  const t = ui.pippiT;
  let f = 0;
  switch (ui.pippi) {
    case 'spin': f = 2; break;
    case 'reach': f = 6; break;
    case 'win': f = [4, 5, 2, 3][Math.floor(t * 6) % 4]; break;
    case 'lose': f = 8; break;
    default: f = Math.floor(T / 0.12) % 40 === 0 ? 1 : 0;
  }
  if (ui.hop > 0) { ui.hop += dt; if (ui.hop > 1.6) ui.hop = 0; }
  const jump = ui.hop > 0 ? Math.abs(Math.sin(ui.hop * Math.PI * 2.5)) * 14 : 0;
  const shake = ui.pippi === 'lose' && t < 0.5 ? Math.sin(t * 50) * 1.5 : 0;
  const breathe = ui.pippi === 'idle' ? Math.sin(T * 2.2) * 0.025 : 0;
  const fr = RECT.pippi[f], k = 0.82, cx = 38 + shake, foot = FLOOR + 2;
  x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.ellipse(38, foot, 20 - jump * 0.4, 4, 0, 0, 7); x.fill();
  x.save(); x.translate(cx, foot - jump); x.scale(1 - breathe * 0.5, 1 + breathe);
  B(fr, -(fr[2] * k) / 2, -fr[3] * k, k);
  x.restore();
}
// schwebender Text unter der Münzanzeige (−100, +20, GRATIS!)
function floatText(text, color) {
  const el = h('div.sl-minus', { style: { color } }, text);
  ui.root.append(el);
  setTimeout(() => el.remove(), 1100);
}
// ---- Einsatz: Münzen fliegen von der Anzeige in den Automaten, „−100“ schwebt davon ----
function payFx(bet) {
  const box = ui.coinBox.getBoundingClientRect(), cr = ui.canvas.getBoundingClientRect();
  const tx = cr.left + ui.ox + 130 * ui.S, ty = cr.top + ui.oy + 182 * ui.S; // CREDIT-Anzeige
  const n = Math.min(12, 4 + Math.round(bet / 60));
  for (let i = 0; i < n; i++) {
    const c = iconImg('coin', 3, 'sl-fly');
    document.body.append(c);
    const sx = box.left + box.width * (0.25 + Math.random() * 0.2), sy = box.top + box.height / 2, mx = (sx + tx) / 2 + (Math.random() - 0.5) * 120, my = Math.min(sy, ty) - 40 - Math.random() * 40;
    c.animate([{ transform: `translate(${sx}px, ${sy}px) scale(1.2)`, opacity: 1 }, { transform: `translate(${mx}px, ${my}px) scale(1.4) rotate(180deg)`, opacity: 1, offset: 0.45 }, { transform: `translate(${tx + (Math.random() - 0.5) * 30}px, ${ty}px) scale(.6) rotate(400deg)`, opacity: 0.2 }],
      { duration: 650 + i * 45, delay: i * 55, easing: 'cubic-bezier(.4,.1,.5,1)', fill: 'backwards' }).onfinish = () => c.remove();
  }
  const minus = h('div.sl-minus', `−${bet}`);
  ui.root.append(minus);
  setTimeout(() => minus.remove(), 1100);
  ui.coinBox.classList.remove('bump'); void ui.coinBox.offsetWidth; ui.coinBox.classList.add('bump');
}
// ---- Gewinn-Feier ----
const CONF_COL = ['#ffe066', '#ff6b8b', '#6bd3ff', '#8dff7a', '#ffffff', '#c58bff', '#ffa94d'];
function burstConfetti(n) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 120 + Math.random() * 220;
    ui.confetti.push({ x: 130 + (Math.random() - 0.5) * 60, y: 60, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 16,
      c: CONF_COL[Math.floor(Math.random() * CONF_COL.length)], s: 2 + Math.random() * 3, star: Math.random() < 0.25, t: 0, life: 2.2 + Math.random() * 1.2 });
  }
}
function star(x, cx, cy, r) { x.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.4 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); }
function drawCelebration(x, dt, T) {
  // Feuerwerk über dem Automaten, solange gefeiert wird
  if (ui.win && Math.random() < dt * (ui.win.big ? 4 : 2.2)) {
    const fx = 30 + Math.random() * 200, fy = -20 + Math.random() * 70, c = CONF_COL[Math.floor(Math.random() * CONF_COL.length)];
    for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; ui.fireworks.push({ x: fx, y: fy, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, c, t: 0 }); }
    sfx.place();
  }
  for (const p of ui.fireworks) { p.t += dt; p.vy += 60 * dt; p.vx *= 0.97; p.vy *= 0.97; p.x += p.vx * dt; p.y += p.vy * dt; x.globalAlpha = Math.max(0, 1 - p.t / 0.9); x.fillStyle = p.c; x.fillRect(p.x - 1, p.y - 1, 2, 2); }
  ui.fireworks = ui.fireworks.filter((p) => p.t < 0.9);
  for (const p of ui.confetti) {
    p.t += dt; p.vy += 260 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    x.globalAlpha = Math.max(0, Math.min(1, (p.life - p.t) * 2)); x.fillStyle = p.c;
    if (p.star) star(x, p.x, p.y, p.s + 1); else { x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillRect(-p.s / 2, -p.s * 0.3, p.s, p.s * 0.6 * Math.abs(Math.cos(p.r))); x.restore(); }
  }
  x.globalAlpha = 1;
  ui.confetti = ui.confetti.filter((p) => p.t < p.life && p.y < 330);
  // großer Gewinntext mitten über den Walzen: springt herein, Regenbogenfarben
  if (ui.win && ui.msg) {
    const t = ui.win.t, k = Math.min(1, t * 4), z = (0.4 + k * 0.8) * (1 + Math.sin(T * 8) * 0.05), hue = (T * 240) % 360;
    x.save(); x.translate(130, ['stone', 'held'].includes(ui.result?.prize?.kind) ? 118 : 84); x.scale(z, z); x.rotate(Math.sin(T * 5) * 0.04); // beim Stein schwebt dieser in der Mitte
    x.font = "700 24px 'Ziffern', sans-serif"; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 6; x.strokeStyle = '#3a0c1e'; x.strokeText(ui.msg, 0, 0);
    x.fillStyle = `hsl(${hue}, 100%, 70%)`; x.fillText(ui.msg, 0, 0);
    x.fillStyle = 'rgba(255,255,255,.55)'; x.fillText(ui.msg, 0, -1.5);
    x.restore(); x.textBaseline = 'alphabetic';
  }
}
// großer runder START-Knopf (gedrückt, solange die Walzen laufen)
function drawStart(x, T, dt) {
  const [cx, cy, R] = START, down = ui.phase !== 'idle';
  if (ui.press > 0) ui.press -= dt;
  const d = down ? 3 : 0;
  x.fillStyle = '#2a0e14'; x.beginPath(); x.ellipse(cx, cy + 5, R + 3, R * 0.62 + 3, 0, 0, 7); x.fill();
  x.fillStyle = '#7d1020'; x.beginPath(); x.ellipse(cx, cy + 4, R, R * 0.62, 0, 0, 7); x.fill();
  const g = x.createRadialGradient(cx - 6, cy - 6 + d, 2, cx, cy + d, R);
  g.addColorStop(0, down ? '#e04050' : '#ff8a8a'); g.addColorStop(0.5, down ? '#b81c30' : '#f02a40'); g.addColorStop(1, '#9a1022');
  x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy + d, R, R * 0.62, 0, 0, 7); x.fill();
  if (!down) { const p = 0.5 + Math.sin(T * 4) * 0.5; x.strokeStyle = `rgba(255,240,200,${0.3 + p * 0.5})`; x.lineWidth = 1.5; x.beginPath(); x.ellipse(cx, cy, R + 2 + p * 2, R * 0.62 + 2 + p * 1.5, 0, 0, 7); x.stroke(); }
  x.font = "700 10px 'Ziffern', sans-serif"; x.textAlign = 'center'; x.fillStyle = '#fff'; x.strokeStyle = '#6a0a18'; x.lineWidth = 2;
  const lbl = (app.state.slots?.free || 0) > 0 ? 'GRATIS' : 'START';
  if (lbl === 'GRATIS') x.font = "700 9px 'Ziffern', sans-serif";
  x.strokeText(lbl, cx, cy + 3 + d); x.fillText(lbl, cx, cy + 3 + d);
}

// ================= Beutel: Steine & Items =================
function stoneWon(stone) {
  const targets = stoneTargets(app.state, stone);
  modal((m, close) => {
    m.append(h('div.stone-big', stoneIcon(stone, 72)), h('h3', `${stoneName(stone)}!`),
      h('p.note', targets.length ? (targets.length === 1 ? 'Damit kann sich eines deiner Pokémon dauerhaft entwickeln.' : `Damit können sich ${targets.length} deiner Pokémon dauerhaft entwickeln.`) : 'Gerade kann sich keines deiner Pokémon damit entwickeln – der Stein wartet im Beutel 🎒.'),
      h('div.row', h('button.btn', { onclick: close }, 'Später'), targets.length ? h('button.btn.primary', { onclick: () => { close(); openBag(stone); } }, 'Jetzt benutzen') : null));
  });
}
function itemWon(it) {
  modal((m, close) => {
    m.append(h('div.stone-big', h('img.item-ico', { src: itemSprite(it), alt: '', style: { width: '72px', height: '72px' } })), h('h3', `${it.name}!`),
      h('p.note', it.desc, ' Gib es einem Pokémon zum Tragen – alle deine Pokémon genau dieser Sorte (z. B. alle deine Owei) haben dann den Effekt, Gegner nie.'),
      h('div.row', h('button.btn', { onclick: close }, 'Später'), h('button.btn.primary', { onclick: () => { close(); openBag(null, { tab: 'items', item: it.id }); } }, 'Jetzt geben')));
  });
}
const pname = (p) => p.nick || species(p.dex).name;
// Beutel: Entwicklungssteine benutzen (dauerhafte Entwicklung) und Items zum Tragen geben/abnehmen
// opts.tab = 'stones' | 'items', opts.item = vorausgewähltes Item, opts.uid = nur dieses Pokémon (aus der Pokémon-Ansicht)
export function openBag(focus = null, opts = {}) {
  let tab = opts.tab || (focus ? 'stones' : Object.keys(app.state.items?.held || {}).length && !Object.keys(app.state.items?.stones || {}).length ? 'items' : 'stones');
  modal((m, close) => {
    const body = h('div'), tabs = h('div.rk-tabs');
    const renderTabs = () => tabs.replaceChildren(
      h('button.btn.small' + (tab === 'stones' ? '.primary' : ''), { onclick: () => { tab = 'stones'; renderTabs(); renderStones(focus); } }, '💎 Steine'),
      h('button.btn.small' + (tab === 'items' ? '.primary' : ''), { onclick: () => { tab = 'items'; renderTabs(); renderItems(opts.item); } }, '🎒 Items'));
    const renderStones = (sel) => {
      const stones = Object.entries(app.state.items?.stones || {}).filter(([, n]) => n > 0);
      if (!stones.length) { body.replaceChildren(h('p.note', 'Noch keine Entwicklungssteine. Gewinne welche am Spielautomaten (💎💎💎)!')); return; }
      sel = sel && stones.some(([k]) => k === sel) ? sel : stones[0][0];
      const targets = favFirst(stoneTargets(app.state, sel));
      body.replaceChildren(
        h('div.rk-tabs.wrap', stones.map(([k, n]) => h('button.btn.small.stone-tab' + (k === sel ? '.primary' : ''), { onclick: () => renderStones(k) }, stoneIcon(k, 22), `${stoneName(k)} ×${n}`))),
        targets.length ? h('div.inv', targets.map((p) => h('div.stone-row',
          h('img', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }),
          h('div', h('b', p.fav ? '★ ' : '', pname(p)), h('small', `Lv ${p.level}`)),
          h('button.btn.primary.small', { onclick: async () => {
            if (!(await confirmDialog(`${pname(p)} mit dem ${stoneName(sel)} dauerhaft entwickeln?`, 'Entwickeln'))) { openBag(sel); return; }
            const r = app.act((s) => useStone(s, p.uid, sel), true);
            if (r.ok === false) return;
            sfx.evolve(); haptic('strong');
            toast(`${species(r.from).name} hat sich zu ${species(r.to).name} entwickelt!`);
            openBag(sel);
          } }, 'Entwickeln')))) : h('p.note', 'Keines deiner Pokémon kann sich damit entwickeln.'));
    };
    const renderItems = (sel) => {
      const inv = Object.entries(app.state.items?.held || {}).filter(([, n]) => n > 0).map(([id, n]) => [itemById(id), n]).filter(([it]) => it);
      const holders = favFirst(app.state.pokemon.filter((p) => p.held && (!opts.uid || p.uid === opts.uid)));
      const parts = [];
      if (!inv.length) parts.push(h('p.note', 'Keine freien Items. Gewinne welche am Spielautomaten (🍒🍒🍒)!'));
      else {
        sel = sel && inv.some(([it]) => it.id === sel) ? sel : inv[0][0].id;
        const it = itemById(sel);
        const fit = (p) => (it.fx.type && species(p.dex).types.includes(it.fx.type) ? 1 : 0); // Typ-Item: passende Pokémon zuerst
        const mons = (opts.uid ? app.state.pokemon.filter((p) => p.uid === opts.uid) : app.state.pokemon.filter((p) => canBattle(p.dex))).sort((a, b) => fit(b) - fit(a) || !!b.fav - !!a.fav || a.dex - b.dex);
        parts.push(h('div.rk-tabs.wrap', inv.map(([x, n]) => h('button.btn.small.stone-tab' + (x.id === sel ? '.primary' : ''), { onclick: () => renderItems(x.id) }, h('img.item-ico', { src: itemSprite(x), alt: '' }), `${x.name} ×${n}`))),
          h('p.note', h('b', it.name + ': '), it.desc, ' Gilt für alle deine Pokémon genau dieser Sorte (z. B. alle deine Owei) – nicht für andere desselben Typs und nie für Gegner.'),
          h('div.inv', mons.map((p) => h('div.stone-row',
            h('img', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }),
            h('div', h('b', p.fav ? '★ ' : '', pname(p), it.fx.type && species(p.dex).types.includes(it.fx.type) ? h('span.rk-buff', `passt: ${it.fx.type}`) : null), h('small', p.held ? `trägt ${itemById(p.held)?.name}` : `Lv ${p.level}`)),
            h('button.btn.primary.small', { onclick: () => {
              const r = app.act((s) => giveItem(s, p.uid, sel), true);
              if (r.ok === false) return;
              haptic('medium'); sfx.place(); toast(`${pname(p)} trägt jetzt ${it.name}.`); opts.uid ? close() : renderItems(sel);
            } }, 'Geben')))));
      }
      if (holders.length) parts.push(h('b.ds-h', 'Getragen'), h('div.inv', holders.map((p) => { const x = itemById(p.held); return h('div.stone-row',
        h('img', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }),
        h('div', h('b', pname(p)), h('small', h('img.item-ico.small', { src: itemSprite(x), alt: '' }), x.name)),
        h('button.btn.small', { onclick: () => { app.act((s) => takeItem(s, p.uid), true); haptic('tick'); renderItems(sel); } }, 'Abnehmen')); })));
      body.replaceChildren(...parts);
    };
    renderTabs(); tab === 'items' ? renderItems(opts.item) : renderStones(focus);
    m.append(h('div.row', h('h3', { style: { margin: 0, flex: 1 } }, '🎒 Beutel'), h('button.btn.small', { onclick: close, style: { flex: 'none' } }, '✕')), tabs, body);
  });
}
