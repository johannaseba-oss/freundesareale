// Werkzeug-Knöpfe der Ausgrabung: weißen Hintergrund entfernen, gerade auf den Knopf zuschneiden, alle auf dieselbe Größe bringen.
// Aufruf: node tools/build_dig_buttons.mjs (Quellen in assets-input/dig/knoepfe)
import fs from 'fs';
import sharp from 'sharp';

const IN = 'assets-input/dig/knoepfe/', OUT = 'public/art/dig/', W = 180, H = 248;
for (const f of fs.readdirSync(IN)) {
  const { data, info } = await sharp(IN + f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, bg = new Uint8Array(w * h), st = [];
  const white = (p) => data[p * 4 + 3] < 60 || data[p * 4] > 232 && data[p * 4 + 1] > 232 && data[p * 4 + 2] > 232;
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
  while (st.length) {
    const p = st.pop();
    if (bg[p] || !white(p)) continue;
    bg[p] = 1; data[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) st.push(p - 1);
    if (x < w - 1) st.push(p + 1);
    if (p >= w) st.push(p - w);
    if (p < w * (h - 1)) st.push(p + w);
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!bg[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).resize(W, H, { fit: 'fill', kernel: 'nearest' }).png().toFile(OUT + f.replace(/\.\w+$/, '.png'));
  console.log(f, x1 - x0 + 1, y1 - y0 + 1);
}
