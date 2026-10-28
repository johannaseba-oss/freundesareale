// Rennmodus-Oberfläche: Stall (jedes Pokémon in seiner Box), Profil mit Pflege, Sprungtraining (Jump & Run)
// und die Wiederholung des täglichen Rennens (Kamera folgt dem eigenen Pokémon).
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import * as RC from '../game/race.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { $, h, toast, modal, confirmDialog } from './dom.js';
import { trainerHead } from './chaosboard.js';
import { sfx, setMusic } from '../audio.js';
import { haptic } from '../haptics.js';
import { now, fmtDuration } from '../time.js';

const R = () => CFG.race;
const base = import.meta.env.BASE_URL;
const name = (p) => p.nick || species(p.dex).name;
const img = (src) => { const i = new Image(); i.src = base + src; return i; };
let setupEl = null, setupBack = null, stallUi = null, play = null;

// Werte als Sterne: gefüllt = erreicht, leer = noch möglich, schwarz = über dem Potenzial (geht nicht weiter)
function starRows(r, small = false, p = null) {
  const S = R().stats, t = now();
  return h('div.rc-stars' + (small ? '.small' : ''), RC.STATS.map((k) => {
    const n = RC.starsOf(r, k), g = p ? RC.growthState(p, k, t) : 'ok';
    return h('div.rc-star-row', h('span.k', S.icons[k], small ? '' : ' ' + S.names[k]),
      h('span.rc-st', [...Array(n.on)].map(() => h('i.on', '★')), [...Array(n.open)].map(() => h('i.open', '★')), [...Array(n.black)].map(() => h('i.black', '★'))),
      !small && g !== 'ok' ? h('small.rc-cap', g === 'max' ? 'ausgereizt' : 'heute genug') : null);
  }));
}
const record = (r) => `${r.races} Rennen · ${r.wins} ${r.wins === 1 ? 'Sieg' : 'Siege'}`;

// ================= Übersicht =================
export function renderRaceSetup(el, back) {
  setupEl = el; setupBack = back;
  stopStall();
  const s = app.state, t = now(), clock = RC.raceClock(t), mons = RC.stallMons(s), entry = RC.myEntry(s, t), pending = RC.pendingRaces(s, t);
  const entered = entry && s.pokemon.find((p) => p.uid === entry.uid);
  const badges = [...R().rewards.places, ...R().rewards.milestones].filter((b) => s.race?.badges?.[b.id]);
  const canvas = h('canvas.rc-stall');
  el.replaceChildren(h('div.bs.rc-main',
    h('div.rc-top', h('button.btn.small', { onclick: back }, '‹'), h('b', '🏇 Rennen'),
      h('span.rc-chip' + (entered ? '.ok' : '.todo'), entered ? `🏁 ${name(entered)}` : '🏁 Anmeldung offen', h('small', ` · ⏱ ${fmtDuration(clock.msToStart)}`)),
      h('button.btn.small', { onclick: showHelp }, '?')),
    pending.length ? h('button.btn.primary.big.rc-watch', { onclick: () => watchRace(pending[0]) }, `🏁 Rennen vom ${RC.fmtDay(pending[0])} ansehen`) : null,
    h('div.rc-stall-wrap', canvas),
    badges.length ? h('div.rc-badges', badges.map((b) => h('span.rc-badge', { title: b.name }, b.icon, s.race.badges[b.id] > 1 ? h('small', '×' + s.race.badges[b.id]) : null))) : null));
  startStall(canvas, mons, entry);
}

