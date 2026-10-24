// Bildschirm "Sammlung": alle eigenen Pokémon.
import { CFG, species, areaById } from '../config.js';
import { app } from '../app.js';
import { portraitUrl } from '../gfx/sprites.js';
import { genderSymbol, nameOf } from '../game/state.js';
import { ballCanvas, ballSprite } from '../gfx/balls.js';
import { openSheet, emotionOf } from './sheet.js';
import { $, h } from './dom.js';
import { openAchievements } from './profile.js';

let filter = 'alle';
let lastKey = '';

export function initCollection() { app.views.add(() => render()); }
export function setFilter(f) { filter = f; lastKey = ''; }

export function render(force = false) {
  const s = app.state;
  const root = $('#scr-collection');
  if (!s || root.classList.contains('hidden')) return;
  const filters = { alle: () => true, frei: (p) => !p.area, wohnt: (p) => !!p.area };
  const list = s.pokemon.filter(filters[filter]).sort((a, b) => !!b.fav - !!a.fav || b.level - a.level || a.dex - b.dex);
  const key = filter + list.map((p) => `${p.uid}:${p.level}:${p.area}:${emotionOf(p)}:${p.nick || ''}`).join();
  if (!force && key === lastKey) return;
  lastKey = key;
  const owned = new Set(s.pokemon.map((p) => p.dex)).size;
  const chip = (id, label) => h('button.chip' + (filter === id ? '.on' : ''), { onclick: () => { filter = id; render(true); } }, label);
  root.replaceChildren(
    h('div.coll-head', h('b', `${s.pokemon.length} Pokémon`), h('small.effects', ` · ${owned} von ${CFG.dex.length} Arten`)),
    h('div.coll-head', chip('alle', 'Alle'), chip('frei', 'Ohne Areal'), chip('wohnt', 'In Arealen'), h('button.chip', { onclick: openAchievements }, '🏆 Erfolge')),
    list.length ? h('div.grid', list.map((p) => {
      const sp = species(p.dex);
      const mark = ballCanvas(ballSprite(p.ball, null, p.dex), 1); mark.className = 'ballmark';
      return h('div.card.r-' + sp.rarity, { onclick: () => openSheet(p) },
        mark, h('img.portrait', { src: portraitUrl(p.dex, emotionOf(p)), alt: '', loading: 'lazy' }),
        h('div.nm', h('span.n', nameOf(p)), h('span.gender.' + p.gender, genderSymbol(p))), h('div.sub', `Lv. ${p.level} · ${p.area ? areaById(p.area).name : 'Sammlung'}`));
    })) : h('p.effects', { style: { padding: '0 12px' } }, s.pokemon.length ? 'Keine Pokémon in diesem Filter.' : 'Noch keine Pokémon. Besuche den Automaten!'));
}
