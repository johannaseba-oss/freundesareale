// Trainerprofil (Name + Trainer-Sprite) und Erfolge-Menü.
import { CFG } from '../config.js';
import { app } from '../app.js';
import * as A from '../game/actions.js';
import { progressOf, ownedSpecies } from '../game/achievements.js';
import { h, modal, toast, bar } from './dom.js';

const base = import.meta.env.BASE_URL;
const SPRITES = 80; // Anzahl der Bilder in public/art/trainers (Bau: node tools/build_battle.mjs)
export const trainerName = (s) => s.profile?.name || 'Trainer';

// Trainer-Sprite (64-px-Laufsheet, Blick nach unten) als Canvas
const imgs = new Map();
export function trainerSprite(n, size = 48) {
  const c = h('canvas.trainer-sprite', { width: 64, height: 64 });
  c.style.width = c.style.height = size + 'px';
  let img = imgs.get(n);
  if (!img) { img = new Image(); img.src = `${base}art/trainers/${n}.png`; imgs.set(n, img); }
  const draw = () => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, 64, 64); x.drawImage(img, 0, 0, 64, 64, 0, 0, 64, 64); };
  if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
  return c;
}

// Kleine Profilkarte (z. B. in den Einstellungen)
export function profileCard() {
  const s = app.state;
  const done = Object.keys(s.achievements || {}).length;
  return h('div.profile-card',
    trainerSprite(s.profile?.sprite || 1, 56),
    h('div.profile-text', h('b', trainerName(s)), h('small', `${ownedSpecies(s).size} Arten · ${s.stats.battlesWon || 0} Kampfsiege · 🏆 ${done}/${CFG.achievements.list.length}`)),
    h('div.profile-btns', h('button.btn.small', { onclick: openProfileEditor }, 'Profil'), h('button.btn.small', { onclick: openAchievements }, '🏆 Erfolge')));
}

export function openProfileEditor() {
  modal((el, close) => {
    const s = app.state;
    let pick = s.profile?.sprite || 1;
    const inp = h('input.nick-input', { value: s.profile?.name || '', maxLength: 16, placeholder: 'Dein Trainername' });
    const grid = h('div.trainer-grid');
    const render = () => grid.replaceChildren(...Array.from({ length: SPRITES }, (_, i) => {
      const n = i + 1;
      return h('button.trainer-pick' + (n === pick ? '.on' : ''), { onclick: () => { pick = n; render(); } }, trainerSprite(n, 44));
    }));
    render();
    el.append(h('h3', 'Trainerprofil'), h('b', 'Name'), inp, h('b', 'Aussehen'), grid,
      h('div.row', h('button.btn', { onclick: close }, 'Abbrechen'), h('button.btn.primary', { onclick: () => {
        app.act((st) => A.setProfile(st, inp.value, pick), true);
        toast('Profil gespeichert.');
        close();
      } }, 'Speichern')));
  });
}

export function openAchievements() {
  modal((el, close) => {
    const s = app.state, owned = ownedSpecies(s);
    const cats = [...new Set(CFG.achievements.list.map((a) => a.cat))];
    const done = Object.keys(s.achievements || {}).length;
    el.append(h('h3', `🏆 Erfolge (${done}/${CFG.achievements.list.length})`),
      ...cats.map((cat) => h('div.ach-cat', h('b', cat), ...CFG.achievements.list.filter((a) => a.cat === cat).map((a) => {
        const got = s.achievements?.[a.id];
        const { value, target } = progressOf(s, a, owned);
        return h('div.ach' + (got ? '.got' : ''),
          h('span.ach-ico', got ? '🏆' : '🔒'),
          h('div.ach-text', h('b', a.name), h('small', a.text),
            got ? h('small.ach-date', 'Freigeschaltet am ' + new Date(got).toLocaleDateString('de-DE'))
              : target > 1 ? h('div.ach-prog', bar('ach', (Math.min(value, target) / target) * 100), h('small', `${Math.min(value, target)} / ${target}`)) : null));
      }))),
      h('div.row', h('button.btn', { onclick: close }, 'Schließen')));
  });
}