// Stall-Szene: Hintergrundbild (Ausschnitt um die Boxen), jedes Pokémon läuft nur in seiner Box herum
function showHelp() {
  modal((m, close) => m.append(h('h3', '🏇 Rennen'),
    h('p', `Jeden Tag um ${R().race.hour} Uhr läuft ein Hürdenrennen auf ${R().race.lanes} Bahnen. Melde vorher ein Pokémon aus deinem Stall an – freie Bahnen füllt der Computer auf. Gute Werte verbessern die Chancen, sicher ist nichts.`),
    h('p', 'Tippe auf eine leere Box, um ein Pokémon einziehen zu lassen, oder auf ein Pokémon für sein Profil. Jedes Pokémon hat eigene Werte: ★ gefüllt = erreicht, hell = noch möglich, schwarz = da geht nichts mehr. Pro Tag kann jeder Wert nur ein Stück wachsen.'),
    h('div.row', h('button.btn', { onclick: close }, 'OK'))));
}
function startStall(canvas, mons, entry = null) {
  const S = R().stall, bg = img(S.image);
  const top = Math.min(...S.boxes.map((b) => b[1])) - 160, bottom = Math.max(...S.boxes.map((b) => b[3])) + 120;
  const actors = mons.map((p) => { const b = S.boxes[p.box ?? 0] || S.boxes[0]; return { p, b, x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, tx: null, ty: null, wait: Math.random() * 2, dir: 0, t: 0, spr: loadSprites(p.dex, p.gender, p.shiny) }; });
  stallUi = { canvas, raf: 0, last: performance.now() };
  canvas.onclick = (e) => {
    const r = canvas.getBoundingClientRect(), k = r.width / S.imageW;
    const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k + top;
    const bi = S.boxes.findIndex((b) => x >= b[0] - 25 && x <= b[2] + 25 && y >= b[1] - 80 && y <= b[3] + 25);
    if (bi < 0) return;
    const hit = actors.find((a) => a.b === S.boxes[bi]);
    if (hit) openProfile(hit.p); else addToStall();
  };
  const loop = (now2) => {
    if (!stallUi || !canvas.isConnected) { stallUi = null; return; }
    const dt = Math.min(0.05, (now2 - stallUi.last) / 1000); stallUi.last = now2;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.parentElement.clientWidth || 300, k = w / S.imageW, hh = (bottom - top) * k;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); canvas.style.width = w + 'px'; canvas.style.height = hh + 'px'; }
    const c = canvas.getContext('2d');
    c.setTransform(dpr * k, 0, 0, dpr * k, 0, -top * dpr * k); c.imageSmoothingEnabled = false;
    if (bg.complete && bg.naturalWidth) c.drawImage(bg, 0, 0); else { c.fillStyle = '#62c09a'; c.fillRect(0, top, S.imageW, bottom - top); }
    // leere Boxen: dezentes Plus
    c.font = 'bold 90px sans-serif'; c.textAlign = 'center'; c.fillStyle = 'rgba(110,70,20,.55)';
    S.boxes.forEach((b) => { if (!actors.some((a) => a.b === b)) c.fillText('+', (b[0] + b[2]) / 2, (b[1] + b[3]) / 2 + 22); });
    for (const a of actors.sort((u, v) => u.y - v.y)) {
      a.t += dt * 1000;
      if (a.tx == null) { a.wait -= dt; if (a.wait <= 0) { a.tx = a.b[0] + 20 + Math.random() * (a.b[2] - a.b[0] - 40); a.ty = a.b[1] + 25 + Math.random() * (a.b[3] - a.b[1] - 40); } }
      else {
        const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy), sp = 38 * dt;
        if (d < sp) { a.x = a.tx; a.y = a.ty; a.tx = null; a.wait = 1.5 + Math.random() * 3; }
        else { a.x += (dx / d) * sp; a.y += (dy / d) * sp; a.dir = dirOf(dx, dy); }
      }
      if (!a.spr.ready) continue;
      const f = frameOf(a.spr, a.tx == null ? 'Idle' : 'Walk', a.dir, a.t), sc = S.spriteScale;
      // Wände als Grenze: Figur bleibt innerhalb der Box
      const x = Math.max(a.b[0] + (f.fw * sc) / 2 - 10, Math.min(a.b[2] - (f.fw * sc) / 2 + 10, a.x));
      c.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(x - (f.fw * sc) / 2), Math.round(a.y - (f.fh * sc) * 0.7), f.fw * sc, f.fh * sc);
    }
    // Namensschild unten in jeder Box (🏁 = fürs nächste Rennen angemeldet)
    c.font = 'bold 26px sans-serif'; c.textAlign = 'center'; c.lineWidth = 6; c.strokeStyle = 'rgba(60,35,10,.85)'; c.fillStyle = '#fff6dc';
    for (const a of actors) { const label = (entry?.uid === a.p.uid ? '🏁 ' : '') + name(a.p), lx = (a.b[0] + a.b[2]) / 2, ly = a.b[3] + 52; c.strokeText(label, lx, ly); c.fillText(label, lx, ly); }
    c.textAlign = 'left';
    stallUi.raf = requestAnimationFrame(loop);
  };
  stallUi.raf = requestAnimationFrame(loop);
}
function stopStall() { if (stallUi) cancelAnimationFrame(stallUi.raf); stallUi = null; }
const dirOf = (dx, dy) => ({ 0: 2, 1: 1, 2: 0, 3: 7, 4: 6, '-4': 6, '-3': 5, '-2': 4, '-1': 3 })[Math.round(Math.atan2(dy, dx) / (Math.PI / 4))];
const refresh = () => { if (setupEl?.isConnected && !play) renderRaceSetup(setupEl, setupBack); };

