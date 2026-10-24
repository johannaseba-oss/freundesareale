// Pause-Übersicht: welche Pokémon den meisten/wenigsten Schaden machen und auf welchen Feldern am meisten Schaden entsteht.
// units: platzierte Pokémon (mit dmg, placedAt), cells: { 'c,r': Schaden }, grid: { c0, c1, r0, r1 } (Feld-Ausschnitt), t: Spielzeit
// cellOf(c, r) (Route): Schlüssel des Bauplatzes auf dem Feld oder null
import { species } from '../config.js';
import { portraitUrl } from '../gfx/sprites.js';
import { h } from './dom.js';

const fmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)));

export function damageStats({ units, cells, grid, t, cellOf }) {
  const list = units.filter((u) => u.hp == null || u.hp > 0).map((u) => ({ u, dmg: u.dmg || 0, dps: (u.dmg || 0) / Math.max(5, t - (u.dmgSince ?? t)) }))
    .sort((a, b) => b.dmg - a.dmg);
  if (!list.length) return h('p.note', 'Noch keine Pokémon auf dem Feld.');
  const max = Math.max(1, ...list.map((x) => x.dmg));
  // Sterne-Sammler, Mauern und Explosive sollen keinen Schaden machen – nur Angreifer werden verglichen
  const helper = (u) => ['produzent', 'mauer', 'explosiv'].includes(u.role);
  const fighters = list.filter((x) => !helper(x.u)), first = fighters[0], last = fighters.length > 2 ? fighters[fighters.length - 1] : null;
  const rows = list.map((x) => {
    const tag = helper(x.u) ? h('span.ds-tag.help', 'Helfer') : fighters.length > 1 && x === first ? h('span.ds-tag.top', 'stärkstes') : x === last ? h('span.ds-tag.low', 'austauschen?') : null;
    return h('div.ds-row', h('img', { src: portraitUrl(x.u.dex), alt: '' }),
      h('div.ds-main', h('b', x.u.nick || species(x.u.dex).name, tag), h('div.ds-bar', h('i', { style: { width: (x.dmg / max) * 100 + '%' } }))),
      h('div.ds-num', h('b', fmt(x.dmg)), h('small', `${x.dps.toFixed(1)}/s`)));
  });
  // Feldkarte: jedes Feld eingefärbt nach dem Schaden, der von dort aus gemacht wurde (dunkel = wenig, gelb = viel)
  const cmax = Math.max(1, ...Object.values(cells || {}));
  const cols = grid.c1 - grid.c0 + 1, map = h('div.ds-map', { style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } });
  // leere Reihen oben weglassen (dort steht noch niemand)
  const used = (r) => { for (let c = grid.c0; c <= grid.c1; c++) { const k = cellOf ? cellOf(c, r) : c + ',' + r; if (k != null && (cells?.[k] || units.some((u) => (cellOf ? u.slot === k : u.col === c && u.row === r)))) return true; } return false; };
  let r0 = grid.r0; while (r0 < grid.r1 && !used(r0)) r0++;
  for (let r = r0; r <= grid.r1; r++) for (let c = grid.c0; c <= grid.c1; c++) {
    const key = cellOf ? cellOf(c, r) : c + ',' + r;
    if (key == null) { map.append(h('div.ds-cell.none')); continue; } // kein Bauplatz (Route)
    const v = cells?.[key] || 0, k = v / cmax;
    const unit = cellOf ? units.find((u) => u.slot === key) : units.find((u) => u.col === c && u.row === r);
    map.append(h('div.ds-cell' + (v ? '' : '.empty'), { style: v ? { background: `hsl(${k * 50}, 85%, ${28 + k * 32}%)` } : {} },
      unit ? h('img', { src: portraitUrl(unit.dex), alt: '' }) : null, v ? h('span', fmt(v)) : null));
  }
  return h('div.ds', h('b.ds-h', 'Schaden je Pokémon'), ...rows, h('b.ds-h', 'Schaden je Feld'), map, h('small.ds-note', 'Gelb = viel Schaden von diesem Feld aus, dunkel = wenig. Ziehe schwache Pokémon auf ein anderes Pokémon, um die Plätze zu tauschen.'));
}
