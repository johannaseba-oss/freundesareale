// Item-Shop im Kampf-Menü: Vitamine für Kraft und Tempo.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import { canBattle } from '../game/battle.js';
import { powerOf, speedOf, shopItems, itemRoom, buyItem } from '../game/rocks.js';
import { portraitUrl } from '../gfx/sprites.js';
import { iconImg } from '../gfx/icons.js';
import { h, toast, modal } from './dom.js';
import { sfx } from '../audio.js';
import { haptic } from '../haptics.js';

const R = () => CFG.rocks;

const dots = (n) => '●'.repeat(n) + '○'.repeat(5 - n);
const name = (p) => p.nick || species(p.dex).name;
function statLine(label, r) {
  return h('div.rk-stat', h('span.k', label), h('span.rk-dots', dots(r.level)), h('div.bar.rk', h('i', { style: { width: (r.level >= 5 ? 100 : r.next * 100) + '%' } })));
}

// ================= Item-Shop =================
export function openItemShop(onClose = null) {
  let item = shopItems()[0];
  modal((m, close) => {
    const body = h('div');
    const render = () => {
      const mons = (app.state.pokemon || []).filter((p) => canBattle(p.dex))
        .sort((a, b) => !!b.fav - !!a.fav || (item.stat === R().power.stat ? powerOf(b).value - powerOf(a).value : speedOf(b).value - speedOf(a).value));
      body.replaceChildren(
        h('div.rk-tabs', shopItems().map((it) => h('button.btn.small' + (it === item ? '.primary' : ''), { onclick: () => { item = it; render(); } }, `${it.icon} ${it.name}`))),
        h('p.note', item.desc, ' ', `+${item.ev} Fleißpunkte (EV) – gilt dauerhaft und auch im Kampf. Mit Items bis ${R().shop.vitaminCap} EV je Wert.`),
        h('p.note', 'Du hast ', iconImg('coin', 2), ` ${app.state.coins}.`),
        h('div.inv.rk-shop', mons.map((p) => {
          const r = item.stat === R().power.stat ? powerOf(p) : speedOf(p), room = itemRoom(p, item);
          return h('div.stone-row',
            h('img', { src: portraitUrl(p.dex, 'Normal', p.shiny), alt: '' }),
            h('div.rk-shop-text', h('b', name(p)), statLine(item.stat === R().power.stat ? 'Kraft' : 'Tempo', r), h('small', `EV ${p.evs?.[item.stat] || 0}`)),
            h('button.btn.gold.small', {
              disabled: !room || app.state.coins < item.price,
              onclick: () => {
                const res = app.act((s) => buyItem(s, p.uid, item.id), true);
                if (res.ok === false) return;
                sfx.coin(); haptic('medium');
                const after = item.stat === R().power.stat ? powerOf(p) : speedOf(p);
                toast(after.level > r.level ? `${name(p)}: ${item.stat === R().power.stat ? 'Kraft' : 'Tempo'} ${after.level}!` : `${name(p)} hat ${item.name} bekommen (+${res.add} EV).`);
                render();
              },
            }, room ? [iconImg('coin', 2), String(item.price)] : 'max'));
        })));
    };
    render();
    m.append(h('div.row', h('h3', { style: { margin: 0, flex: 1 } }, '🛒 Item-Shop'), h('button.btn.small', { onclick: () => import('./slots.js').then((x) => x.openBag()), style: { flex: 'none' } }, '🎒 Steine'), h('button.btn.small', { onclick: () => { close(); onClose?.(); }, style: { flex: 'none' } }, '✕')), body);
  });
}