function addToStall() {
  if (RC.stallMons(app.state).length >= RC.stallSize()) return toast('Der Stall ist voll – nimm erst ein Pokémon heraus.', true);
  const list = app.state.pokemon.filter((p) => !p.stall && RC.canRace(p.dex)).sort((a, b) => !!b.fav - !!a.fav || a.dex - b.dex || b.level - a.level);
  modal((m, close) => {
    m.append(h('h3', 'Pokémon in den Stall'),
      list.length ? h('div.bs-list', list.map((p) => h('button.bs-row', { onclick: () => {
        const r = app.act((s) => RC.toStall(s, p), true);
        if (r.ok === false) return;
        close(); haptic('medium'); toast(`${name(p)} zieht in den Stall.`); refresh();
      } }, h('img.rk-por', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }), h('div.bs-row-text', h('b', name(p)), h('small', `Lv. ${p.level}${p.area ? ' · zieht aus dem Areal aus' : ''}${p.race?.races ? ' · ' + record(p.race) : ''}`), starRows(RC.profileOf(p), true)))))
        : h('p.note', `Du hast kein passendes Pokémon. Erlaubt: ${RC.raceSpecies().map((d) => species(d).name).join(', ')}.`),
      h('div.row', h('button.btn', { onclick: close }, 'Schließen')));
  });
}

