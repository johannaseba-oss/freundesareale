// Ausgrabung: Kacheln aus der Vorlage schneiden (assets-input/dig), Fundstücke aus items.png
// vermessen (Raster 32 px) und in public/config/dig.json eintragen. Aufruf: node tools/build_dig.mjs
import fs from 'fs';
import sharp from 'sharp';

const IN = 'assets-input/dig/', OUT = 'public/art/dig/', CF = 'public/config/dig.json', CELL = 32;
fs.mkdirSync(OUT, { recursive: true });

// Kacheln aus der großen Vorlage (eine Zelle = 120 px): Reihenfolge = Tiefe 1 … 6, danach Sand, Eisen und das harte Gestein (Tiefe 7: abgedunkelter Fels)
const TILES = [[360, 120], [480, 0], [600, 480], [360, 0], [600, 120], [0, 0], [480, 120], [840, 360]];
const sheet = sharp({ create: { width: CELL * (TILES.length + 1), height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
const parts = [];
for (let i = 0; i < TILES.length; i++) {
  const input = await sharp(IN + 'vorlage.webp').extract({ left: TILES[i][0], top: TILES[i][1], width: 120, height: 120 }).resize(CELL, CELL, { kernel: 'nearest' }).png().toBuffer();
  parts.push({ input, left: i * CELL, top: 0 });
}
parts.push({ input: await sharp(IN + 'vorlage.webp').extract({ left: 0, top: 0, width: 120, height: 120 }).resize(CELL, CELL, { kernel: 'nearest' }).modulate({ brightness: 0.55, saturation: 0.5 }).png().toBuffer(), left: TILES.length * CELL, top: 0 });
await sheet.composite(parts).png().toFile(OUT + 'tiles.png');

// Fossilien: eigene Bilder, weißer Hintergrund raus, verpixelt und unten an das Item-Blatt gehängt (je 128 px = 4 Felder)
const FOSSILE = [['helix', 'Helixfossil'], ['dom', 'Domfossil'], ['bernstein', 'Altbernstein'], ['wurzel', 'Wurzelfossil'], ['klaue', 'Klauenfossil'], ['kopf', 'Kopffossil'], ['schild', 'Panzerfossil'], ['schale', 'Schildfossil'], ['feder', 'Federfossil'], ['kiefer', 'Kieferfossil'], ['flosse', 'Flossenfossil'], ['vogel', 'Vogelfossil'], ['drache', 'Drachenfossil'], ['dino', 'Paddelfossil'], ['fisch', 'Fischfossil']];
const BASE_H = 1120, FS = 128, FW = 7;
async function fossilPic(id) {
  const { data, info } = await sharp(IN + 'fossile/' + id + '.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, seen = new Uint8Array(w * h), st = [];
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
  while (st.length) {
    const p = st.pop();
    if (seen[p] || !(data[p * 4 + 3] < 60 || (data[p * 4] > 225 && data[p * 4 + 1] > 225 && data[p * 4 + 2] > 225))) continue;
    seen[p] = 1; data[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) st.push(p - 1);
    if (x < w - 1) st.push(p + 1);
    if (p >= w) st.push(p - w);
    if (p < w * (h - 1)) st.push(p + w);
  }
  const small = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).resize(FS / 2, FS / 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer();
  for (let i = 3; i < small.length; i += 4) small[i] = small[i] < 110 ? 0 : 255;
  return sharp(small, { raw: { width: FS / 2, height: FS / 2, channels: 4 } }).resize(FS, FS, { kernel: 'nearest' }).png().toBuffer();
}
const extra = [];
for (let i = 0; i < FOSSILE.length; i++) extra.push({ input: await fossilPic(FOSSILE[i][0]), left: (i % FW) * FS, top: BASE_H + Math.floor(i / FW) * FS });
const base = await sharp(IN + 'items.png').ensureAlpha().toBuffer();
await sharp({ create: { width: 928, height: BASE_H + 3 * FS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: base, left: 0, top: 0 }, ...extra]).png().toFile(OUT + 'items.png');

// Fundstücke: id, Name, Ausschnitt (x, y, Breite, Höhe auf dem Raster), Gruppe; stone = echter Entwicklungsstein statt Münzen
const box = (x, y, w, h) => { const x0 = Math.floor(x / CELL) * CELL, y0 = Math.floor(y / CELL) * CELL; return [x0, y0, Math.ceil((x + w - x0) / CELL) * CELL, Math.ceil((y + h - y0) / CELL) * CELL]; };
const G = (id, name, b, group, stone) => ({ id, name, box: box(...b), group, stone });
const LIST = [
  G('kugel_gruen', 'Kleine grüne Sphäre', [4, 4, 56, 56], 'kugel'), G('kugel_rot', 'Kleine rote Sphäre', [68, 4, 56, 56], 'kugel'), G('kugel_blau', 'Kleine blaue Sphäre', [132, 4, 56, 56], 'kugel'),
  G('prisma_klein', 'Kleine Prismasphäre', [194, 4, 60, 56], 'kugel'), G('perle_klein', 'Kleine Blasssphäre', [258, 2, 60, 60], 'kugel'),
  G('gkugel_gruen', 'Große grüne Sphäre', [328, 8, 80, 80], 'grossKugel'), G('gkugel_rot', 'Große rote Sphäre', [424, 8, 80, 80], 'grossKugel'), G('gkugel_blau', 'Große blaue Sphäre', [520, 8, 80, 80], 'grossKugel'),
  G('prisma', 'Große Prismasphäre', [612, 8, 86, 84], 'grossKugel'), G('perle', 'Große Blasssphäre', [706, 2, 92, 92], 'grossKugel'),
  ...FOSSILE.map(([id, name], i) => G(id, name, [(i % FW) * FS, BASE_H + Math.floor(i / FW) * FS, FS, FS], 'fossil')),
  G('mond1', 'Mondstein', [288, 96, 128, 128], 'stein', 'moon-stone'), G('mond2', 'Mondstein', [550, 106, 122, 114], 'stein', 'moon-stone'),
  G('sonne1', 'Sonnenstein', [678, 98, 120, 122], 'stein', 'sun-stone'), G('sonne2', 'Sonnenstein', [804, 102, 122, 120], 'stein', 'sun-stone'),
  G('feuer', 'Feuerstein', [644, 354, 86, 92], 'stein', 'fire-stone'), G('wasser', 'Wasserstein', [738, 354, 92, 90], 'stein', 'water-stone'), G('donner', 'Donnerstein', [832, 352, 94, 94], 'stein', 'thunder-stone'),
  G('blatt1', 'Blattstein', [586, 460, 82, 102], 'stein', 'leaf-stone'), G('blatt2', 'Blattstein', [686, 458, 102, 82], 'stein', 'leaf-stone'),
  G('finster', 'Finsterstein', [648, 1030, 82, 86], 'stein', 'dusk-stone'), G('funkel', 'Funkelstein', [740, 1029, 85, 87], 'stein', 'dawn-stone'), G('leucht', 'Leuchtstein', [835, 1029, 89, 87], 'stein', 'shiny-stone'),
  G('schuppe1', 'Panzerschuppe', [818, 448, 96, 62], 'schatz'), G('schuppe2', 'Panzerschuppe', [866, 530, 62, 96], 'schatz'),
  G('stern', 'Sternenstück', [8, 552, 80, 80], 'schatz'), G('knochen1', 'Dicker Knochen', [98, 566, 188, 52], 'schatz'), G('knochen2', 'Dicker Knochen', [118, 642, 52, 188], 'schatz'),
  G('eisenkugel', 'Eisenkugel', [290, 546, 92, 92], 'schatz'), G('heiss', 'Heißbrocken', [390, 550, 116, 90], 'schatz'), G('glatt', 'Glattbrocken', [554, 592, 116, 106], 'schatz'), G('eis', 'Eisbrocken', [546, 704, 126, 110], 'schatz'),
  G('stachel', 'Stachelkern', [674, 556, 92, 84], 'schatz'), G('oval', 'Ovaler Stein', [776, 548, 80, 90], 'schatz'), G('ewig', 'Ewigstein', [678, 640, 118, 62], 'schatz'),
  G('glanz', 'Glanzsplitter', [24, 654, 48, 68], 'schatz'), G('lehm', 'Lichtlehm', [194, 654, 120, 94], 'schatz'), G('hart', 'Harter Stein', [330, 646, 108, 118], 'schatz'), G('feucht', 'Nassbrocken', [452, 640, 90, 78], 'schatz'),
  G('sternbruch', 'Sternbruch', [4, 740, 88, 88], 'schatz'), G('kiesel', 'Kieselkern', [194, 770, 60, 60], 'schatz'), G('herz', 'Herzschuppe', [256, 786, 48, 44], 'schatz'),
  G('scherbe_gruen', 'Grüne Scherbe', [804, 644, 120, 88], 'scherbe'), G('scherbe_rot', 'Rote Scherbe', [676, 708, 84, 88], 'scherbe'), G('scherbe_gelb', 'Gelbe Scherbe', [804, 740, 112, 88], 'scherbe'), G('scherbe_blau', 'Blaue Scherbe', [836, 836, 90, 88], 'scherbe'),
];
const GEMS = [['Käfer', 2, 836], ['Unlicht', 130, 836], ['Drache', 258, 836], ['Elektro', 386, 836], ['Kampf', 514, 836], ['Feuer', 642, 836], ['Pflanze', 2, 932], ['Boden', 130, 932], ['Eis', 258, 932], ['Gift', 386, 932], ['Psycho', 514, 932], ['Gestein', 642, 932], ['Flug', 2, 1028], ['Geist', 130, 1028], ['Stahl', 258, 1028], ['Wasser', 386, 1028], ['Normal', 514, 1028]];
for (const [t, x, y] of GEMS) LIST.push(G('juwel_' + t.toLowerCase().replace('ä', 'ae'), t + '-Juwel', [x, y, 120, 90], 'juwel'));

// Belegte Felder aus den Bildpunkten: ein Feld zählt, wenn genug Pixel des Fundstücks darin liegen
const { data, info } = await sharp(OUT + 'items.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const items = LIST.map(({ id, name, box: [x, y, w, h], group, stone }) => {
  const cells = [];
  for (let cy = 0; cy < h / CELL; cy++) for (let cx = 0; cx < w / CELL; cx++) {
    let n = 0;
    for (let py = y + cy * CELL; py < y + (cy + 1) * CELL; py++) for (let px = x + cx * CELL; px < x + (cx + 1) * CELL; px++) if (data[(py * info.width + px) * 4 + 3] > 8) n++;
    if (n >= CELL * CELL * 0.2) cells.push([cx, cy]);
  }
  return { id, name, group, ...(stone ? { stone } : {}), x, y, w: w / CELL, h: h / CELL, cells };
});
const c = JSON.parse(fs.readFileSync(CF, 'utf8'));
c.items = items;
fs.writeFileSync(CF, JSON.stringify(c, null, 1) + '\n');
console.log(items.length, 'Fundstücke', items.map((i) => `${i.id}:${i.cells.length}`).join(' '));
