// Bildschirm "Sammlung": alle eigenen Pokémon.
import { CFG, species, areaById } from '../config.js';
import { app } from '../app.js';
import { portraitUrl } from '../gfx/sprites.js';
import { genderSymbol, nameOf } from '../game/state.js';
import { ballCanvas, ballSprite } from '../gfx/balls.js';
import { openSheet, emotionOf } from './sheet.js';
import { $, h, toast, confirmDialog } from './dom.js';
import * as A from '../game/actions.js';
import { sfx } from '../audio.js';
import { haptic } from '../haptics.js';
import { openAchievements } from './profile.js';

let filter = 'alle';
let release = null; // Wegschick-Modus: Set der ausgewählten uids
let lastKey = '';

export function initCollection() { app.views.add(() => render()); }
export function setFilter(f) { filter = f; lastKey = ''; }

export function render(force = false) {
  const s = app.state;
  const root = $('#scr-collection');
  if (!s || root.classList.contains('hidden')) return;
  const filters = { alle: () => true, frei: (p) => !p.area, wohnt: (p) => !!p.area };
  const list = s.pokemon.filter(release ? (p) => !p.area : filters[filter]).sort((a, b) => !!b.fav - !!a.fav || b.level - a.level || a.dex - b.dex);
  const key = filter + (release ? 'R' + [...release].join() : '') + list.map((p) => `${p.uid}:${p.level}:${p.area}:${emotionOf(p)}:${p.nick || ''}`).join();
  if (!force && key === lastKey) return;
  lastKey = key;
  const owned = new Set(s.pokemon.map((p) => p.dex)).size;
  const chip = (id, label) => h('button.chip' + (filter === id ? '.on' : ''), { onclick: () => { filter = id; render(true); } }, label);
  root.replaceChildren(
    h('div.coll-head', h('b', `${s.pokemon.length} Pokémon`), h('small.effects', ` · ${owned} von ${CFG.dex.length} Arten`)),
    release ? h('div.coll-head.rel-head', h('b', '📤 Wegschicken'), h('small.effects', ` · ${CFG.balance.release.coins} Münzen je Pokémon · ★ und Spitznamen gesperrt`))
      : h('div.coll-head', chip('alle', 'Alle'), chip('frei', 'Ohne Areal'), chip('wohnt', 'In Arealen'), h('button.chip', { onclick: openAchievements }, '🏆 Erfolge'), h('button.chip.rel-chip', { onclick: () => { release = new Set(); render(true); } }, '📤 Wegschicken')),
    list.length ? h('div.grid', list.map((p) => {
      const sp = species(p.dex);
      const mark = ballCanvas(ballSprite(p.ball, null, p.dex), 1); mark.className = 'ballmark';
      const locked = release && !A.canRelease(p), on = release?.has(p.uid);
      return h('div.card.r-' + sp.rarity + (release ? (locked ? '.rel-locked' : on ? '.rel-on' : '.rel-off') : ''), { 'data-uid': p.uid, onclick: () => {
        if (!release) return openSheet(p);
        if (locked) return toast(p.fav ? 'Favoriten kannst du nicht wegschicken.' : p.stall ? 'Pokémon im Stall kannst du nicht wegschicken.' : 'Pokémon mit Spitznamen kannst du nicht wegschicken.');
        if (on) release.delete(p.uid); else release.add(p.uid); haptic('tick'); render(true);
      } }, release ? h('span.rel-mark', locked ? (p.fav ? '★' : p.stall ? '🏇' : '✎') : on ? '✓' : '') : null,
        mark, h('img.portrait', { src: portraitUrl(p.dex, emotionOf(p), p.shiny), alt: '', loading: 'lazy' }),
        h('div.nm', p.shiny ? h('span.shiny-mark', { title: 'Schillernd' }, '✨') : null, h('span.n', nameOf(p)), h('span.gender.' + p.gender, genderSymbol(p))), h('div.sub', `Lv. ${p.level} · ${p.area ? areaById(p.area).name : p.stall ? 'Stall' : 'Sammlung'}`));
    })) : h('p.effects', { style: { padding: '0 12px' } }, s.pokemon.length ? 'Keine Pokémon in diesem Filter.' : 'Noch keine Pokémon. Besuche den Automaten!'),
    ...(release ? [releaseBar(list)] : []));
}

// Leiste im Wegschick-Modus: Alle auswählen, Abbrechen, Wegschicken
function releaseBar(list) {
  const n = release.size, coins = n * CFG.balance.release.coins, can = list.filter(A.canRelease);
  return h('div.rel-bar',
    h('button.btn.small', { onclick: () => { release = null; render(true); } }, 'Abbrechen'),
    h('button.btn.small', { onclick: () => { release = release.size === can.length ? new Set() : new Set(can.map((p) => p.uid)); render(true); } }, release.size === can.length && can.length ? 'Keine' : 'Alle'),
    h('button.btn.primary.rel-go', { disabled: !n, onclick: () => sendAway() }, n ? `${n} wegschicken · +${coins} Münzen` : 'Pokémon antippen'));
}
async function sendAway() {
  const n = release.size;
  if (!n || !(await confirmDialog(`${n} Pokémon wegschicken? Du bekommst ${n * CFG.balance.release.coins} Münzen. Das kann man nicht rückgängig machen.`, 'Wegschicken'))) return;
  // Positionen der Karten merken, bevor sie verschwinden
  const from = new Map([...document.querySelectorAll('#scr-collection .card[data-uid]')].map((el) => [+el.dataset.uid, el.getBoundingClientRect()]));
  const r = app.act((st) => A.releasePokemon(st, [...release]), true);
  if (r.ok === false) return;
  release = null;
  flyAway(r.gone, from);
  sfx.coin(); haptic('medium');
  toast(`${r.count} Pokémon sind in die Freiheit gezogen – +${r.coins} Münzen!`);
  render(true);
}
// für jedes weggeschickte Pokémon fliegt ein Pokéball davon
function flyAway(gone, from) {
  gone.forEach((g, i) => {
    const rc = from.get(g.uid); if (!rc) return;
    const ball = ballCanvas(ballSprite(g.ball, null, g.dex), 2); ball.className = 'rel-ball';
    document.body.append(ball);
    const x0 = rc.left + rc.width / 2 - 20, y0 = rc.top + rc.height / 2 - 20, dx = (Math.random() - 0.5) * 220, up = innerHeight * (0.6 + Math.random() * 0.3);
    ball.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(.6) rotate(0deg)`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 30}px) scale(1.2) rotate(-20deg)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${x0 + dx * 0.5}px, ${y0 - up * 0.5}px) scale(1) rotate(200deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${x0 + dx}px, ${y0 - up}px) scale(.4) rotate(420deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 300, delay: Math.min(i * 90, 1800), easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'backwards' }).onfinish = () => ball.remove();
  });
}
