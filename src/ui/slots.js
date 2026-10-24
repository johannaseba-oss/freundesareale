// Spielautomat-Oberfläche (Vollbild): Einsatz-Bälle antippen, START drücken, Walzen mit Y/B/A stoppen.
// Das Ergebnis steht schon beim Start fest (und ist sofort gutgeschrieben) – die Walzen rutschen beim Stoppen bis zum passenden Symbol.
// Piepi steht vor dem Automaten, Pikachu sitzt mit dem Rücken zu dir davor und schaut zu.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { SYMBOLS, chances, spin, claim, stoneTargets, useStone } from '../game/slots.js';
import { stoneName } from '../game/battle.js';
import { portraitUrl } from '../gfx/sprites.js';
import { $, h, toast, modal, confirmDialog } from './dom.js';
import { reveal } from './gacha.js';
import { sfx, setMusic } from '../audio.js';
import { haptic } from '../haptics.js';

const SL = () => CFG.slots;
const base = import.meta.env.BASE_URL;
// Ausschnitte aus public/art/slots/sheet.png (siehe tools/build_slots.mjs)
const RECT = {
  machine: [2, 11, 256, 183],
  seven: [265, 5, 44, 26], g: [268, 36, 38, 28], replay: [266, 69, 42, 26], cherry: [269, 99, 35, 30], pika: [263, 132, 48, 28], gem: [267, 167, 38, 26],
  cloudS: [93, 204, 53, 46], cloudL: [87, 260, 64, 61], pikachu: [87, 332, 64, 56],
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
  const root = h('div.sl-full', canvas,
    btn('.left', '?', 'Gewinne', showHelp), btn('.left2', '🎒', 'Beutel', () => openBag()), btn('.right', '✕', 'Schließen', close));
  document.body.append(root);
  document.body.classList.add('in-battle');
  setMusic('arena');
  ui = { root, canvas, ctx: canvas.getContext('2d'), bet: 0, reels: [0, 1, 2].map((i) => ({ strip: strip(i), pos: i * 3, spinning: false })),
    phase: 'idle', t: 0, time: 0, last: performance.now(), raf: 0, flash: 0, puffs: [], sparks: [], pippi: 'idle', pippiT: 0, hop: 0, pikaHop: 0, press: 0, msg: '', msgT: 0 };
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
      h('p.note', `Einsatz ${SL().bets[ui.bet]} Münzen (antippen der Bälle unten ändert ihn). Münzen gibt es nie zurück – nur Pokémon und Entwicklungssteine. Mehr Einsatz = bessere Chancen.`),
      h('div.sl-legend', ch.map(({ o, p }) => h('div.sl-row', h('span.sl-syms', spriteCanvas(RECT[o.symbol], 1), spriteCanvas(RECT[o.symbol], 1), spriteCanvas(RECT[o.symbol], 1)), h('span', o.label), h('small', `${(p * 100).toFixed(p < 0.01 ? 2 : 1)} %`)))),
      h('p.note', 'Alles andere: leider nichts.'),
      h('div.row', h('button.btn.primary', { onclick: close }, 'OK')));
  });
}

