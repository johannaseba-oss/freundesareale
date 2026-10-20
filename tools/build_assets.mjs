// Bereitet Areal-Hintergründe und den Automaten aus assets-input/ bzw. dem PMD-Hintergrundordner auf.
// Aufruf: npm run assets:art
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const IN = path.join(ROOT, 'assets-input');
const OUT = path.join(ROOT, 'public/art');
fs.mkdirSync(path.join(OUT, 'areale'), { recursive: true });

// ---- Areal-Hintergründe: eigene Bilder aus assets-input/areale (Dateiname = Areal-ID) ----
// WebP/JPG werden als WebP gespeichert (klein), PNG bleibt PNG. Dateiname in areas.json -> "image".
for (const f of fs.readdirSync(path.join(IN, 'areale'))) {
  if (!/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
  const id = f.replace(/\.[^.]+$/, '');
  const asPng = /\.(png|gif)$/i.test(f);
  const img = sharp(path.join(IN, 'areale', f));
  await (asPng ? img.png() : img.webp({ quality: 92 })).toFile(path.join(OUT, 'areale', `${id}.${asPng ? 'png' : 'webp'}`));
  console.log('Areal-Bild', id);
}

// ---- Automat: Kugel und Ausgabeschacht leeren, Bälle zeichnet das Spiel selbst ----
{
  const src = path.join(IN, 'automat/automat.webp');
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, C = info.channels;
  const set = (x, y, hex) => { const i = (y * W + x) * C; data[i] = parseInt(hex.slice(0, 2), 16); data[i + 1] = parseInt(hex.slice(2, 4), 16); data[i + 2] = parseInt(hex.slice(4, 6), 16); if (C === 4) data[i + 3] = 255; };
  const G = { cx: 448, cy: 470, r: 372, top: 238, bottom: 756 };
  for (let y = G.top; y <= G.bottom; y++) for (let x = G.cx - G.r; x <= G.cx + G.r; x++) {
    const d = Math.hypot(x - G.cx, y - G.cy);
    if (d > G.r) continue;
    // leichte Schattierung: unten etwas dunkler, Rand etwas heller
    const t = (y - G.top) / (G.bottom - G.top);
    const band = Math.floor(t * 4); // gestuft wie Pixel-Art
    set(x, y, ['c1dde8', 'bcd9e5', 'b5d3e0', 'adcddb'][band] || 'adcddb');
  }
  for (let y = 1060; y <= 1150; y++) for (let x = 394; x <= 503; x++) set(x, y, y < 1072 ? '3a161b' : '4c1e24');
  await sharp(data, { raw: { width: W, height: info.height, channels: C } }).png().toFile(path.join(OUT, 'automat.png'));
  fs.writeFileSync(path.join(OUT, 'automat.json'), JSON.stringify({ width: W, height: info.height, globe: G, chute: { x: 448, y: 1108 }, knob: { x: 448, y: 925, w: 150, h: 96 }, pixel: 8 }, null, 2));
  // Drehknopf separat ausschneiden (wird beim Kurbeln gedreht)
  await sharp(src).extract({ left: 448 - 80, top: 925 - 52, width: 160, height: 104 }).png().toFile(path.join(OUT, 'knob.png'));
  console.log('Automat fertig');
}

// ---- Item-/Beeren-Sprites: assets-input/items/*.png -> public/art/items (in balance.json bei der Beere als "sprite" eintragen) ----
{
  const dir = path.join(IN, 'items');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'items'), { recursive: true });
  for (const f of fs.readdirSync(dir).filter((x) => /\.(png|webp|gif)$/i.test(x))) {
    await sharp(path.join(dir, f)).png().toFile(path.join(OUT, 'items', f.replace(/\.[^.]+$/, '.png')));
    console.log('Item', f);
  }
}

// ---- App-Icons (aus dem Automatenbild) ----
for (const size of [192, 512, 1024]) {
  const inner = Math.round(size * 0.86);
  const img = await sharp(path.join(IN, 'automat/automat.webp')).resize(inner, inner, { fit: 'contain', background: '#e9f3d6', kernel: 'nearest' }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#e9f3d6' } })
    .composite([{ input: img, gravity: 'center' }]).png().toFile(path.join(ROOT, 'public', `icon-${size}.png`));
}
console.log('Icons fertig');

// ---- Putz-Minispiel: Sprites aus assets-input/putzen -> public/art/putzen; Blasen-Sheet (8x4) wird in Einzelblasen zerlegt ----
{
  const dir = path.join(IN, 'putzen'), out = path.join(OUT, 'putzen');
  if (fs.existsSync(dir)) {
    fs.mkdirSync(out, { recursive: true });
    const meta = { bubbles: 0 };
    for (const f of fs.readdirSync(dir)) {
      const id = f.replace(/\.[^.]+$/, '');
      if (id === 'blasen_sheet') {
        const m = await sharp(path.join(dir, f)).metadata();
        const cw = Math.floor(m.width / 8), ch = Math.floor(m.height / 4);
        let n = 0;
        for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
          const cell = await sharp(path.join(dir, f)).extract({ left: c * cw, top: r * ch, width: cw, height: ch }).png().toBuffer();
          const st = await sharp(cell).stats();
          if (st.channels[3].max < 10) continue; // leere Zelle
          await sharp(cell).trim({ threshold: 1 }).png().toFile(path.join(out, `blase_${n++}.png`));
        }
        meta.bubbles = n;
      } else {
        await sharp(path.join(dir, f)).trim({ threshold: 1 }).png().toFile(path.join(out, `${id}.png`));
      }
    }
    fs.writeFileSync(path.join(out, 'putzen.json'), JSON.stringify(meta));
    console.log('Putz-Sprites fertig, Blasen:', meta.bubbles);
  }
}
