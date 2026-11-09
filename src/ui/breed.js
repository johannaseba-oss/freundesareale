// Zucht: Stall mit Boxen (je ein Paar), darunter der Brutkasten mit Countdown; geschlüpfte Pokémon behalten oder wegschicken.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import * as BR from '../game/breed.js';
import * as A from '../game/actions.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { eggCanvas } from './areaScene.js';
import { h, toast, modal, confirmDialog } from './dom.js';
import { haptic } from '../haptics.js';
import { sfx } from '../audio.js';
import { now, fmtDuration } from '../time.js';

const C = () => CFG.breed;
const base = import.meta.env.BASE_URL;
const name = (p) => p.nick || species(p.dex).name;
const sym = (p) => (p.gender === 'm' ? '♂' : '♀');
let ui = null, setupEl = null, setupBack = null;

export function renderBreedSetup(el, back) {
  setupEl = el; setupBack = back;
  stop();
  app.act((s, t) => { BR.tick(s, t); return { ok: true }; });
  const s = app.state, eggs = s.breed?.eggs || [], canvas = h('canvas.rc-stall');
  const eggList = h('div.br-eggs', eggs.length ? eggs.slice().sort((a, b) => a.hatchAt - b.hatchAt).map((e) => h('div.br-egg', eggIcon(), h('small', fmtDuration(Math.max(0, e.hatchAt - now()))))) : h('p.note', 'Noch keine Eier.'));
  el.replaceChildren(h('div.bs.rc-main',
    h('div.rc-top', h('button.btn.small', { onclick: back }, '‹'), h('b', 'Zucht')),
    h('div.rc-stall-wrap', canvas),
    h('h3.br-head', `Brutkasten ${eggs.length}/${C().incubator}`),
    eggList));
  start(canvas);
  if (BR.newHatches(s).length) showHatches();
  // Countdown laufen lassen
  ui.timer = setInterval(() => {
    if (!el.isConnected) return stop();
    const hatched = app.act((st, t) => ({ ok: true, list: BR.tick(st, t) })).list || [];
    if (hatched.length) { renderBreedSetup(el, back); return; }
    const items = eggList.querySelectorAll('.br-egg small'), sorted = (app.state.breed?.eggs || []).slice().sort((a, b) => a.hatchAt - b.hatchAt);
    items.forEach((it, i) => { if (sorted[i]) it.textContent = fmtDuration(Math.max(0, sorted[i].hatchAt - now())); });
  }, 1000);
}
function eggIcon() { const c = eggCanvas(), out = h('canvas', { width: 26, height: 32 }); const x = out.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, 26, 32); return out; }
function stop() { if (ui) { cancelAnimationFrame(ui.raf); clearInterval(ui.timer); } ui = null; }
const refresh = () => { if (setupEl?.isConnected) renderBreedSetup(setupEl, setupBack); };

// Stall: in jeder Box laufen die beiden Partner herum; leere Boxen zeigen ein Plus
function start(canvas) {
  const S = C(), bg = new Image(); bg.src = base + S.image;
  const top = Math.min(...S.boxes.map((b) => b[1])) - 160, bottom = Math.max(...S.boxes.map((b) => b[3])) + 120;
  const actors = S.boxes.flatMap((b, i) => BR.boxMons(app.state, i).map((p, k) => ({ p, b, i, x: b[0] + (k + 1) * (b[2] - b[0]) / 3, y: (b[1] + b[3]) / 2, tx: null, ty: null, wait: Math.random() * 2, dir: 0, t: 0, spr: loadSprites(p.dex, p.gender, p.shiny) })));
  ui = { raf: 0, last: performance.now(), timer: 0 };
  canvas.onclick = (e) => {
    const r = canvas.getBoundingClientRect(), k = r.width / S.imageW, x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k + top;
    const bi = S.boxes.findIndex((b) => x >= b[0] - 25 && x <= b[2] + 25 && y >= b[1] - 80 && y <= b[3] + 25);
    if (bi < 0) return;
    if (BR.boxMons(app.state, bi).length) openBox(bi); else pickPair(bi);
  };
  const loop = (ms) => {
    if (!ui || !canvas.isConnected) return;
    const dt = Math.min(0.05, (ms - ui.last) / 1000); ui.last = ms;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.parentElement.clientWidth || 300, k = w / S.imageW, hh = (bottom - top) * k;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); canvas.style.width = w + 'px'; canvas.style.height = hh + 'px'; }
    const c = canvas.getContext('2d');
    c.setTransform(dpr * k, 0, 0, dpr * k, 0, -top * dpr * k); c.imageSmoothingEnabled = false;
    if (bg.complete && bg.naturalWidth) c.drawImage(bg, 0, 0); else { c.fillStyle = '#62c09a'; c.fillRect(0, top, S.imageW, bottom - top); }
    c.font = 'bold 90px sans-serif'; c.textAlign = 'center'; c.fillStyle = 'rgba(110,70,20,.55)';
    S.boxes.forEach((b, i) => { if (!actors.some((a) => a.i === i)) c.fillText('+', (b[0] + b[2]) / 2, (b[1] + b[3]) / 2 + 22); });
    for (const a of actors.sort((u, v) => u.y - v.y)) {
      a.t += dt * 1000;
      if (a.tx == null) { a.wait -= dt; if (a.wait <= 0) { a.tx = a.b[0] + 20 + Math.random() * (a.b[2] - a.b[0] - 40); a.ty = a.b[1] + 25 + Math.random() * (a.b[3] - a.b[1] - 40); } }
      else {
        const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy), sp = 34 * dt;
        if (d < sp) { a.x = a.tx; a.y = a.ty; a.tx = null; a.wait = 1.5 + Math.random() * 3; }
        else { a.x += (dx / d) * sp; a.y += (dy / d) * sp; a.dir = dirOf(dx, dy); }
      }
      if (!a.spr.ready) continue;
      const f = frameOf(a.spr, a.tx == null ? 'Idle' : 'Walk', a.dir, a.t), sc = S.spriteScale;
      const x = Math.max(a.b[0] + (f.fw * sc) / 2 - 10, Math.min(a.b[2] - (f.fw * sc) / 2 + 10, a.x));
      c.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(x - (f.fw * sc) / 2), Math.round(a.y - (f.fh * sc) * 0.7), f.fw * sc, f.fh * sc);
    }
    // Schild: wann das nächste Ei kommt
    c.font = 'bold 26px sans-serif'; c.lineWidth = 6; c.strokeStyle = 'rgba(60,35,10,.85)'; c.fillStyle = '#fff6dc';
    S.boxes.forEach((b, i) => {
      const box = app.state.breed?.boxes?.[i];
      if (!box || BR.boxMons(app.state, i).length !== 2) return;
      const full = (app.state.breed.eggs || []).length >= S.incubator, label = full ? 'Brutkasten voll' : `🥚 ${fmtDuration(Math.max(0, box.nextEggAt - now()))}`;
      c.strokeText(label, (b[0] + b[2]) / 2, b[3] + 52); c.fillText(label, (b[0] + b[2]) / 2, b[3] + 52);
    });
    c.textAlign = 'left';
    ui.raf = requestAnimationFrame(loop);
  };
  ui.raf = requestAnimationFrame(loop);
}
const dirOf = (dx, dy) => ({ 0: 2, 1: 1, 2: 0, 3: 7, 4: 6, '-4': 6, '-3': 5, '-2': 4, '-1': 3 })[Math.round(Math.atan2(dy, dx) / (Math.PI / 4))];

