// Spielautomat-Oberfläche: Einsatz wählen, Walzen drehen, mit Y/B/A stoppen. Das Ergebnis steht schon beim Start fest
// (und ist sofort gutgeschrieben) – die Walzen rutschen beim Stoppen höchstens bis zum passenden Symbol weiter.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { SYMBOLS, chances, spin, claim, stoneTargets, useStone } from '../game/slots.js';
import { stoneName } from '../game/battle.js';
import { portraitUrl } from '../gfx/sprites.js';
import { iconImg } from '../gfx/icons.js';
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
  cloudS: [93, 204, 53, 46], cloudL: [87, 260, 64, 61], tail: [87, 332, 64, 56],
  pippi: [[155, 199, 58, 60], [220, 199, 58, 60], [152, 263, 64, 60], [217, 263, 64, 60], [155, 326, 58, 61], [220, 326, 58, 61], [152, 389, 65, 62], [217, 389, 65, 62], [152, 453, 65, 62], [217, 453, 65, 62]],
  ball: (c, r) => [3 + 17 * c, 196 + 16 * r, 14, 14],
  digit: (d) => [290, 202 + 32 * d, 16, 26],
};
const WIN = [[44, 34], [104, 34], [164, 34]], WIN_W = 52, CELL = 32; // Walzenfenster (Sheet-Koordinaten)
const BTN = [[70, 146], [130, 146], [190, 146]];
const LAMPS = [27, 50, 82, 113, 137];
let ui = null, sheet = null;

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
  const canvas = h('canvas.arena-canvas');
  const coins = h('span.wk-coins');
  const top = h('div.b-top', h('div.b-name', h('b', '🎰 Spielautomat'), h('small', 'Einsatz ab ' + SL().bets[0] + ' Münzen · keine Münzen zurück')), coins,
    h('button.b-btn', { onclick: () => openBag(), title: 'Beutel' }, '🎒'),
    h('button.b-btn', { onclick: close, title: 'Schließen' }, '✕'));
  const betRow = h('div.sl-bets');
  const spinBtn = h('button.btn.primary.big.sl-spin', { onclick: startSpin }, 'Drehen!');
  const legend = h('div.sl-legend');
  const root = h('div.battle.slots', top, h('div.b-field', canvas), h('div.sl-controls', betRow, spinBtn, legend));
  document.body.append(root);
  document.body.classList.add('in-battle');
  setMusic('arena');
  ui = { root, canvas, ctx: canvas.getContext('2d'), coins, betRow, spinBtn, legend, bet: 0, reels: [0, 1, 2].map((i) => ({ strip: strip(i), pos: i * 3 + 0.0, spinning: false, stopAt: null })),
    phase: 'idle', t: 0, last: performance.now(), raf: 0, flash: 0, puffs: [], pippi: 'idle', pippiT: 0, digits: null, msg: '' };
  ui.ro = new ResizeObserver(layout); ui.ro.observe(canvas.parentElement);
  canvas.addEventListener('pointerdown', onTap);
  renderBets(); layout();
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
const freeSpins = () => app.state.slots?.free || 0;
function renderBets() {
  const fr = freeSpins();
  ui.betRow.replaceChildren(...SL().bets.map((b, i) => h('button.sl-bet' + (ui.bet === i ? '.on' : ''), { disabled: ui.phase !== 'idle' || fr > 0, onclick: () => { ui.bet = i; haptic('tick'); renderBets(); } },
    spriteCanvas(RECT.ball(i, ui.bet === i ? 0 : 2), 2), h('b', String(b)), h('small', i ? `Chance ×${SL().betMult[i]}` : 'Einsatz'))));
  ui.spinBtn.textContent = fr > 0 ? `Freispiel! (${fr})` : `Drehen! (${SL().bets[ui.bet]})`;
  ui.spinBtn.disabled = ui.phase !== 'idle';
  const ch = chances(fr > 0 ? app.state.slots.freeBet || 0 : ui.bet);
  ui.legend.replaceChildren(...ch.map(({ o, p }) => h('div.sl-row', h('span.sl-syms', spriteCanvas(RECT[o.symbol], 1), spriteCanvas(RECT[o.symbol], 1), spriteCanvas(RECT[o.symbol], 1)), h('span', o.label), h('small', `${(p * 100).toFixed(p < 0.01 ? 2 : 1)} %`))));
}
function layout() {
  const { canvas } = ui, r = canvas.parentElement.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  const fit = Math.min((r.width - 12) / 256, (r.height * 0.74) / 183);
  let S = Math.max(1, Math.floor(fit * dpr)) / dpr; // ganzzahlige Gerätepixel = scharfe Pixel
  if (S < fit * 0.85) S = fit; // bei wenig Gerätepixeln lieber größer als ganz scharf
  Object.assign(ui, { dpr, w: r.width, h: r.height, S, mx: Math.round(((r.width - 256 * S) / 2) * dpr) / dpr, my: Math.round(Math.max(4, (r.height - 183 * S - 64 * S * 0.9) / 2) * dpr) / dpr });
}

