import { berryById } from '../config.js';
// Kleine Pixel-Icons, als Zeichenkarten definiert (ein Zeichen = ein Pixel).
const PAL = {
  O: '#3b2a2a', Y: '#f7c843', W: '#fff8d8', D: '#c98a1d', G: '#5fb54a', g: '#3f8a3a',
  R: '#ec5a6a', r: '#b83a4e', B: '#9a6236', b: '#c88a52', P: '#e8d6b8', p: '#c7a77c',
  N: '#4a7bd8', n: '#2f55a8', S: '#ffd84a', s: '#d8a52a', L: '#9fd36e',
};
const MAPS = {
  coin: [
    '...OOOOO...',
    '..OYYYYYO..',
    '.OYWYYYYDO.',
    'OYWYYGYYYDO',
    'OYYYGGGYYDO',
    'OYYGGgGGYDO',
    'OYYYGGGYYDO',
    'OYYYYgYYYDO',
    '.OYYYYYYDO.',
    '..ODDDDDO..',
    '...OOOOO...',
  ],
  heart: [
    '.OO...OO.',
    'ORRO.ORRO',
    'ORWRORRRO',
    'ORRRRRRRO',
    '.ORRRRRrO',
    '..ORRRrO.',
    '...ORrO..',
    '....OO...',
  ],
  food: [
    '...bBbBbB...',
    '..BbBbBbBb..',
    'OOOOOOOOOOOO',
    'OPPPPPPPPPPO',
    '.OPPPPPPppO.',
    '..OOOOOOOO..',
  ],
  sinelbeere: [
    '....gG....',
    '...gG.....',
    '..OOOOOO..',
    '.ONNWNNNO.',
    'ONNWNNNNNO',
    'ONNNNNNNNO',
    'ONNNNNNNnO',
    '.ONNNNNnO.',
    '..OOOOOO..',
  ],
  tsitrubeere: [
    '....gG....',
    '...LgG....',
    '..OOOOOO..',
    '.OSSWSSSO.',
    'OSSWSSSSSO',
    'OSSSSSSSsO',
    'OSSSSSSSsO',
    '.OSSSSSsO.',
    '..OOOOOO..',
  ],
};

const urlCache = new Map();
export function iconCanvas(name, scale = 3) {
  const m = MAPS[name];
  const c = document.createElement('canvas');
  c.width = m[0].length * scale; c.height = m.length * scale;
  const ctx = c.getContext('2d');
  m.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    ctx.fillStyle = PAL[ch];
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }));
  return c;
}
export function iconUrl(name, scale = 3) {
  const k = name + scale;
  if (!urlCache.has(k)) urlCache.set(k, iconCanvas(name, scale).toDataURL());
  return urlCache.get(k);
}
export function iconImg(name, scale = 3, cls = 'ico') {
  const i = new Image();
  i.src = iconUrl(name, scale);
  i.className = cls;
  i.alt = '';
  return i;
}

// Beeren-Icon: eigenes Sprite (balance.json berries[].sprite, Datei in public/art/items) oder Pixel-Icon
export function berryImg(id, scale = 3, cls = 'ico') {
  const b = berryById(id);
  if (b?.sprite) {
    const i = new Image();
    i.src = `${import.meta.env.BASE_URL}art/items/${b.sprite}`;
    i.className = cls; i.alt = '';
    i.style.height = 10 * scale + 'px';
    return i;
  }
  return iconImg(MAPS[id] ? id : 'sinelbeere', scale, cls);
}
const berryCache = new Map();
export function berryCanvas(id) {
  if (!berryCache.has(id)) {
    const b = berryById(id);
    if (b?.sprite) { const i = new Image(); i.src = `${import.meta.env.BASE_URL}art/items/${b.sprite}`; berryCache.set(id, i); }
    else berryCache.set(id, iconCanvas(MAPS[id] ? id : 'sinelbeere', 1));
  }
  return berryCache.get(id);
}
export function berryUrl(id) {
  const b = berryById(id);
  return b?.sprite ? `${import.meta.env.BASE_URL}art/items/${b.sprite}` : iconUrl(MAPS[id] ? id : 'sinelbeere', 3);
}
