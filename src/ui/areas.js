// Bildschirm "Areale": bildschirmfüllende Szene. Wischen wechselt das Areal, Antippen eines Pokémon
// sammelt seine Münzen ein und öffnet sein Porträt. Alles Weitere steckt im Areal-Menü (☰).
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import * as A from '../game/actions.js';
import { capacityOf, residents, genderSymbol, nameOf } from '../game/state.js';
import { areaBonuses, areaMood } from '../game/bonuses.js';
import { fmtDuration, now } from '../time.js';
import { habitatFit } from '../game/habitat.js';
import { typeColor, typeChip, areaTypeChips } from '../game/types.js';
import { collectWithFx } from './collect.js';
import { portraitUrl } from '../gfx/sprites.js';
import { iconImg, berryUrl } from '../gfx/icons.js';
import { fly } from './fly.js';
import { AreaScene, preloadArea } from './areaScene.js';
import { openSheet, emotionOf, closeSheet } from './sheet.js';
import { $, h, bar, toast, modal, confirmDialog } from './dom.js';
import { haptic } from '../haptics.js';

let idx = 0;
let scene;
let lastKey = '';
let menu = null; // offenes Areal-Menü {el, close}
let switching = false;
let lastCollect = -1e9; // Zeitpunkt des letzten Einsammelns (Antipp-Sperre für die Einzelansicht)

