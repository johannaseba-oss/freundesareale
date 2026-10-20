// Einsammeln mit Animation: Münzen fliegen zur Münzanzeige, Beeren zum Beutel.
import { CFG } from '../config.js';
import { app } from '../app.js';
import * as A from '../game/actions.js';
import { berryUrl, berryImg } from '../gfx/icons.js';
import { fly } from './fly.js';
import { h, modal } from './dom.js';

// posOf(p) -> {x, y} Bildschirmposition, von der aus die Münzen starten
export function collectWithFx(list, posOf) {
  const parts = list.map((p) => ({ p, coins: p.coinsReady, berries: { ...(p.berriesReady || {}) } }));
  const r = app.act((s) => A.collectCoins(s, list));
  if (!r.ok) return r;
  for (const { p, coins, berries } of parts) {
    const pos = posOf(p);
    if (!pos) continue;
    fly('coin', pos, coins, '#hud-coins');
    for (const [id, n] of Object.entries(berries)) fly('berry', { x: pos.x + 10, y: pos.y }, n, '#hud-bag', berryUrl(id));
  }
  app.refresh(); // Anzeige zählt erst beim Ankommen der Münzen hoch
  return r;
}

export function openInventory() {
  modal((el, close) => {
    const s = app.state;
    el.append(h('h3', 'Beeren'),
      h('p.effects', 'Beeren entstehen bei Pflanzen-Pokémon in deinen Arealen. Einsetzen kannst du sie im Pflege-Fenster eines Pokémon.'),
      h('div.berries', CFG.balance.berries.map((b) => h('div.berry', berryImg(b.id, 3), h('div.t', h('b', `${b.name} × ${s.berries[b.id] || 0}`), b.text)))),
      h('br'), h('button.btn', { onclick: close }, 'Schließen'));
  });
}