// Paar wählen: erst ein Männchen, dann ein Weibchen
function pickPair(i) {
  const list = (g) => app.state.pokemon.filter((p) => BR.canBreed(p) && p.gender === g).sort((a, b) => !!b.fav - !!a.fav || a.dex - b.dex);
  let m = null;
  modal((md, close) => {
    const render = () => {
      const g = m ? 'w' : 'm', mons = list(g);
      md.replaceChildren(h('h3', m ? `Weibchen für ${name(m)} ♂` : 'Männchen wählen'),
        mons.length ? h('div.bs-list', mons.map((p) => h('button.bs-row', { onclick: () => {
          if (!m) { m = p; render(); return; }
          const r = app.act((s, t) => BR.setPair(s, i, m, p, t), true);
          if (r.ok === false) return;
          haptic('medium'); close(); toast(`${name(m)} und ${name(p)} ziehen in die Box.`); refresh();
        } }, h('img.rk-por', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }), h('div.bs-row-text', h('b', `${name(p)} ${sym(p)}`, p.shiny ? ' ✨' : ''), h('small', `Lv. ${p.level}${p.area ? ' · zieht aus dem Areal aus' : ''}`)))))
          : h('p.note', m ? 'Du hast kein freies Weibchen.' : 'Du hast kein freies Männchen.'),
        h('div.row', m ? h('button.btn', { onclick: () => { m = null; render(); } }, 'Zurück') : '', h('button.btn', { onclick: close }, 'Schließen')));
    };
    render();
  });
}
function openBox(i) {
  const pair = BR.boxMons(app.state, i);
  modal((md, close) => md.append(h('h3', `Box ${i + 1}`),
    h('div.bs-list', pair.map((p) => h('div.bs-row', h('img.rk-por', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }), h('div.bs-row-text', h('b', `${name(p)} ${sym(p)}`), h('small', species(p.dex).name))))),
    h('div.row', h('button.btn', { onclick: async () => { if (!(await confirmDialog('Das Paar trennen? Beide kommen zurück in den Beutel.', 'Trennen'))) return; app.act((s) => BR.clearBox(s, i), true); close(); refresh(); } }, 'Paar trennen'), h('button.btn', { onclick: close }, 'Schließen'))));
}

// Schlupf-Fenster: alle neu geschlüpften Pokémon; ausgewählte wegschicken, den Rest behalten
function showHatches() {
  const sel = new Set();
  modal((md, close) => {
    const render = () => {
      const list = BR.newHatches(app.state);
      if (!list.length) { close(); refresh(); return; }
      md.replaceChildren(h('h3', `Geschlüpft: ${list.length}`),
        h('div.br-hatch', list.map((p) => h('button.br-mon' + (sel.has(p.uid) ? '.on' : ''), { onclick: () => { if (sel.has(p.uid)) sel.delete(p.uid); else sel.add(p.uid); haptic('tick'); render(); } },
          h('img', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }), h('small', `${species(p.dex).name} ${p.gender ? sym(p) : ''}${p.shiny ? ' ✨' : ''}`)))),
        h('div.row', h('button.btn.small', { onclick: () => { if (sel.size === list.length) sel.clear(); else list.forEach((p) => sel.add(p.uid)); render(); } }, sel.size === list.length ? 'Keine auswählen' : 'Alle auswählen')),
        h('div.row',
          h('button.btn', { disabled: !sel.size, onclick: () => {
            const r = app.act((s) => A.releasePokemon(s, [...sel]), true);
            if (r.ok === false) return;
            sfx.coin(); toast(`${r.count} weggeschickt – +${r.coins} Münzen und Bonbons!`); sel.clear(); render();
          } }, `Wegschicken (${sel.size})`),
          h('button.btn.primary', { onclick: () => { app.act((s) => BR.keepHatches(s, list.filter((p) => !sel.has(p.uid)).map((p) => p.uid)), true); sel.clear(); render(); } }, sel.size ? 'Rest behalten' : 'Alle behalten')));
    };
    render();
  });
}
