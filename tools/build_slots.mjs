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
