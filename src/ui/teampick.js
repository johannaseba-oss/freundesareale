// Gemeinsame Teamauswahl (Arena, PokeDefense): startet leer, Antippen nummeriert und rahmt das Pokémon ein,
// beim letzten Platz öffnet sich die Bestätigung. Karten werden nur aktualisiert, nicht neu gebaut (bleibt flüssig).
import { species } from '../config.js';
import { portraitUrl } from '../gfx/sprites.js';
import { typeChip } from '../game/types.js';
import { h, toast } from './dom.js';
import { haptic } from '../haptics.js';

// mons: Pokémon-Liste; N: Teamgröße; hint(p): kleine Zusatzinfo (Attacke/Rolle); onFull(uids): Team vollständig
export function teamPicker({ mons, N, hint, onFull }) {
  const sel = [];
  const count = h('span.bs-count');
  const cards = new Map();
  const refresh = () => {
    count.textContent = `${sel.length}/${N}`;
    count.classList.toggle('full', sel.length === N);
    for (const [uid, el] of cards) {
      const i = sel.indexOf(uid);
      el.classList.toggle('on', i >= 0);
      el.querySelector('.bs-num').textContent = i >= 0 ? String(i + 1) : '';
    }
  };
  const grid = h('div.bs-grid.pick', mons.map((p) => {
    const el = h('button.bs-mon', { onclick: () => {
      const i = sel.indexOf(p.uid);
      if (i >= 0) sel.splice(i, 1);
      else if (sel.length < N) sel.push(p.uid);
      else { toast(`Das Team ist voll (${N}).`); return; }
      haptic('tick');
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      refresh();
      if (sel.length === N) setTimeout(() => onFull([...sel]), 180);
    } },
    h('span.bs-num'),
    h('img.bs-por', { src: portraitUrl(p.dex), alt: '', loading: 'lazy' }),
    h('b', p.nick || species(p.dex).name),
    h('span.type-chips.mini', species(p.dex).types.map((ty) => typeChip(ty))),
    hint(p));
    cards.set(p.uid, el);
    return el;
  }));
  refresh();
  return { count, grid, sel, clear: () => { sel.length = 0; refresh(); } };
}
