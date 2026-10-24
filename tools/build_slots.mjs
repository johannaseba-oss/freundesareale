// Spielautomat-Sprites aufbereiten: blauen Hintergrund entfernen, Kopfzeile mit japanischem Text und die
// Gewinntabellen (Münzbeträge – hier gibt es keine Münzen zurück) übermalen, Credits-Text weglassen.
// Quelle: tools/data/slots/source.png  →  public/art/slots/sheet.png   (Ausschnitte: src/ui/slots.js, RECT)
import sharp from 'sharp';

const src = 'tools/data/slots/source.png', out = 'public/art/slots/sheet.png';
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const at = (x, y) => (y * W + x) * 4;
const bg = [data[at(0, H - 1)], data[at(0, H - 1) + 1], data[at(0, H - 1) + 2]];
for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 30) data[i + 3] = 0;
const fill = (x0, y0, x1, y1, from) => { const c = at(from[0], from[1]); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = at(x, y); for (let k = 0; k < 4; k++) data[i + k] = data[c + k]; } };
fill(0, 0, W - 1, 10, [0, H - 1]); // Kopfzeile (wird durchsichtig)
fill(0, 410, 140, H - 1, [0, H - 1]); // „Ripped by …“
// Gewinntabellen links/rechts: Inhalt mit der Tafelfarbe übermalen
fill(2, 161, 43, 187, [24, 158]);
fill(216, 161, 257, 189, [236, 158]);
await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(out);
console.log('ok', out);

// Entwicklungssteine: tools/data/slots/stones.jpg (weißer Hintergrund, 4×3 Raster) → public/art/slots/stones.png (Streifen à 52×52)
// Reihenfolge = STONE_ORDER in src/ui/slots.js
{
  const order = [[8, 8], [65, 8], [121, 8], [179, 8], [8, 65], [65, 65], [122, 65], [178, 65], [8, 122], [65, 122]]; // Wasser, Finster, Feuer, Eis, Mond, Blatt, Leucht, Sonne, Donner, Funkel
  const C = 52, { data: d, info: inf } = await sharp('tools/data/slots/stones.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out2 = Buffer.alloc(C * order.length * C * 4);
  for (const [n, [sx, sy]] of order.entries()) {
    // Hintergrund = helle Pixel, die vom Rand des Felds aus erreichbar sind (Glanzlichter im Stein bleiben)
    const cell = Buffer.alloc(C * C * 4), bgm = new Uint8Array(C * C), st = [];
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const i = ((sy - 1 + y) * inf.width + sx - 1 + x) * 4; d.copy(cell, (y * C + x) * 4, i, i + 4); }
    const light = (x, y) => { const i = (y * C + x) * 4; return cell[i] > 225 && cell[i + 1] > 225 && cell[i + 2] > 225; };
    for (let k = 0; k < C; k++) for (const [x, y] of [[k, 0], [k, C - 1], [0, k], [C - 1, k]]) if (light(x, y) && !bgm[y * C + x]) { bgm[y * C + x] = 1; st.push([x, y]); }
    while (st.length) { const [x, y] = st.pop(); for (const [a, b] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (a >= 0 && b >= 0 && a < C && b < C && !bgm[b * C + a] && light(a, b)) { bgm[b * C + a] = 1; st.push([a, b]); } }
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const i = (y * C + x) * 4, o = (y * C * order.length + n * C + x) * 4; cell.copy(out2, o, i, i + 4); if (bgm[y * C + x]) out2[o + 3] = 0; }
  }
  await sharp(out2, { raw: { width: C * order.length, height: C, channels: 4 } }).png().toFile('public/art/slots/stones.png');
  console.log('ok stones');
}