// ================= Profil =================
function openProfile(p) {
  modal((m, close) => {
    const render = () => {
      const s = app.state, t = now(), entry = RC.myEntry(s, t), clock = RC.raceClock(t), r = p.race, left = RC.trainLeft(p, t);
      const pl = r.places || [];
      m.replaceChildren(
        h('div.row.rc-prof-head', h('img.portrait', { src: portraitUrl(p.dex, 'Happy', p.shiny), alt: '' }), h('div', h('h3', name(p), p.shiny ? ' ✨' : ''), h('small', `${species(p.dex).name} · Box ${(p.box ?? 0) + 1}`))),
        starRows(r, false, p),
        h('div.rc-record', h('b', record(r)), h('small', ' · Plätze: ' + [1, 2, 3, 4, 5].map((k) => `${k}. ×${pl[k - 1] || 0}`).join(' '))),
        r.hist.length ? h('details.rc-hist', h('summary', 'Letzte Rennen'), h('div', r.hist.slice(0, 15).map((x) => h('div.rc-hist-row', h('span', RC.fmtDay(x.day)), h('b', `${x.place}. Platz`), h('small', `${x.time.toFixed(1)} s`))))) : '',
        h('h4', 'Pflege'),
        h('div.rc-care', R().care.actions.map((a) => { const n = RC.careLeft(p, a, t); return h('button.btn.small', { disabled: n <= 0, onclick: () => {
          const res = app.act((st) => RC.careAction(st, p, a.id, now()), true);
          if (res.ok === false) return; haptic('tick'); sfx.coin?.();
          const gl = Object.entries(res.gains); toast(gl.length ? `${a.icon} ${a.name}: ` + gl.map(([k, g]) => `${R().stats.names[k]} +${g}`).join(', ') : `${a.icon} ${a.name}: Heute wächst da nichts mehr.`); render();
        } }, `${a.icon} ${a.name}`, a.cost ? h('small', ` ${a.cost} Münzen`) : null, h('small', n > 0 ? ` (${n}×)` : ' ✓')); })),
        h('button.btn.primary', { disabled: left <= 0, onclick: () => { close(); startTraining(p); } }, `⤴ Sprungtraining (${Math.max(0, left)}× heute)`),
        entry?.uid === p.uid
          ? h('button.btn', { onclick: () => { app.act((st) => RC.withdrawRace(st, now()), true); toast('Abgemeldet.'); render(); refresh(); } }, `🏁 Angemeldet für ${clock.entryDay === clock.today ? 'heute' : 'morgen'} ${R().race.hour} Uhr – abmelden`)
          : h('button.btn.gold', { onclick: () => { const res = app.act((st) => RC.enterRace(st, p, now()), true); if (res.ok === false) return; haptic('medium'); toast(`${name(p)} startet ${res.day === clock.today ? 'heute' : 'morgen'} um ${R().race.hour} Uhr!`); render(); refresh(); } },
            entry ? `🏁 Stattdessen ${name(p)} anmelden` : `🏁 Fürs Rennen ${clock.entryDay === clock.today ? 'heute' : 'morgen'} ${R().race.hour} Uhr anmelden`),
        h('div.row', h('button.btn.small', { onclick: async () => {
          if (!(await confirmDialog(`${name(p)} aus dem Stall nehmen? Werte und Rennergebnisse bleiben gespeichert.`, 'Herausnehmen'))) return;
          app.act((st) => RC.fromStall(st, p), true); refresh();
        } }, 'Aus dem Stall nehmen'), h('button.btn.small', { onclick: () => { close(); refresh(); } }, 'Schließen')));
    };
    render();
  });
}

