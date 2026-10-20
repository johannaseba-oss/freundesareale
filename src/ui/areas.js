// Bildschirm "Areale": bildschirmfüllende Szene. Wischen wechselt das Areal, Antippen eines Pokémon
// sammelt seine Münzen ein und öffnet sein Porträt. Alles Weitere steckt im Areal-Menü (☰).
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import * as A from '../game/actions.js';
import { capacityOf, residents, genderSymbol } from '../game/state.js';
import { areaBonuses } from '../game/bonuses.js';
import { habitatFit } from '../game/habitat.js';
import { collectWithFx } from './collect.js';
import { portraitUrl } from '../gfx/sprites.js';
import { iconImg } from '../gfx/icons.js';
import { AreaScene } from './areaScene.js';
import { openSheet, emotionOf, closeSheet } from './sheet.js';
import { $, h, bar, toast, modal, confirmDialog } from './dom.js';

let idx = 0;
let scene;
let lastKey = '';
let menu = null; // offenes Areal-Menü {el, close}
let switching = false;

export function initAreas() {
  const wrap = $('#scene-wrap');
  scene = new AreaScene($('#scene'), wrap, {
    onTap: (p, pos) => {
      const r = collectWithFx([p], () => pos);
      if (r.ok) scene.react(p.uid, r.total ? 'coin' : 'heart');
      openSheet(p);
    },
    onDrag: (dx) => { if (!switching) wrap.style.transform = `translateX(${dx * 0.6}px)`; },
    onSwipeEnd: (dir) => switchArea(dir),
    onDragStart: (p) => showZones(p),
    onDragMove: (p, x, y) => highlightZone(x, y),
    onDragEnd: (p, x, y) => dropOn(p, x, y),
  });
  $('#area-menu-btn').onclick = openMenu;
  if (import.meta.env.DEV) app.scene = scene;
  app.views.add(() => render());
  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (!$('#scr-areas').classList.contains('hidden')) { scene.update(dt); scene.draw(); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.addEventListener('keydown', (e) => {
    if ($('#scr-areas').classList.contains('hidden') || !$('#sheet').classList.contains('hidden')) return;
    if (e.key === 'ArrowRight') switchArea(1);
    if (e.key === 'ArrowLeft') switchArea(-1);
  });
}

// dir 1 = nächstes Areal (nach links gewischt), -1 = vorheriges, 0 = zurückschnappen
async function switchArea(dir) {
  const wrap = $('#scene-wrap');
  const from = wrap.style.transform || 'translateX(0)';
  if (!dir || switching) {
    await wrap.animate([{ transform: from }, { transform: 'translateX(0)' }], { duration: 160, easing: 'ease-out' }).finished;
    wrap.style.transform = '';
    return;
  }
  switching = true;
  const W = wrap.clientWidth;
  await wrap.animate([{ transform: from, opacity: 1 }, { transform: `translateX(${-dir * W}px)`, opacity: 0.3 }], { duration: 180, easing: 'ease-in' }).finished;
  idx = (idx + dir + CFG.areas.length) % CFG.areas.length;
  render(true);
  await wrap.animate([{ transform: `translateX(${dir * W}px)`, opacity: 0.3 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 220, easing: 'ease-out' }).finished;
  wrap.style.transform = '';
  switching = false;
}

// ---- Drag & Drop: Pokémon in den Beutel oder ins Nachbar-Areal ziehen ----
function neighbor(dir) {
  const s = app.state;
  for (let k = 1; k < CFG.areas.length; k++) {
    const a = CFG.areas[(idx + dir * k + CFG.areas.length * k) % CFG.areas.length];
    if (s.areas[a.id].unlocked) return a.id === CFG.areas[idx].id ? null : a;
  }
  return null;
}
let zoneTargets = {};
function showZones(p) {
  closeSheet();
  zoneTargets = { prev: neighbor(-1), next: neighbor(1) };
  const z = $('#drop-zones');
  for (const [k, a] of Object.entries(zoneTargets)) {
    const el = z.querySelector(`[data-zone="${k}"]`);
    el.classList.toggle('hidden', !a);
    if (a) el.textContent = k === 'prev' ? `← ${a.name}` : `${a.name} →`;
  }
  z.classList.remove('hidden');
  $('#app').classList.add('dragging');
}
function zoneAt(x, y) {
  for (const el of document.querySelectorAll('#drop-zones .dz:not(.hidden)')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}
function highlightZone(x, y) {
  const hit = zoneAt(x, y);
  for (const el of document.querySelectorAll('#drop-zones .dz')) el.classList.toggle('hot', el === hit);
}
function dropOn(p, x, y) {
  const hit = zoneAt(x, y);
  $('#drop-zones').classList.add('hidden');
  $('#app').classList.remove('dragging');
  if (!hit) return false;
  const sp = species(p.dex);
  if (hit.dataset.zone === 'bag') {
    const r = app.act((s) => A.assign(s, p, null), true);
    if (r.ok) toast(`${sp.name} ist jetzt im Beutel.`);
    return r.ok;
  }
  const target = zoneTargets[hit.dataset.zone];
  const r = app.act((s) => A.assign(s, p, target.id), true);
  if (r.ok) toast(`${sp.name} zieht in ${target.name}.`);
  return r.ok;
}

export function showArea(areaId) {
  const i = CFG.areas.findIndex((a) => a.id === areaId);
  if (i >= 0) idx = i;
  render(true);
}

function render(force = false) {
  const s = app.state;
  if (!s) return;
  const area = CFG.areas[idx], st = s.areas[area.id];
  const res = residents(s, area.id), cap = capacityOf(s, area.id);
  scene.setArea(area, st.unlocked ? res : []);

  const key = [area.id, s.coins, st.unlocked, st.level, res.length].join('|');
  if (force || key !== lastKey) {
    lastKey = key;
    $('#area-name').textContent = area.name;
    $('#area-cap').textContent = st.unlocked ? `${res.length}/${cap}` : '🔒';
    $('#area-dots').replaceChildren(...CFG.areas.map((a, i) => h('i' + (i === idx ? '.on' : '') + (s.areas[a.id].unlocked ? '' : '.locked'))));
    const lock = $('#scene-lock');
    if (!st.unlocked) {
      lock.classList.remove('hidden');
      lock.replaceChildren(h('b', area.name), h('small', `Platz für ${area.capacity[0]}–${area.capacity[area.capacity.length - 1]} Pokémon`),
        h('button.btn.gold', { onclick: async () => {
          if (!(await confirmDialog(`${area.name} für ${area.unlockCost} Glücksmünzen freischalten?`, 'Freischalten'))) return;
          const r = app.act((s2) => A.unlockArea(s2, area.id), true);
          if (r.ok) toast(`${area.name} ist jetzt freigeschaltet!`);
        } }, 'Freischalten ', iconImg('coin', 2), area.unlockCost));
    } else lock.classList.add('hidden');
    $('#scene-empty').classList.toggle('hidden', !st.unlocked || res.length > 0);
  }
  if (menu) fillMenu(menu.el, menu.close);
}

function openMenu() {
  const close = modal((el, c) => { menu = { el, close: () => { menu = null; c(); } }; fillMenu(el, menu.close); });
  const m = $('#modal');
  const prev = m.onclick;
  m.onclick = (e) => { if (e.target === m) { menu = null; prev?.(e); } };
  return close;
}

let menuKey = '';
function fillMenu(el, close) {
  const s = app.state, area = CFG.areas[idx], st = s.areas[area.id];
  const res = residents(s, area.id), cap = capacityOf(s, area.id);
  const key = [area.id, s.coins, st.unlocked, st.level, ...res.map((p) => [p.uid, p.level, p.coinsReady, JSON.stringify(p.berriesReady), Math.round(p.fullness / 5), Math.round(p.satisfaction / 5), Math.round(p.affection / 5)].join(':'))].join('|');
  if (el.childElementCount && key === menuKey) return;
  menuKey = key;

  const head = h('div.row', h('h3', { style: { margin: 0, flex: 1 } }, area.name), h('button.btn.small', { onclick: close, style: { flex: 'none' } }, '✕'));
  if (!st.unlocked) { el.replaceChildren(head, h('p.effects', 'Noch nicht freigeschaltet.')); return; }
  const maxed = st.level >= area.capacity.length - 1;
  const ready = res.reduce((n, p) => n + p.coinsReady, 0);
  const readyBerries = res.reduce((n, p) => n + Object.values(p.berriesReady || {}).reduce((a, b) => a + b, 0), 0);
  const upgrade = h('button.btn', { disabled: maxed, onclick: async () => {
    const cost = area.upgradeCost[st.level];
    if (!(await confirmDialog(`${area.name} für ${cost} Glücksmünzen vergrößern? Danach haben ${area.capacity[st.level + 1]} Pokémon Platz.`, 'Vergrößern'))) { openMenu(); return; }
    const r = app.act((s2) => A.upgradeArea(s2, area.id), true);
    if (r.ok) toast(`${area.name} wurde vergrößert!`);
    openMenu();
  } }, maxed ? 'Voll ausgebaut' : ['Vergrößern ', iconImg('coin', 2), area.upgradeCost[st.level]]);
  const collect = h('button.btn.gold', { disabled: !ready && !readyBerries, onclick: () => {
    close();
    const r = collectWithFx(res, (p) => scene.screenPosOf(p.uid));
    if (r.ok) for (const p of res) scene.react(p.uid, 'coin');
  } }, iconImg('coin', 2), ready || readyBerries ? `${ready}${readyBerries ? ` + ${readyBerries} Beeren` : ''} einsammeln` : 'Nichts bereit');

  const list = h('div.residents', res.map((p) => {
    const sp = species(p.dex);
    return h('div.res.frame', { onclick: () => { close(); openSheet(p); } },
      h('img.portrait', { src: portraitUrl(p.dex, emotionOf(p)), alt: '' }),
      h('div.meta',
        h('div.name', h('span', sp.name, h('span.gender.' + p.gender, genderSymbol(p))), h('small', `Lv. ${p.level}`, p.coinsReady ? [' · ', iconImg('coin', 1), p.coinsReady] : '')),
        h('div.bars', bar('hunger', p.fullness), bar('sat', p.satisfaction), bar('aff', p.affection))));
  }));
  for (let i = res.length; i < cap; i++) list.append(h('div.empty-slot', { onclick: () => pickResident(area) }, '+ Pokémon einziehen lassen'));

  const { active } = areaBonuses(res);
  el.replaceChildren(...[head,
    h('p.effects', `Stufe ${st.level + 1} · ${res.length}/${cap} Bewohner`),
    h('p.effects', `Wohl fühlen sich hier: ${(area.likes || []).join(', ') || '–'}. Weniger gern: ${(area.dislikes || []).join(', ') || '–'}.`),
    h('div.row', collect, upgrade),
    active.length ? h('div', h('b', 'Aktive Boni'), h('div.bonus-list', active.map((b) => h('div.bonus' + (b.name.includes('legendär') ? '.legend' : ''), h('b', b.name), b.text)))) : null,
    h('b', 'Bewohner'), list,
    h('p.effects', 'Balken: Sättigung · Zufriedenheit · Zuneigung')].filter(Boolean));
}

const fitMark = (dex, areaId) => { const f = habitatFit(dex, areaId).fit; return f > 0 ? h('span.fit.good', '♥ passt') : f < 0 ? h('span.fit.bad', '✕ unwohl') : null; };

function pickResident(area) {
  const s = app.state;
  const free = s.pokemon.filter((p) => !p.area);
  closeSheet();
  modal((el, close) => {
    menu = null;
    el.append(h('h3', `Wer zieht in ${area.name} ein?`));
    if (!free.length) {
      el.append(h('p', 'In deiner Sammlung wartet gerade kein Pokémon. Neue Pokémon gibt es am Automaten.'), h('button.btn', { onclick: close }, 'OK'));
      return;
    }
    el.append(h('div.grid', free.map((p) => {
      const sp = species(p.dex);
      return h('div.card.r-' + sp.rarity, { onclick: () => {
        const r = app.act((s2) => A.assign(s2, p, area.id), true);
        if (r.ok) { close(); toast(`${sp.name} zieht ein!`); }
      } }, h('img.portrait', { src: portraitUrl(p.dex), alt: '' }), h('div.nm', sp.name, h('span.gender.' + p.gender, genderSymbol(p))), h('div.sub', `Lv. ${p.level}`), fitMark(p.dex, area.id));
    })));
    el.append(h('button.btn', { onclick: close }, 'Schließen'));
  });
}
