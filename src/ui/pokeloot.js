// PokeLoot: eigenes Spiel (Repo turmbeute), hier im Vollbild eingebettet. Spielstand liegt im eigenen Speicher von PokeLoot.
import { CFG } from '../config.js';
import { h } from './dom.js';
import { setMusic } from '../audio.js';

export function openPokeLoot(onClose) {
  const frame = h('iframe.pl-frame', { src: CFG.balance.pokeloot.url, allow: 'autoplay; fullscreen' });
  const close = () => { root.remove(); document.body.classList.remove('in-battle'); setMusic('menu'); onClose?.(); };
  const root = h('div.pl', frame, h('button.fp-close', { onclick: close, title: 'Zurück' }, '✕'));
  document.body.append(root); document.body.classList.add('in-battle');
  setMusic(null); // PokeLoot hat eigene Musik
}