function fitCanvas(canvas, r, dpr) {
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
}
// ================= Sprungtraining (Jump & Run) =================
function startTraining(p) {
  stopStall();
  const T = R().training, P = RC.trainingSetup(p), rnd = Math.random;
  const n = T.obstacles[0] + Math.floor(rnd() * (T.obstacles[1] - T.obstacles[0] + 1));
  let x = 8; const obs = Array.from({ length: n }, () => { x += T.gap[0] + rnd() * (T.gap[1] - T.gap[0]); return { x, hgt: T.height[0] + rnd() * (T.height[1] - T.height[0]), hit: false, passed: false }; });
  const end = x + 8;
  RC.ensureProfile(p);
  const g = { pos: 0, y: 0, vy: 0, mult: 1, pend: null, cleared: 0, hits: 0, t: 0, done: false, msg: [] };
  const canvas = h('canvas.arena-canvas'), count = h('span.rk-score');
  const top = h('div.b-top', h('img.rk-top-por', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }),
    h('div.b-name', h('b', name(p)), h('small', `Sprungkraft ${Math.round(p.race.sprung)} · Wendigkeit ${Math.round(p.race.wendig)} · Tempo ${Math.round(p.race.tempo)}`)), count,
    h('button.b-btn', { onclick: () => finish(true), title: 'Aufgeben' }, '🏳'));
  const root = h('div.battle.rc-train', top, h('div.b-field', canvas, h('div.rc-tap', 'Tippen = Springen')));
  document.body.append(root); document.body.classList.add('in-battle'); setMusic('arena');
  const spr = loadSprites(p.dex, p.gender, p.shiny), track = img(R().track.image);
  play = { root };
  const jump = (e) => { e.preventDefault(); if (g.done || g.y > 0.001 || g.pend != null) return; g.pend = g.t + P.delay; }; // Wendigkeit = Reaktionszeit
  canvas.addEventListener('pointerdown', jump);
  let last = performance.now(), raf = 0;
  const loop = (ms) => {
    if (!play) return;
    const dt = Math.min(0.05, (ms - last) / 1000); last = ms;
    step(dt); draw();
    raf = requestAnimationFrame(loop);
  };
  function step(dt) {
    if (g.done) return;
    g.t += dt;
    if (g.pend != null && g.t >= g.pend) { g.pend = null; g.vy = Math.sqrt(2 * T.gravity * P.jump); haptic('tick'); } // Sprungkraft = Sprunghöhe
    if (g.y > 0 || g.vy > 0) { g.vy -= T.gravity * dt; g.y = Math.max(0, g.y + g.vy * dt); if (g.y === 0) g.vy = 0; }
    g.mult = Math.min(1, g.mult + P.recover * dt); // Geschwindigkeit = Wiederbeschleunigung
    const speed = (T.speed[0] + (T.speed[1] - T.speed[0]) * Math.min(1, g.pos / end)) * g.mult;
    g.pos += speed * dt;
    for (const o of obs) {
      if (o.passed) continue;
      if (Math.abs(o.x - g.pos) < 0.35 && !o.hit && g.y < o.hgt) { o.hit = true; g.hits++; g.mult = T.slow; haptic('medium'); g.msg.push({ t: g.t, txt: 'Autsch!' }); }
      if (g.pos > o.x + 0.4) { o.passed = true; if (!o.hit) { g.cleared++; sfx.coin?.(); } }
    }
    count.textContent = `${g.cleared}/${n}`;
    if (g.pos >= end) finish(false);
  }
  // Rennbahn von oben (Kachel aus race.json track), Pokémon läuft auf der mittleren Bahn nach rechts
  function draw() {
    const r = canvas.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    fitCanvas(canvas, r, dpr);
    const TR = R().track, c = canvas.getContext('2d'), W = r.width, H = r.height;
    const k = Math.min(H / TR.tileH, 1.6), oy = (H - TR.tileH * k) / 2, lh = TR.laneH * k, lane = Math.floor(R().race.lanes / 2);
    const ly = oy + (TR.laneTop + (lane + 0.5) * TR.laneH) * k, u = lh * 0.95, px = W * 0.3, cam = g.pos * u - px, tw = TR.tileW * k;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
    c.fillStyle = '#3c7a3a'; c.fillRect(0, 0, W, H);
    if (track.complete && track.naturalWidth) for (let i = Math.floor(cam / tw) - 1; i * tw - cam < W; i++) c.drawImage(track, Math.round(i * tw - cam), Math.round(oy), Math.ceil(tw) + 1, Math.round(TR.tileH * k));
    // Ziellinie über alle Bahnen
    const fx = (end - 2) * u - cam;
    if (fx > -20 && fx < W + 20) for (let y = 0; y < (TR.laneH * R().race.lanes) / 10; y++) for (let xx = 0; xx < 2; xx++) { c.fillStyle = (y + xx) % 2 ? '#fff' : '#222'; c.fillRect(fx + xx * 6 * k, oy + TR.laneTop * k + y * 10 * k, 6 * k, 10 * k); }
    // Hürden quer über die Bahn: Schatten am Boden, Stange je nach Höhe angehoben; umgestoßene liegen flach
    for (const o of obs) {
      const ox = o.x * u - cam; if (ox < -lh || ox > W + lh) continue;
      const y0 = ly - lh * 0.46, y1 = ly + lh * 0.46, lift = o.hit ? 0 : o.hgt * lh * 0.32;
      c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(ox - 3 * k, y0, 7 * k, y1 - y0);
      if (o.hit) { c.fillStyle = '#b9a08a'; c.save(); c.translate(ox + lh * 0.25, ly); c.rotate(0.5); c.fillRect(-3 * k, -lh * 0.46, 6 * k, lh * 0.92); c.restore(); continue; }
      c.fillStyle = '#8a8f98'; c.fillRect(ox - 2 * k, y0 - lift, 4 * k, lift + 3 * k); c.fillRect(ox - 2 * k, y1 - lift, 4 * k, lift + 3 * k);
      const seg = (y1 - y0) / 6;
      for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#e8453c' : '#f7f4ee'; c.fillRect(ox - 3.5 * k, y0 - lift + i * seg, 7 * k, seg + 0.5); }
    }
    // Pokémon: Schatten bleibt am Boden, Figur hebt beim Sprung ab (Größe aus der Laufanimation, damit sie nicht springt)
    if (spr.ready) {
      const walk = spr.anims.Walk || spr.anims.Idle, sc = ((lh * 1.2) / Math.max(walk.fh, 30)) * (1 + g.y * 0.06), lift = g.y * lh * 0.45;
      c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(px, ly + lh * 0.18, lh * (0.32 - g.y * 0.05), lh * 0.1, 0, 0, Math.PI * 2); c.fill();
      const fr = frameOf(spr, g.y > 0 && spr.anims.Hop ? 'Hop' : 'Walk', 2, g.t * 1000 * (0.6 + g.mult));
      c.drawImage(fr.img, fr.sx, fr.sy, fr.fw, fr.fh, Math.round(px - (fr.fw * sc) / 2), Math.round(ly + lh * 0.18 - fr.fh * sc * 0.62 - lift), fr.fw * sc, fr.fh * sc);
      if (g.mult < 0.7) { c.font = `${Math.round(lh * 0.4)}px sans-serif`; c.fillText('💫', px - lh * 0.2, ly - lh * 0.7 - lift); }
    }
    c.fillStyle = 'rgba(255,255,255,.9)'; c.font = `bold ${Math.round(Math.max(14, lh * 0.28))}px sans-serif`; c.textAlign = 'right';
    c.fillText(`${Math.round(Math.min(100, (100 * g.pos) / end))} %`, W - 12, 28); c.textAlign = 'left';
  }
  function finish(gaveUp) {
    if (g.done) return;
    g.done = true;
    const ratio = gaveUp ? g.cleared / n * 0.5 : g.cleared / n;
    const res = app.act((st) => RC.finishTraining(st, p, ratio, now()), true);
    const gains = res.ok === false ? {} : res.gains;
    root.append(h('div.b-result' + (gaveUp ? '' : '.won'),
      h('h2', gaveUp ? 'Abgebrochen' : `${g.cleared}/${n} Hürden`),
      h('p', gaveUp ? 'Das Training zählt nur halb.' : g.hits ? `${g.hits}× angestoßen.` : 'Kein einziger Fehler – fantastisch!'),
      h('p', Object.keys(gains).length ? Object.entries(gains).map(([k, v]) => `${R().stats.icons[k]} ${R().stats.names[k]} +${v}`).join(' · ') : 'Keine Verbesserung – heute ist genug trainiert oder das Potenzial ist ausgereizt.'),
      starRows(p.race, false, p),
      h('div.row', h('button.btn.primary', { onclick: close }, 'Fertig'))));
  }
  function close() { cancelAnimationFrame(raf); root.remove(); document.body.classList.remove('in-battle'); play = null; setMusic('menu'); refresh(); }
  raf = requestAnimationFrame(loop);
  if (import.meta.env.DEV) app.raceTrain = { g, obs, step, finish };
}

