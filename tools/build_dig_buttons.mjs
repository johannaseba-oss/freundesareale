// Werkzeug-Knöpfe der Ausgrabung: Alle vier werden am dunklen Rahmen ausgerichtet und auf exakt dieselbe Rahmengröße gebracht,
// außen herum kommt ein einheitlicher heller Rand. So liegen die Varianten beim Umschalten deckungsgleich übereinander.
// Aufruf: node tools/build_dig_buttons.mjs (Quellen in assets-input/dig/knoepfe)
import fs from 'fs';
import sharp from 'sharp';

const IN = 'assets-input/dig/knoepfe/', OUT = 'public/art/dig/';
const FW = 492, FH = 696, B = 24, W = FW + 2 * B, H = FH + 2 * B, STEP = 12, LILA = [212, 210, 232, 255], KANTE = [150, 148, 175, 255];

// äußerer Rand mit abgestuften Ecken
function plate() {
  const d = Buffer.alloc(W * H * 4);
  const inside = (x, y) => { const c = Math.min(x, W - 1 - x) + Math.min(y, H - 1 - y); return c >= 2 * STEP && x >= 0 && y >= 0; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 5, y) || !inside(x + 5, y) || !inside(x, y - 5) || !inside(x, y + 5);
    d.set(edge ? KANTE : LILA, (y * W + x) * 4);
  }
  return sharp(d, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}
const back = await plate();
for (const f of fs.readdirSync(IN)) {
  const { data, info } = await sharp(IN + f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const grey = (x, y) => { const p = (y * w + x) * 4, r = data[p], g = data[p + 1], b = data[p + 2]; return data[p + 3] > 200 && r > 30 && r < 75 && Math.abs(r - g) < 10 && Math.abs(g - b) < 12; };
  const cols = Array(w).fill(0), rows = Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grey(x, y)) { cols[x]++; rows[y]++; }
  // Rahmen = äußerste Spalten und Zeilen, die zu einem großen Teil dunkelgrau sind
  const x0 = cols.findIndex((n) => n > h * 0.4), x1 = cols.findLastIndex((n) => n > h * 0.4), y0 = rows.findIndex((n) => n > w * 0.4), y1 = rows.findLastIndex((n) => n > w * 0.4);
  const frame = await sharp(IN + f).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).resize(FW, FH, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  await sharp(back).composite([{ input: frame, left: B, top: B }]).png().toFile(OUT + f.replace(/\.\w+$/, '.png'));
  console.log(f, w, h, 'Rahmen', x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}