// ================= Spielen =================
function startSpin() {
  if (!ui || ui.phase !== 'idle') return;
  const betIdx = ui.bet;
  const r = app.act((s, t) => {
    const sp = spin(s, betIdx, false);
    if (!sp.ok) return sp;
    return { ok: true, outcome: sp.outcome, prize: sp.outcome ? claim(s, t, sp.outcome) : null };
  }, true);
  if (r.ok === false) return;
  sfx.coin(); haptic('medium');
  ui.result = r; ui.phase = 'spin'; ui.t = 0; ui.pippi = 'spin'; ui.pippiT = 0; ui.msg = ''; ui.press = 0.25;
  // Zielsymbole: Gewinn = dreimal dasselbe, Niete = nie drei gleiche (manchmal zwei gleiche als Spannung)
  let targets;
  if (r.outcome) targets = [0, 1, 2].map(() => r.outcome.symbol);
  else {
    const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    targets = [pick(), pick(), pick()];
    if (Math.random() < 0.3) targets[1] = targets[0];
    if (targets[0] === targets[1] && targets[1] === targets[2]) targets[2] = SYMBOLS[(SYMBOLS.indexOf(targets[2]) + 1 + Math.floor(Math.random() * 5)) % SYMBOLS.length];
  }
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
  if (!r.outcome) {
    ui.pippi = 'lose'; ui.pippiT = 0; ui.msg = 'Leider nichts …'; ui.msgT = 0; sfx.bite();
    setTimeout(() => { if (ui) { ui.phase = 'idle'; ui.pippi = 'idle'; ui.msg = ''; } }, 1300);
    return;
  }
  // Gewinn: Lampen blinken, Sterne-Wolken über den Walzen, Piepi und Pikachu hüpfen vor Freude
  ui.flash = 2.4; ui.pippi = 'win'; ui.pippiT = 0; ui.hop = 0.01; ui.pikaHop = 0.15; sfx.win(); haptic('strong');
  WIN.forEach(([wx, wy], i) => setTimeout(() => ui?.puffs.push({ x: wx + WIN_W / 2, y: wy + 48, t: 0 }), i * 160));
  const p = r.prize;
  ui.msg = p.kind === 'stone' ? `${p.name}!` : r.outcome.symbol === 'seven' ? 'JACKPOT!!!' : 'POKéMON!'; ui.msgT = 0;
  setTimeout(() => {
    if (!ui) return;
    if (p.kind === 'pokemon') reveal({ pokemon: p.pokemon, ball: { ball: p.ball, key: Math.floor(Math.random() * 1e9), dex: p.pokemon.dex } });
    else if (p.kind === 'stone') stoneWon(p.stone);
    ui.phase = 'idle'; ui.pippi = 'idle'; ui.msg = '';
  }, p.kind === 'pokemon' ? 1900 : 1500);
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
  x.save(); x.translate(ox, oy); x.scale(S, S); // ab hier Sheet-Koordinaten
  // Boden (Bühne) unter dem Automaten
  x.fillStyle = '#3a2148'; x.fillRect(SCENE.x0 - 40, 192, SCENE.x1 - SCENE.x0 + 80, FLOOR - 192 + 30);
  x.fillStyle = '#4b2c5c'; x.fillRect(SCENE.x0 - 40, 192, SCENE.x1 - SCENE.x0 + 80, 3);
  x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.ellipse(130, 196, 132, 6, 0, 0, 7); x.fill();
  // Leuchtschild über dem Automaten mit Lauflicht
  drawMarquee(x, T);
  // Automat mit Walzen
  B(RECT.machine, 2, 11);
  for (const [i, rl] of ui.reels.entries()) drawReel(x, B, i, rl);
  x.fillStyle = ui.flash > 0 && Math.floor(ui.flash * 8) % 2 ? 'rgba(255,60,60,.9)' : 'rgba(255,60,60,.45)';
  x.fillRect(40, 34 + 48 - 0.5, 180, 1); // Gewinnlinie
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
  if (won >= 0 && stonesImg?.complete) { const k = Math.min(1, ui.msgT * 3), bob = Math.sin(T * 5) * 3, sz = 26 + k * 30; x.globalAlpha = k; x.drawImage(stonesImg, won * 52, 0, 52, 52, 130 - sz / 2, 82 - sz / 2 + bob, sz, sz); x.globalAlpha = 1; }
  if (ui.flash > 0 && Math.random() < 0.5) ui.sparks.push({ x: 20 + Math.random() * 220, y: 20 + Math.random() * 110, t: 0 });
  for (const s of ui.sparks) { s.t += dt; s.y -= dt * 20; const a = 1 - s.t / 0.6; x.fillStyle = `rgba(255,236,120,${a})`; x.fillRect(s.x - 1, s.y - 3, 2, 6); x.fillRect(s.x - 3, s.y - 1, 6, 2); }
  ui.sparks = ui.sparks.filter((s) => s.t < 0.6);
  // vorne auf dem Boden: Piepi links, START-Knopf + Einsatz-Bälle in der Mitte, Pikachu rechts (Rücken zu dir)
  drawPippi(x, B, dt, T);
  drawStart(x, T, dt);
  BETS.forEach(([bx, by], i) => {
    const on = ui.bet === i, r = RECT.ball(i, on ? 0 : 2), k = on ? 1.25 + Math.sin(T * 5) * 0.06 : 1;
    if (on) { x.fillStyle = 'rgba(255,220,120,.35)'; x.beginPath(); x.arc(bx, by, 11, 0, 7); x.fill(); }
    B(r, bx - 7 * k, by - 7 * k, k);
    x.font = "7px 'Ziffern', monospace"; x.textAlign = 'center'; x.fillStyle = on ? '#ffe066' : '#bba8c8'; x.fillText(String(SL().bets[i]), bx, by + 15);
  });
  drawPikachu(x, B, dt, T);
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
// Pikachu sitzt mit dem Rücken zu dir vor dem Automaten: wippt beim Drehen mit, springt beim Gewinn, sackt bei Nieten etwas zusammen
function drawPikachu(x, B, dt, T) {
  if (ui.pikaHop > 0) { ui.pikaHop += dt; if (ui.pikaHop > 1.7) ui.pikaHop = 0; }
  const jump = ui.pikaHop > 0.15 ? Math.abs(Math.sin((ui.pikaHop - 0.15) * Math.PI * 2.5)) * 10 : 0;
  const bob = ui.phase === 'spin' ? Math.abs(Math.sin(T * 9)) * 2 : Math.sin(T * 1.8) * 0.6;
  const sad = ui.pippi === 'lose' ? 2 : 0;
  const r = RECT.pikachu, k = 0.78, foot = FLOOR + 4;
  x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.ellipse(222, foot, 22 - jump * 0.4, 4, 0, 0, 7); x.fill();
  B(r, 222 - (r[2] * k) / 2, foot - r[3] * k - jump - bob + sad, k, true);
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
  x.strokeText('START', cx, cy + 3 + d); x.fillText('START', cx, cy + 3 + d);
}

// ================= Steine =================
function stoneWon(stone) {
  const targets = stoneTargets(app.state, stone);
  modal((m, close) => {
    m.append(h('div.stone-big', stoneIcon(stone, 72)), h('h3', `${stoneName(stone)}!`),
      h('p.note', targets.length ? (targets.length === 1 ? 'Damit kann sich eines deiner Pokémon dauerhaft entwickeln.' : `Damit können sich ${targets.length} deiner Pokémon dauerhaft entwickeln.`) : 'Gerade kann sich keines deiner Pokémon damit entwickeln – der Stein wartet im Beutel 🎒.'),
      h('div.row', h('button.btn', { onclick: close }, 'Später'), targets.length ? h('button.btn.primary', { onclick: () => { close(); openBag(stone); } }, 'Jetzt benutzen') : null));
  });
}
// Beutel: Entwicklungssteine benutzen (dauerhafte Entwicklung)
export function openBag(focus = null) {
  modal((m, close) => {
    const body = h('div');
    const render = (sel) => {
      const stones = Object.entries(app.state.items?.stones || {}).filter(([, n]) => n > 0);
      if (!stones.length) { body.replaceChildren(h('p.note', 'Noch keine Entwicklungssteine. Gewinne welche am Spielautomaten (💎💎💎)!')); return; }
      sel = sel && stones.some(([k]) => k === sel) ? sel : stones[0][0];
      const targets = stoneTargets(app.state, sel);
      body.replaceChildren(
        h('div.rk-tabs.wrap', stones.map(([k, n]) => h('button.btn.small.stone-tab' + (k === sel ? '.primary' : ''), { onclick: () => render(k) }, stoneIcon(k, 22), `${stoneName(k)} ×${n}`))),
        targets.length ? h('div.inv', targets.map((p) => h('div.stone-row',
          h('img', { src: portraitUrl(p.dex), alt: '' }),
          h('div', h('b', p.nick || species(p.dex).name), h('small', `Lv ${p.level}`)),
          h('button.btn.primary.small', { onclick: async () => {
            if (!(await confirmDialog(`${p.nick || species(p.dex).name} mit dem ${stoneName(sel)} dauerhaft entwickeln?`, 'Entwickeln'))) { openBag(sel); return; }
            const r = app.act((s) => useStone(s, p.uid, sel), true);
            if (r.ok === false) return;
            sfx.evolve(); haptic('strong');
            toast(`${species(r.from).name} hat sich zu ${species(r.to).name} entwickelt!`);
            openBag(sel);
          } }, 'Entwickeln')))) : h('p.note', 'Keines deiner Pokémon kann sich damit entwickeln.'));
    };
    render(focus);
    m.append(h('div.row', h('h3', { style: { margin: 0, flex: 1 } }, '🎒 Entwicklungssteine'), h('button.btn.small', { onclick: close, style: { flex: 'none' } }, '✕')), body);
  });
}