export function initAreas() {
  const wrap = $('#scene-wrap');
  scene = new AreaScene($('#scene'), wrap, {
    // Antippen: hat das Pokémon Münzen/Beeren, werden nur diese eingesammelt – sonst öffnet sich die Einzelansicht
    onTap: (p, pos) => {
      const hasLoot = p.coinsReady > 0 || Object.values(p.berriesReady || {}).some((n) => n > 0);
      // kurz nach dem Einsammeln keine Einzelansicht öffnen, damit schnelles Sammeln nicht unterbrochen wird
      if (!hasLoot) { if (performance.now() - lastCollect > 500) openSheet(p); return; }
      lastCollect = performance.now();
      const r = collectWithFx([p], () => pos);
      if (r.ok) { scene.react(p.uid, r.total ? 'coin' : 'heart'); haptic('tick'); }
    },
    onDrag: (dx) => { if (!switching) wrap.style.transform = `translateX(${dx * 0.6}px)`; },
    onSwipeEnd: (dir) => switchArea(dir),
    onEgg: (egg, pos) => {
      if (now() < egg.hatchAt) { toast(`Das Ei schlüpft in ${fmtDuration(egg.hatchAt - now())}.`); return; }
      const r = app.act((s, t) => A.hatchEgg(s, egg.id, t), true);
      if (!r.ok) return;
      haptic('strong');
      toast(`Ein ${species(r.pokemon.dex).name} ist geschlüpft! Es wartet im Beutel.`);
      setTimeout(() => openSheet(r.pokemon), 400);
    },
    onBerry: (g, pos) => {
      const area = CFG.areas[idx];
      const r = app.act((s) => A.pickGroundBerry(s, area.id, g.id));
      if (r.ok) { haptic('tick'); fly('berry', pos, 1, '#hud-bag', berryUrl(r.berry)); }
    },
    onDragStart: (p) => { haptic('tick'); showZones(p); },
    onDragMove: (p, x, y) => highlightZone(x, y),
    onDragEnd: (p, x, y) => dropOn(p, x, y),
  });
  $('#area-menu-btn').onclick = openMenu;
  $('#area-prev').onclick = () => switchArea(-1);
  $('#area-next').onclick = () => switchArea(1);
  $('#shop-btn').onclick = openShop;
  document.querySelector('.area-title').onclick = openAreaList;
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

// Bildschirmposition eines Pokémon im gerade gezeigten Areal (null, wenn es dort nicht zu sehen ist)
export const scenePosOf = (uid) => scene?.screenPosOf(uid) || null;
export const sceneReact = (uid, kind) => scene?.react(uid, kind);
export const sceneFeed = (uid, berry) => scene?.feed(uid, berry);
export const sceneGroundPos = (id) => scene?.groundScreenPos(id) || null;

// Indizes der freigeschalteten Areale (nur durch diese wird gewischt)
const owned = () => CFG.areas.map((_, i) => i).filter((i) => app.state?.areas[CFG.areas[i].id]?.unlocked);

// dir 1 = nächstes Areal (nach links gewischt), -1 = vorheriges, 0 = zurückschnappen
async function switchArea(dir) {
  const wrap = $('#scene-wrap');
  const from = wrap.style.transform || 'translateX(0px)';
  const list = owned();
  const snapBack = async () => {
    const an = wrap.animate([{ transform: from }, { transform: 'translateX(0px)' }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
    await an.finished; wrap.style.transform = ''; an.cancel();
  };
  if (!dir || switching || list.length < 2) return snapBack();
  switching = true;
  const pos = list.indexOf(idx);
  const nextIdx = list[(pos + dir + list.length) % list.length];
  const W = wrap.clientWidth;
  const ready = preloadArea(CFG.areas[nextIdx]); // schon während des Hinausgleitens laden
  // fill: 'forwards' hält jede Endposition, damit nichts zwischen den Animationen zurückspringt
  const out = wrap.animate([{ transform: from, opacity: 1 }, { transform: `translateX(${-dir * W}px)`, opacity: 0.2 }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
  await Promise.all([out.finished, ready]);
  idx = nextIdx;
  render(true);
  haptic('tick');
  const inn = wrap.animate([{ transform: `translateX(${dir * W}px)`, opacity: 0.2 }, { transform: 'translateX(0px)', opacity: 1 }], { duration: 210, easing: 'ease-out', fill: 'forwards' });
  out.cancel();
  await inn.finished;
  wrap.style.transform = '';
  inn.cancel();
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
let lastHot = null;
function highlightZone(x, y) {
  const hit = zoneAt(x, y);
  if (hit && hit !== lastHot) haptic('tick');
  lastHot = hit;
  for (const el of document.querySelectorAll('#drop-zones .dz')) el.classList.toggle('hot', el === hit);
}
function dropOn(p, x, y) {
  const hit = zoneAt(x, y);
  $('#drop-zones').classList.add('hidden');
  $('#app').classList.remove('dragging');
  lastHot = null;
  haptic(hit ? 'medium' : 'tick');
  if (!hit) return false;
  const sp = species(p.dex);
  if (hit.dataset.zone === 'bag') {
    const r = app.act((s) => A.assign(s, p, null), true);
    if (r.ok) toast(`${sp.name} ist jetzt im Beutel.`);
    return r.ok;
  }
  const target = zoneTargets[hit.dataset.zone];
  const r = app.act((s) => A.assign(s, p, target.id), true);
  if (r.ok) toast(habitatFit(p.dex, target.id).fit < 0 ? `${sp.name} zieht in ${target.name} – fühlt sich dort aber unwohl und produziert keine Münzen.` : `${sp.name} zieht in ${target.name}.`);
  return r.ok;
}

// Übersicht aller eigenen Areale (klein, mit Bewohnern und Stimmung) – antippen springt direkt hin
function openAreaList() {
  const s = app.state;
  haptic('tick');
  modal((el, close) => {
    el.append(h('h3', 'Deine Areale'), h('div.area-list', owned().map((i) => {
      const a = CFG.areas[i], res = residents(s, a.id), am = areaMood(res);
      return h('button.area-pick' + (i === idx ? '.on' : ''), { onclick: () => { close(); if (i !== idx) { idx = i; render(true); haptic('tick'); } } },
        h('div.area-pick-img', { style: { backgroundImage: `url(${import.meta.env.BASE_URL}art/areale/${a.image})` } },
          h('div.area-pick-mons', res.slice(0, 6).map((p) => h('img', { src: portraitUrl(p.dex), alt: '' })))),
        h('b', a.name),
        h('small', `${res.length}/${capacityOf(s, a.id)}${am ? ` · ♥ ${Math.round(am.value)} %` : ''}`));
    })),
    owned().length < CFG.areas.length ? h('button.btn', { onclick: () => { close(); openShop(); } }, '🛒 Weitere Areale freischalten') : null,
    h('div.row', h('button.btn', { onclick: close }, 'Schließen')));
  });
}

export function showArea(areaId) {
  const i = CFG.areas.findIndex((a) => a.id === areaId);
  if (i >= 0) idx = i;
  render(true);
}

function render(force = false) {
  const s = app.state;
  if (!s) return;
  if (!s.areas[CFG.areas[idx].id]?.unlocked) idx = owned()[0] ?? 0;
  const area = CFG.areas[idx], st = s.areas[area.id];
  const res = residents(s, area.id), cap = capacityOf(s, area.id);
  scene.setArea(area, st.unlocked ? res : [], st.unlocked ? st.ground || [] : [], st.unlocked ? (s.eggs?.list || []).filter((e) => e.area === area.id) : []);
  const am = st.unlocked ? areaMood(res) : null;

  const ownedList = owned();
  const key = [area.id, s.coins, st.unlocked, st.level, res.length, ownedList.length, CFG.types ? 1 : 0, am ? Math.round(am.value) : '', am?.bonus].join('|');
  if (force || key !== lastKey) {
    lastKey = key;
    $('#area-name').textContent = area.name;
    // Arealstimmung: Durchschnitt der Bewohner, gute Stimmung = Münzbonus
    $('#area-cap').replaceChildren(st.unlocked ? `${res.length}/${cap}` : '🔒', ...(am ? [' · ', h('span.area-mood' + (am.bonus > 0 ? '.good' : ''), { title: 'Arealstimmung' }, `♥ ${Math.round(am.value)} %${am.bonus > 0 ? ` · +${Math.round(am.bonus * 100)} % Münzen` : ''}`)] : []));
    $('#area-types').replaceChildren(...areaTypeChips(area));
    $('#area-dots').replaceChildren(...(ownedList.length > 1 ? ownedList.map((i) => h('i' + (i === idx ? '.on' : ''))) : []));
    for (const id of ['#area-prev', '#area-next']) $(id).classList.toggle('hidden', ownedList.length < 2);
    $('#shop-btn').classList.toggle('hidden', ownedList.length === CFG.areas.length);
    for (const a of ownedList) preloadArea(CFG.areas[a]);
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

const fitMark = (dex, areaId) => { const f = habitatFit(dex, areaId).fit; return f > 0 ? h('span.fit.good', '♥ passt') : f < 0 ? h('span.fit.bad', '✕ keine Münzen') : null; };

function pickResident(area) {
  const s = app.state;
  const free = s.pokemon.filter((p) => !p.area);
  const others = s.pokemon.filter((p) => p.area && p.area !== area.id);
  closeSheet();
  modal((el, close) => {
    menu = null;
    el.append(h('h3', `Wer zieht in ${area.name} ein?`));
    if (!free.length && !others.length) {
      el.append(h('p', 'Du hast noch keine weiteren Pokémon. Neue Pokémon gibt es am Automaten.'), h('button.btn', { onclick: close }, 'OK'));
      return;
    }
    const card = (p) => {
      const sp = species(p.dex);
      return h('div.card.r-' + sp.rarity, { onclick: () => {
        const r = app.act((s2) => A.assign(s2, p, area.id), true);
        if (r.ok) { close(); toast(`${nameOf(p)} zieht in ${area.name} ein!`); }
      } }, h('img.portrait', { src: portraitUrl(p.dex), alt: '' }), h('div.nm', h('span.n', nameOf(p)), h('span.gender.' + p.gender, genderSymbol(p))),
      h('span.type-chips.mini', sp.types.map((t) => typeChip(t))),
      h('div.sub', p.area ? `aus ${CFG.areas.find((a) => a.id === p.area)?.name}` : `Lv. ${p.level} · Beutel`), fitMark(p.dex, area.id));
    };
    // Vorschläge zuerst: wer gut hierher passt (Typ gefällt dem Areal), die besten oben – Beutel vor anderen Arealen
    const fit = (p) => habitatFit(p.dex, area.id), good = [...free, ...others].filter((p) => fit(p).fit > 0)
      .sort((x, y) => fit(y).likes.length - fit(x).likes.length || !!x.area - !!y.area || y.level - x.level);
    const rest = (list) => list.filter((p) => !good.includes(p));
    if (good.length) el.append(h('b', '♥ Passt gut hierher'), h('div.grid', good.map(card)));
    if (rest(free).length) el.append(h('b', 'Im Beutel'), h('div.grid', rest(free).map(card)));
    if (rest(others).length) el.append(h('b', 'Aus anderen Arealen'), h('div.grid', rest(others).sort((a, b) => a.area.localeCompare(b.area)).map(card)));
    el.append(h('button.btn', { onclick: close }, 'Schließen'));
  });
}

// ---- Shop: noch nicht freigeschaltete Areale ----
function openShop() {
  closeSheet();
  modal((el, close) => {
    const fill = () => {
      const s = app.state;
      const locked = CFG.areas.filter((x) => !s.areas[x.id].unlocked).sort((x, y) => x.unlockCost - y.unlockCost);
      el.replaceChildren(
        h('div.row', h('h3', { style: { margin: 0, flex: 1 } }, 'Areal-Shop'), h('button.btn.small', { onclick: close, style: { flex: 'none' } }, '✕')),
        h('p.effects', 'Neue Freundesareale für deine Pokémon.'),
        locked.length ? h('div.shop-list', locked.map((x) => h('div.shop-item',
          h('div.shop-thumb', { style: { backgroundImage: `url(${import.meta.env.BASE_URL}art/areale/${x.image})` } }),
          h('div.shop-text',
            h('b', x.name),
            h('small', `Platz für ${x.capacity[0]}–${x.capacity[x.capacity.length - 1]} Pokémon`),
            h('div.type-chips.left', ...areaTypeChips(x)),
            (x.dislikes || []).length > 0 && !x.allTypes ? h('div.type-chips.left.dislike', h('small', 'ungeeignet: '), ...x.dislikes.map((t) => typeChip(t, 'muted'))) : null,
            h('button.btn.gold.small', { disabled: s.coins < x.unlockCost, onclick: () => {
              const r = app.act((s2) => A.unlockArea(s2, x.id), true);
              if (!r.ok) return;
              haptic('strong');
              close();
              toast(`${x.name} gehört jetzt dir!`);
              showArea(x.id);
            } }, 'Freischalten ', iconImg('coin', 2), x.unlockCost))))) : h('p', 'Du besitzt schon alle Areale!'));
    };
    fill();
  });
}
