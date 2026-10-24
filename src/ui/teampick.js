// Gemeinsame Teamauswahl (Arena, PokeDefense, Route): startet leer oder mit einer Empfehlung (initial), Antippen
// nummeriert und rahmt das Pokémon ein; beim letzten Platz bzw. mit „Weiter“ öffnet sich die Bestätigung.
// Karten werden nur aktualisiert, nicht neu gebaut (bleibt flüssig).
import { species } from '../config.js';
import { portraitUrl } from '../gfx/sprites.js';
import { typeChip } from '../game/types.js';
import { h, toast } from './dom.js';
import { haptic } from '../haptics.js';

// mons: Pokémon-Liste; N: Teamgröße; hint(p): kleine Zusatzinfo (Attacke/Rolle); onFull(uids): Team vollständig
// initial: vorausgewählte uids (Empfehlung) – dann gibt es die Leiste mit „Empfehlung“, „Leeren“ und „Weiter“
// recommend: empfohlene uids (Knopf „Empfehlung“, kleines ✦ auf der Karte) – ohne Angabe = initial
export function teamPicker({ mons, N, hint, onFull, initial = null, recommend = null }) {
  const rec = recommend || initial;
  const sel = initial ? [...initial] : [];
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
    h('b', p.nick || species(p.dex).name, recommend?.includes(p.uid) ? h('span.bs-rec', { title: 'Empfohlen' }, ' ✦') : null),
    h('span.type-chips.mini', species(p.dex).types.map((ty) => typeChip(ty))),
    hint(p));
    cards.set(p.uid, el);
    return el;
  }));
  const set = (list) => { sel.length = 0; sel.push(...list); refresh(); };
  const tools = initial ? h('div.bs-tools',
    h('button.btn.small', { onclick: () => { set(rec); haptic('tick'); } }, '✦ Empfehlung'),
    h('button.btn.small', { onclick: () => { set([]); haptic('tick'); } }, 'Leeren'),
    h('button.btn.small.primary', { onclick: () => { if (sel.length === N || (sel.length && sel.length >= Math.min(N, mons.length))) onFull([...sel]); else toast(`Wähle ${N} Pokémon.`); } }, 'Weiter ›')) : null;
  refresh();
  return { count, grid, sel, tools, clear: () => set([]) };
}