// ================= Spielen =================
function startSpin() {
  if (!ui || ui.phase !== 'idle') return;
  const free = freeSpins() > 0, betIdx = free ? app.state.slots.freeBet || 0 : ui.bet;
  const r = app.act((s, t) => {
    if (free) s.slots.free--;
    const sp = spin(s, betIdx, free);
    if (!sp.ok) { if (free) s.slots.free++; return sp; }
    const c = sp.outcome ? claim(s, t, sp.outcome) : null;
    if (c?.kind === 'replay') { s.slots.free = (s.slots.free || 0) + 1; s.slots.freeBet = betIdx; }
    return { ok: true, outcome: sp.outcome, prize: c };
  }, true);
  if (r.ok === false) return;
  sfx.coin(); haptic('medium');
  ui.result = r; ui.phase = 'spin'; ui.t = 0; ui.pippi = 'spin'; ui.digits = null; ui.msg = '';
  // Zielsymbole je Walze: Gewinn = dreimal dasselbe, Niete = nie drei gleiche (manchmal zwei gleiche als Spannung)
  let targets;
  if (r.outcome) targets = [0, 1, 2].map(() => r.outcome.symbol);
  else {
    const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    targets = [pick(), pick(), pick()];
    if (Math.random() < 0.3) targets[1] = targets[0];
    if (targets[0] === targets[1] && targets[1] === targets[2]) targets[2] = SYMBOLS[(SYMBOLS.indexOf(targets[2]) + 1 + Math.floor(Math.random() * 5)) % SYMBOLS.length];
  }
  ui.reels.forEach((rl, i) => Object.assign(rl, { spinning: true, target: targets[i], stopAt: null, ease: null, speed: 14 + i * 1.5 }));
  renderBets();
}
// Walze i anhalten: rutscht bis zum nächsten Feld, auf dem das Zielsymbol in der Mitte steht (höchstens eine Runde)
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
  if (!ui || ui.phase !== 'spin') return;
  const r = ui.canvas.getBoundingClientRect(), x = (e.clientX - r.left - ui.mx) / ui.S + 2, y = (e.clientY - r.top - ui.my) / ui.S + 11;
  // Stopp-Knöpfe oder direkt auf die Walze tippen
  BTN.forEach(([bx, by], i) => { if (Math.hypot(x - bx, y - by) < 14 || (x >= WIN[i][0] && x < WIN[i][0] + WIN_W && y >= WIN[i][1] && y < WIN[i][1] + 96)) stopReel(i); });
}

