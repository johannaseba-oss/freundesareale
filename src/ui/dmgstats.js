// Pause-Übersicht: welche Pokémon den meisten/wenigsten Schaden machen und auf welchen Feldern am meisten Schaden entsteht.
// units: platzierte Pokémon (mit dmg, level, placedAt), cells: { 'c,r': Schaden }, grid: { c0, c1, r0, r1 } (Feld-Ausschnitt), t: Spielzeit
// recent: [[Zeit, Pokémon-id, Feld, Schaden], …] der letzten 10 s (Umschalter „Letzte 10 s“)
// cellOf(c, r) (Route): Schlüssel des Bauplatzes auf dem Feld oder null
import { species } from '../config.js';
import { portraitUrl } from '../gfx/sprites.js';
import { h } from './dom.js';

const fmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)));
let mode = 'all'; // 'all' | 'recent' (bleibt zwischen zwei Pausen erhalten)

export function damageStats(opts) {
  const box = h('div.ds');
  const render = () => box.replaceChildren(...build(opts, () => render()));
  render();
  return box;
}
function build({ units, cells, grid, t, cellOf, recent = [] }, rerender) {
  const rec = mode === 'recent', win = Math.min(10, t);
  const byUnit = new Map(), byCell = {};
  if (rec) for (const [, id, k, d] of recent) { byUnit.set(id, (byUnit.get(id) || 0) + d); byCell[k] = (byCell[k] || 0) + d; }
  const dmgOf = (u) => (rec ? byUnit.get(u.id) || 0 : u.dmg || 0);
  const list = units.filter((u) => u.hp == null || u.hp > 0).map((u) => ({ u, dmg: dmgOf(u), dps: rec ? dmgOf(u) / Math.max(1, win) : (u.dmg || 0) / Math.max(5, t - (u.dmgSince ?? t)) }))
    .sort((a, b) => b.dmg - a.dmg);
  const total = list.reduce((a, x) => a + x.dmg, 0);
  const tabs = h('div.ds-tabs',
    h('button.btn.small' + (rec ? '' : '.primary'), { onclick: () => { mode = 'all'; rerender(); } }, 'Gesamt'),
    h('button.btn.small' + (rec ? '.primary' : ''), { onclick: () => { mode = 'recent'; rerender(); } }, 'Letzte 10 s'),
    h('span.ds-total', `Schaden ${rec ? '(10 s)' : 'gesamt'}: `, h('b', fmt(total)), rec ? h('small', ` · ${fmt(total / Math.max(1, win))}/s`) : null));
  if (!list.length) return [tabs, h('p.note', 'Noch keine Pokémon auf dem Feld.')];
  const max = Math.max(1, ...list.map((x) => x.dmg));
  // Sterne-Sammler, Mauern und Explosive sollen keinen Schaden machen – nur Angreifer werden verglichen
  const helper = (u) => ['produzent', 'mauer', 'explosiv'].includes(u.role);
  const fighters = list.filter((x) => !helper(x.u)), first = fighters[0], last = fighters.length > 2 ? fighters[fighters.length - 1] : null;
  const rows = list.map((x) => {
    const tag = helper(x.u) ? h('span.ds-tag.help', 'Helfer') : fighters.length > 1 && x === first ? h('span.ds-tag.top', 'stärkstes') : x === last ? h('span.ds-tag.low', 'austauschen?') : null;
    return h('div.ds-row', h('img', { src: portraitUrl(x.u.dex), alt: '' }),
      h('div.ds-main', h('b', x.u.nick || species(x.u.dex).name, h('small.ds-lv', ` Lv ${x.u.level}`), tag), h('div.ds-bar', h('i', { style: { width: (x.dmg / max) * 100 + '%' } }))),
      h('div.ds-num', h('b', fmt(x.dmg)), h('small', `${x.dps.toFixed(1)}/s`)));
  });
  // Feldkarte: jedes Feld eingefärbt nach dem Schaden, der von dort aus gemacht wurde (dunkel = wenig, gelb = viel)
  const C = rec ? byCell : cells || {}, cmax = Math.max(1, ...Object.values(C));
  const cols = grid.c1 - grid.c0 + 1, map = h('div.ds-map', { style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } });
  // leere Reihen oben weglassen (dort steht noch niemand)
  const used = (r) => { for (let c = grid.c0; c <= grid.c1; c++) { const k = cellOf ? cellOf(c, r) : c + ',' + r; if (k != null && ((cells || {})[k] || units.some((u) => (cellOf ? u.slot === k : u.col === c && u.row === r)))) return true; } return false; };
  let r0 = grid.r0; while (r0 < grid.r1 && !used(r0)) r0++;
  for (let r = r0; r <= grid.r1; r++) for (let c = grid.c0; c <= grid.c1; c++) {
    const key = cellOf ? cellOf(c, r) : c + ',' + r;
    if (key == null) { map.append(h('div.ds-cell.none')); continue; } // kein Bauplatz (Route)
    const v = C[key] || 0, k = v / cmax;
    const unit = cellOf ? units.find((u) => u.slot === key) : units.find((u) => u.col === c && u.row === r);
    map.append(h('div.ds-cell' + (v ? '' : '.empty'), { style: v ? { background: `hsl(${k * 50}, 85%, ${28 + k * 32}%)` } : {} },
      unit ? h('img', { src: portraitUrl(unit.dex), alt: '' }) : null, v ? h('span', fmt(v)) : null));
  }
  return [tabs, h('b.ds-h', 'Schaden je Pokémon'), ...rows, h('b.ds-h', 'Schaden je Feld'), map, h('small.ds-note', 'Gelb = viel Schaden von diesem Feld aus, dunkel = wenig. Ziehe schwache Pokémon auf ein anderes Pokémon, um die Plätze zu tauschen.')];
}
