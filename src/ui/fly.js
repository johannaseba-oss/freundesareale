// Fliegende Münzen/Beeren vom Pokémon zur Anzeige oben. Der angezeigte Münzstand zählt beim Ankommen hoch.
import { COIN_SHEET } from '../gfx/icons.js';
import { $ } from './dom.js';
import { sfx } from '../audio.js';

export const pending = { coins: 0, berries: 0 };
let onLand = () => {};
export const setOnLand = (fn) => { onLand = fn; };

export function fly(kind, from, amount, targetSel, imgSrc) {
  if (amount <= 0) return;
  const target = $(targetSel).getBoundingClientRect();
  const tx = target.left + 18, ty = target.top + target.height / 2;
  const n = Math.min(amount, 8);
  pending[kind === 'coin' ? 'coins' : 'berries'] += amount;
  for (let i = 0; i < n; i++) {
    const share = Math.floor(amount / n) + (i < amount % n ? 1 : 0);
    let el;
    if (kind === 'coin') { el = document.createElement('div'); el.className = 'flyer coin-spin'; el.style.backgroundImage = `url(${COIN_SHEET})`; el.style.animationDelay = `${-Math.random() * 0.6}s`; }
    else { el = document.createElement('img'); el.src = imgSrc; el.className = 'flyer'; }
    document.body.append(el);
    const sx = from.x + (Math.random() - 0.5) * 30, sy = from.y + (Math.random() - 0.5) * 16;
    const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 80, my = Math.min(sy, ty) - 60 - Math.random() * 40;
    const anim = el.animate([
      { transform: `translate(${sx}px, ${sy}px) scale(.4)`, opacity: 0 },
      { transform: `translate(${sx}px, ${sy - 30}px) scale(1.1)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${mx}px, ${my}px) scale(1)`, offset: 0.55 },
      { transform: `translate(${tx}px, ${ty}px) scale(.7)`, opacity: 1 },
    ], { duration: 650 + i * 70, easing: 'ease-in', delay: i * 60, fill: 'backwards' });
    anim.onfinish = () => {
      el.remove();
      const k = kind === 'coin' ? 'coins' : 'berries';
      pending[k] = Math.max(0, pending[k] - share);
      onLand(kind);
      if (kind === 'coin') sfx.coin();
      const t = $(targetSel);
      t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump');
    };
  }
}