function frame(dt) {
  if (!ui) return;
  ui.t += dt; ui.pippiT += dt;
  ui.coins.replaceChildren(iconImg('coin', 2), ` ${app.state.coins}`);
  for (const [i, rl] of ui.reels.entries()) {
    if (!rl.spinning) continue;
    if (rl.ease) {
      rl.ease.t += dt;
      const k = Math.min(1, rl.ease.t / rl.ease.dur), o = 1 - Math.pow(1 - k, 3); // weich auslaufen, kleiner Rückfederer
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
  const done = ui.reels.filter((r) => !r.spinning).length;
  const syms = ui.reels.map((r) => r.strip[mod(Math.round(r.pos) + 1, r.strip.length)]);
  if (done === 2 && ui.reels.filter((r) => !r.spinning).every((r, _, a) => r.target === a[0].target)) { ui.pippi = 'reach'; ui.pippiT = 0; } // zwei gleiche: Spannung!
  if (done < 3) return;
  ui.phase = 'result';
  const r = ui.result;
  if (!r.outcome) {
    ui.pippi = 'lose'; ui.pippiT = 0; ui.msg = 'Leider nichts …'; sfx.bite();
    setTimeout(() => { if (ui) { ui.phase = 'idle'; ui.pippi = 'idle'; renderBets(); } }, 1100);
    return;
  }
  // Gewinn: Lampen blinken, Sterne-Wolken über den Walzen, Piepi jubelt
  ui.flash = 2.2; ui.pippi = 'win'; ui.pippiT = 0; sfx.win(); haptic('strong');
  WIN.forEach(([wx, wy], i) => setTimeout(() => ui?.puffs.push({ x: wx + WIN_W / 2, y: wy + 48, t: 0 }), i * 160));
  const p = r.prize;
  if (p.kind === 'ep') { ui.digits = { text: '+' + p.amount, t: 0 }; ui.msg = `+${p.amount} EP!`; }
  else if (p.kind === 'replay') ui.msg = 'FREISPIEL!';
  else if (p.kind === 'stone') ui.msg = `${p.name}!`;
  else ui.msg = syms[0] === 'seven' ? 'JACKPOT!!!' : 'Ein Pokémon!';
  setTimeout(() => {
    if (!ui) return;
    if (p.kind === 'pokemon') reveal({ pokemon: p.pokemon, ball: { ball: p.ball, key: Math.floor(Math.random() * 1e9), dex: p.pokemon.dex } });
    else if (p.kind === 'stone') stoneWon(p.stone);
    else if (p.kind === 'ep') toast(`+${p.amount} EP – damit trainierst du deine Pokémon im Routen-Modus.`);
    ui.phase = 'idle'; ui.pippi = 'idle'; renderBets();
  }, p.kind === 'pokemon' ? 1800 : 1400);
}

// ================= Zeichnen =================
function draw(dt) {
  const { ctx: x, dpr, w, h: H, S, mx, my } = ui;
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.imageSmoothingEnabled = false;
  // Spielhallen-Teppich
  x.fillStyle = '#2b1838'; x.fillRect(0, 0, w, H);
  x.fillStyle = 'rgba(255,210,90,.06)';
  for (let yy = 0; yy < H; yy += 18) for (let xx = (yy / 18) % 2 ? 9 : 0; xx < w; xx += 18) x.fillRect(xx, yy, 6, 6);
  if (!sheet?.complete || !sheet.naturalWidth) return;
  const B = (rect, dx, dy, k = 1) => x.drawImage(sheet, rect[0], rect[1], rect[2], rect[3], dx, dy, rect[2] * k, rect[3] * k);
  x.save(); x.translate(mx, my); x.scale(S, S); x.translate(-2, -11); // ab hier Koordinaten wie im Sprite-Sheet
  // Walzen (hinter dem Gehäuse liegt Weiß – Symbole direkt in die Fenster zeichnen)
  B(RECT.machine, 2, 11);
  for (const [i, rl] of ui.reels.entries()) {
    const [wx, wy] = WIN[i], L = rl.strip.length;
    x.save(); x.beginPath(); x.rect(wx, wy, WIN_W, 96); x.clip();
    x.fillStyle = '#f8f8f8'; x.fillRect(wx, wy, WIN_W, 96);
    const b = Math.floor(rl.pos), frac = rl.pos - b;
    for (let k = -1; k <= 3; k++) {
      const sym = rl.strip[mod(b + k, L)], r = RECT[sym];
      const cy = wy + (k - frac) * CELL + CELL / 2;
      if (rl.spinning && !rl.ease) { x.globalAlpha = 0.85; B(r, wx + (WIN_W - r[2]) / 2, cy - r[3] / 2 - 3); x.globalAlpha = 0.5; B(r, wx + (WIN_W - r[2]) / 2, cy - r[3] / 2 + 3); x.globalAlpha = 1; } // Bewegungsunschärfe
      else B(r, wx + (WIN_W - r[2]) / 2, cy - r[3] / 2);
    }
    // Walzenwölbung
    const g = x.createLinearGradient(0, wy, 0, wy + 96);
    g.addColorStop(0, 'rgba(0,0,0,.35)'); g.addColorStop(0.22, 'rgba(0,0,0,0)'); g.addColorStop(0.78, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
    x.fillStyle = g; x.fillRect(wx, wy, WIN_W, 96);
    x.restore();
  }
  // Gewinnlinie (Mitte)
  x.fillStyle = ui.flash > 0 && Math.floor(ui.flash * 8) % 2 ? 'rgba(255,60,60,.9)' : 'rgba(255,60,60,.45)';
  x.fillRect(40, 34 + 48 - 0.5, 180, 1);
  // Lampen: beim Gewinn blinkend, sonst ruhig glimmend
  if (ui.flash > 0) ui.flash -= dt;
  LAMPS.forEach((ly, i) => {
    const on = ui.flash > 0 ? Math.floor(ui.flash * 10 + i) % 2 === 0 : i === 2 && ui.phase === 'spin';
    if (!on) return;
    for (const lx of [21, 239]) { const g = x.createRadialGradient(lx, ly, 1, lx, ly, 16); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.4, 'rgba(255,240,150,.6)'); g.addColorStop(1, 'rgba(255,240,150,0)'); x.fillStyle = g; x.fillRect(lx - 16, ly - 16, 32, 32); }
  });
  // Stopp-Knöpfe leuchten, solange die Walze läuft
  BTN.forEach(([bx, by], i) => { if (ui.reels[i].spinning && !ui.reels[i].ease) { x.strokeStyle = `rgba(255,255,255,${0.5 + Math.sin(ui.t * 8) * 0.4})`; x.lineWidth = 2; x.beginPath(); x.arc(bx, by, 9, 0, 7); x.stroke(); } });
  // Anzeigen: CREDIT = deine Münzen, PAYOUT = Einsatz; Seitentafeln: Einsatz & Freispiele
  x.font = "9px 'Ziffern', monospace"; x.textAlign = 'right'; x.fillStyle = '#7dff6a';
  x.fillText(String(app.state.coins % 100000), 116, 186);
  x.fillText(freeSpins() ? 'FREI' : String(SL().bets[ui.bet]), 186, 186);
  x.textAlign = 'center'; x.fillStyle = '#5a2a08'; x.font = "7px 'Ziffern', monospace";
  x.fillText('EINSATZ', 23, 169); x.fillText('FREISPIEL', 237, 169);
  x.font = "11px 'Ziffern', monospace"; x.fillStyle = '#fff';
  x.fillText(String(SL().bets[ui.bet]), 23, 182); x.fillText(String(freeSpins()), 237, 182);
  // Sterne-Wolken
  for (const p of ui.puffs) {
    p.t += dt; const k = p.t / 0.7, r = k < 0.35 ? RECT.cloudS : RECT.cloudL;
    x.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.5) * 2); B(r, p.x - r[2] / 2, p.y - r[3] / 2 - k * 10); x.globalAlpha = 1;
  }
  ui.puffs = ui.puffs.filter((p) => p.t < 0.7);
  // Piepi neben dem Automaten, Pikachu-Schweif guckt rechts hervor
  const pf = pippiFrame(), fr = RECT.pippi[pf];
  B(fr, 8, 194 + 58 - fr[3] * 0.9, 0.9);
  B(RECT.tail, 258 - 64 * 0.8, 194 + 58 - 56 * 0.8, 0.8);
  // Gewinn-Text und große Ziffern
  if (ui.msg) {
    x.textAlign = 'center'; x.font = "700 16px 'Ziffern', sans-serif"; x.lineWidth = 4; x.strokeStyle = '#3a1a08';
    x.strokeText(ui.msg, 150, 194 + 30); x.fillStyle = ui.result?.outcome ? '#ffe066' : '#d8d0e0'; x.fillText(ui.msg, 150, 194 + 30);
  }
  if (ui.digits) {
    ui.digits.t += dt;
    const s = ui.digits.text, k = Math.min(1, ui.digits.t * 4), z = 0.7 + k * 0.5;
    let dx = 130 - (s.length * 16 * z) / 2;
    for (const ch of s) {
      if (ch === '+') { x.fillStyle = '#e83050'; x.fillRect(dx + 3 * z, 34 + 40, 10 * z, 3 * z); x.fillRect(dx + 6.5 * z, 34 + 36.5, 3 * z, 10 * z); dx += 16 * z; continue; }
      B(RECT.digit(+ch), dx, 34 + 30 - (1 - k) * 20, z); dx += 16 * z;
    }
    if (ui.digits.t > 2.5) ui.digits = null;
  }
  x.restore();
}
function pippiFrame() {
  const t = ui.pippiT;
  switch (ui.pippi) {
    case 'spin': return 2;
    case 'reach': return 6;
    case 'win': return [4, 5, 2, 3][Math.floor(t * 6) % 4]; // jubeln, Lichtschein im Wechsel
    case 'lose': return 8;
    default: return Math.floor(t / 0.12) % 40 === 0 ? 1 : 0; // ab und zu Licht-Flackern
  }
}

// ================= Steine =================
function stoneWon(stone) {
  const targets = stoneTargets(app.state, stone);
  modal((m, close) => {
    m.append(h('h3', `💎 ${stoneName(stone)}!`),
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
        h('div.rk-tabs.wrap', stones.map(([k, n]) => h('button.btn.small' + (k === sel ? '.primary' : ''), { onclick: () => render(k) }, `${stoneName(k)} ×${n}`))),
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