// ================= Rennen ansehen =================
async function watchRace(day) {
  const s = app.state, mine = s.race.entries[day];
  let list = null;
  try { list = await app.backend?.raceEntries?.(day); } catch { list = null; }
  if (!list || !list.some((e) => e.me)) list = [...(list || []), { key: 'ich', me: true, trainer: s.profile?.name || 'Ich', sprite: s.profile?.sprite || 1, entry: mine }];
  else list = list.map((e) => (e.me ? { ...e, entry: mine } : e)); // eigene Anmeldung immer aus dem lokalen Spielstand
  const runners = RC.buildField(day, list), res = RC.simulateRace(day, runners), bets = RC.betsFor(day, runners);
  stopStall();
  const T = R().track, tile = img(T.image), me = runners.findIndex((r) => r.me);
  const canvas = h('canvas.arena-canvas'), pos = h('span.rk-score');
  const top = h('div.b-top', h('img.rk-top-por', { src: portraitUrl(mine.dex, 'Normal', mine.shiny), alt: '' }),
    h('div.b-name', h('b', `Rennen vom ${RC.fmtDay(day)}`), h('small', `${mine.name} auf Bahn ${me + 1}`)), pos,
    h('button.b-btn', { onclick: () => { st.t = Math.max(st.t, maxT + 0.1); }, title: 'Zum Ergebnis' }, '⏭'));
  const betBox = h('div.rc-bets', h('b', 'Wetten'), bets.map((b) => h('div', `${b.trainer} setzt ${b.item ? b.stake : b.stake + ' Münzen'} auf ${runners[b.on].name}`)));
  const root = h('div.battle.rc-race', top, h('div.b-field', canvas, betBox));
  document.body.append(root); document.body.classList.add('in-battle'); setMusic('arena');
  const sprites = runners.map((r) => loadSprites(r.dex, r.gender, r.shiny));
  const maxT = (Math.max(...res.tracks.map((tr) => tr.length)) - 1) * res.step;
  const st = { t: -3, done: false }; // 3 s Countdown
  play = { root };
  const xAt = (i, t) => { const tr = res.tracks[i], k = Math.max(0, t) / res.step, a = Math.floor(k); return a >= tr.length - 1 ? tr[tr.length - 1] : tr[a] + (tr[a + 1] - tr[a]) * (k - a); };
  let last = performance.now(), raf = 0, cam = 0;
  const loop = (ms) => {
    if (!play) return;
    const dt = Math.min(0.05, (ms - last) / 1000); last = ms;
    st.t += dt;
    if (st.t > -0.5) betBox.classList.add('fade');
    draw();
    if (st.t > maxT + 0.6 && !st.done) { st.done = true; showResult(); }
    raf = requestAnimationFrame(loop);
  };
  function draw() {
    const r = canvas.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    fitCanvas(canvas, r, dpr);
    const c = canvas.getContext('2d'), W = r.width, H = r.height, k = Math.min(H / T.tileH, 1.2), oy = (H - T.tileH * k) / 2, unit = 34 * k;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
    c.fillStyle = '#3c7a3a'; c.fillRect(0, 0, W, H);
    const t = Math.max(0, Math.min(st.t, maxT)), myX = xAt(me, t);
    const want = myX * unit - W * 0.4; cam += (want - cam) * 0.15; if (st.t < 0) cam = want;
    const tw = T.tileW * k;
    if (tile.complete && tile.naturalWidth) for (let i = Math.floor(cam / tw) - 1; i * tw - cam < W; i++) c.drawImage(tile, Math.round(i * tw - cam), Math.round(oy), Math.ceil(tw) + 1, Math.round(T.tileH * k));
    const laneY = (i) => oy + (T.laneTop + (i + 0.5) * T.laneH) * k, lh = T.laneH * k;
    // Start- und Ziellinie
    for (const [lx, col] of [[0, '#fff'], [res.length, '#ff7a3c']]) {
      const sx = lx * unit - cam; if (sx < -20 || sx > W + 20) continue;
      for (let y = 0; y < (T.laneH * runners.length) / 10; y++) for (let xx = 0; xx < 2; xx++) { c.fillStyle = (y + xx) % 2 ? col : '#222'; c.fillRect(sx + xx * 6 * k, oy + T.laneTop * k + y * 10 * k, 6 * k, 10 * k); }
    }
    // Hürden je Bahn (umgestoßen, wenn das Pokémon dort hängen geblieben ist)
    runners.forEach((_, i) => res.hurdles.forEach((hx, j) => {
      const sx = hx * unit - cam; if (sx < -30 || sx > W + 30) return;
      const ev = res.events[i].find((e) => e.h === j), down = ev && !ev.ok && xAt(i, t) >= hx - 0.4;
      c.save(); c.translate(sx, laneY(i) + lh * 0.3); if (down) c.rotate(1.1);
      c.fillStyle = '#ddd'; c.fillRect(-2 * k, -lh * 0.45, 4 * k, lh * 0.45);
      c.fillStyle = '#fff'; c.fillRect(-4 * k, -lh * 0.5, 8 * k, lh * 0.12); c.fillStyle = '#e8453c'; c.fillRect(-4 * k, -lh * 0.38, 8 * k, lh * 0.08);
      c.restore();
    }));
    // Pokémon
    const order = runners.map((_, i) => i).sort((a, b) => (st.t > res.finish[a] && st.t > res.finish[b] ? res.finish[a] - res.finish[b] : xAt(b, t) - xAt(a, t)));
    runners.forEach((rn, i) => {
      const x = xAt(i, t), sx = x * unit - cam, e = sprites[i];
      if (sx < -80 || sx > W + 80 || !e.ready) return;
      let lift = 0, stumble = false;
      for (const ev of res.events[i]) { const hx = res.hurdles[ev.h], d = x - (hx - 1.1); if (ev.ok && d > 0 && d < 2.2) lift = Math.sin((Math.PI * d) / 2.2) * lh * 0.55; if (!ev.ok && x >= hx - 0.4 && x < hx + 2.5) stumble = true; }
      const moving = st.t > 0 && st.t < res.finish[i] + 0.3;
      const f = frameOf(e, moving ? 'Walk' : 'Idle', 2, Math.max(0, st.t) * 1400), sc = (lh * 1.15) / Math.max(f.fh, 30);
      c.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(sx - (f.fw * sc) / 2), Math.round(laneY(i) - f.fh * sc * 0.72 - lift), f.fw * sc, f.fh * sc);
      if (stumble) { c.font = `${Math.round(lh * 0.35)}px sans-serif`; c.fillText('💫', sx - lh * 0.2, laneY(i) - lh * 0.75); }
      if (rn.me) { c.fillStyle = '#ffe066'; c.beginPath(); c.moveTo(sx, laneY(i) - lh * 0.95 - lift); c.lineTo(sx - 7, laneY(i) - lh * 1.1 - lift); c.lineTo(sx + 7, laneY(i) - lh * 1.1 - lift); c.fill(); }
    });
    pos.textContent = st.t < 0 ? `Start in ${Math.ceil(-st.t)}` : `Platz ${order.indexOf(me) + 1}`;
    if (st.t < 0) { c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, W, H); c.fillStyle = '#fff'; c.font = `bold ${Math.round(H * 0.18)}px sans-serif`; c.textAlign = 'center'; c.fillText(String(Math.ceil(-st.t)), W / 2, H / 2 + H * 0.06); c.textAlign = 'left'; }
  }
  function showResult() {
    const r = app.act((s2) => RC.settleRace(s2, day, runners, res), true), place = res.place[me];
    if (place <= 3) { sfx.coin?.(); haptic('strong'); }
    root.append(h('div.b-result.rc-result' + (place === 1 ? '.won' : ''),
      h('h2', `${place}. Platz`),
      h('div.rc-res-list', res.order.map((i) => h('div.rc-res-row' + (i === me ? '.me' : ''), h('b', `${res.place[i]}.`), h('img', { src: portraitUrl(runners[i].dex, 'Normal', runners[i].shiny), alt: '' }),
        h('span', runners[i].name, h('small', ` · ${runners[i].trainer}${runners[i].cpu ? ' (CPU)' : ''}`)), h('small', `${res.finish[i].toFixed(1)} s`)))),
      h('div.rc-bets-res', bets.map((b) => h('div', res.place[b.on] === 1 ? `🎉 ${b.trainer} gewinnt die Wette (${b.item ? b.stake : b.stake + ' Münzen'})!` : `${b.trainer} verliert ${b.item ? b.stake : b.stake + ' Münzen'}.`))),
      r?.badges?.length ? h('div.rc-new-badges', r.badges.map((b) => h('span.rc-badge', b.icon, ' ', b.name))) : null,
      h('div.row', h('button.btn.primary', { onclick: close }, 'Fertig'))));
  }
  function close() { cancelAnimationFrame(raf); root.remove(); document.body.classList.remove('in-battle'); play = null; setMusic('menu'); refresh(); }
  raf = requestAnimationFrame(loop);
  if (import.meta.env.DEV) app.raceWatch = { st, res, runners, bets };
}
