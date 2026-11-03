// Ausgrabung: Kacheln aus der Vorlage schneiden (assets-input/dig), Fundstücke aus items.png
// vermessen (Raster 32 px) und in public/config/dig.json eintragen. Aufruf: node tools/build_dig.mjs
import fs from 'fs';
import sharp from 'sharp';

const IN = 'assets-input/dig/', OUT = 'public/art/dig/', CF = 'public/config/dig.json', CELL = 32;
fs.mkdirSync(OUT, { recursive: true });

// Kacheln aus der großen Vorlage (eine Zelle = 120 px): Reihenfolge = Tiefe 1 … 6, danach Sand und Eisen
const TILES = [[360, 120], [480, 0], [600, 480], [360, 0], [600, 120], [0, 0], [480, 120], [840, 360]];
const sheet = sharp({ create: { width: CELL * TILES.length, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
const parts = [];
for (let i = 0; i < TILES.length; i++) {
  const input = await sharp(IN + 'vorlage.webp').extract({ left: TILES[i][0], top: TILES[i][1], width: 120, height: 120 }).resize(CELL, CELL, { kernel: 'nearest' }).png().toBuffer();
  parts.push({ input, left: i * CELL, top: 0 });
}
await sheet.composite(parts).png().toFile(OUT + 'tiles.png');

fs.copyFileSync(IN + 'items.png', OUT + 'items.png');

// Fundstücke: id, Name, Ausschnitt (x, y, Breite, Höhe auf dem Raster), Gruppe; stone = echter Entwicklungsstein statt Münzen
const box = (x, y, w, h) => { const x0 = Math.floor(x / CELL) * CELL, y0 = Math.floor(y / CELL) * CELL; return [x0, y0, Math.ceil((x + w - x0) / CELL) * CELL, Math.ceil((y + h - y0) / CELL) * CELL]; };
const G = (id, name, b, group, stone) => ({ id, name, box: box(...b), group, stone });
const LIST = [
  G('kugel_gruen', 'Kleine grüne Kugel', [4, 4, 56, 56], 'kugel'), G('kugel_rot', 'Kleine rote Kugel', [68, 4, 56, 56], 'kugel'), G('kugel_blau', 'Kleine blaue Kugel', [132, 4, 56, 56], 'kugel'),
  G('prisma_klein', 'Kleine Prismakugel', [194, 4, 60, 56], 'kugel'), G('perle_klein', 'Kleine Blasskugel', [258, 2, 60, 60], 'kugel'),
  G('gkugel_gruen', 'Große grüne Kugel', [328, 8, 80, 80], 'grossKugel'), G('gkugel_rot', 'Große rote Kugel', [424, 8, 80, 80], 'grossKugel'), G('gkugel_blau', 'Große blaue Kugel', [520, 8, 80, 80], 'grossKugel'),
  G('prisma', 'Große Prismakugel', [612, 8, 86, 84], 'grossKugel'), G('perle', 'Große Blasskugel', [706, 2, 92, 92], 'grossKugel'),
  G('dom', 'Domfossil', [2, 100, 154, 118], 'fossil'), G('helix1', 'Helixfossil', [162, 98, 123, 122], 'fossil'), G('helix2', 'Helixfossil', [418, 100, 124, 122], 'fossil'),
  G('klaue1', 'Klauenfossil', [0, 224, 156, 158], 'fossil'), G('klaue2', 'Klauenfossil', [162, 224, 158, 156], 'fossil'), G('klaue3', 'Klauenfossil', [324, 226, 156, 158], 'fossil'), G('klaue4', 'Klauenfossil', [482, 226, 156, 158], 'fossil'),
  G('schaedel', 'Kopffossil', [642, 224, 124, 118], 'fossil'), G('panzer', 'Schildfossil', [786, 226, 124, 126], 'fossil'),
  G('wurzel1', 'Wurzelfossil', [2, 386, 124, 156], 'fossil'), G('wurzel2', 'Wurzelfossil', [130, 386, 156, 124], 'fossil'), G('wurzel3', 'Wurzelfossil', [290, 386, 124, 156], 'fossil'), G('wurzel4', 'Wurzelfossil', [418, 386, 156, 124], 'fossil'),
  G('mond1', 'Mondstein', [288, 96, 128, 128], 'stein', 'moon-stone'), G('mond2', 'Mondstein', [550, 106, 122, 114], 'stein', 'moon-stone'),
  G('sonne1', 'Sonnenstein', [678, 98, 120, 122], 'stein', 'sun-stone'), G('sonne2', 'Sonnenstein', [804, 102, 122, 120], 'stein', 'sun-stone'),
  G('feuer', 'Feuerstein', [644, 354, 86, 92], 'stein', 'fire-stone'), G('wasser', 'Wasserstein', [738, 354, 92, 90], 'stein', 'water-stone'), G('donner', 'Donnerstein', [832, 352, 94, 94], 'stein', 'thunder-stone'),
  G('blatt1', 'Blattstein', [586, 460, 82, 102], 'stein', 'leaf-stone'), G('blatt2', 'Blattstein', [686, 458, 102, 82], 'stein', 'leaf-stone'),
  G('finster', 'Finsterstein', [648, 1030, 82, 86], 'stein', 'dusk-stone'), G('funkel', 'Funkelstein', [740, 1029, 85, 87], 'stein', 'dawn-stone'), G('leucht', 'Leuchtstein', [835, 1029, 89, 87], 'stein', 'shiny-stone'),
  G('schuppe1', 'Panzerschuppe', [818, 448, 96, 62], 'schatz'), G('schuppe2', 'Panzerschuppe', [866, 530, 62, 96], 'schatz'),
  G('stern', 'Sternenstück', [8, 552, 80, 80], 'schatz'), G('knochen1', 'Dicker Knochen', [98, 566, 188, 52], 'schatz'), G('knochen2', 'Dicker Knochen', [118, 642, 52, 188], 'schatz'),
  G('eisenkugel', 'Eisenkugel', [290, 546, 92, 92], 'schatz'), G('heiss', 'Heißbrocken', [390, 550, 116, 90], 'schatz'), G('glatt', 'Glattbrocken', [554, 592, 116, 106], 'schatz'), G('eis', 'Eisbrocken', [546, 704, 126, 110], 'schatz'),
  G('stachel', 'Stachelkern', [674, 556, 92, 84], 'schatz'), G('oval', 'Ovaler Stein', [776, 548, 80, 90], 'schatz'), G('ewig', 'Ewigstein', [678, 640, 118, 62], 'schatz'),
  G('glanz', 'Glanzsplitter', [24, 654, 48, 68], 'schatz'), G('lehm', 'Lichtlehm', [194, 654, 120, 94], 'schatz'), G('urzeit', 'Urzeitfossil', [330, 646, 108, 118], 'fossil'), G('feucht', 'Nassbrocken', [452, 640, 90, 78], 'schatz'),
  G('sternbruch', 'Sternbruch', [4, 740, 88, 88], 'schatz'), G('kiesel', 'Kieselkern', [194, 770, 60, 60], 'schatz'), G('herz', 'Herzschuppe', [256, 786, 48, 44], 'schatz'),
  G('scherbe_gruen', 'Grüne Scherbe', [804, 644, 120, 88], 'scherbe'), G('scherbe_rot', 'Rote Scherbe', [676, 708, 84, 88], 'scherbe'), G('scherbe_gelb', 'Gelbe Scherbe', [804, 740, 112, 88], 'scherbe'), G('scherbe_blau', 'Blaue Scherbe', [836, 836, 90, 88], 'scherbe'),
];
const GEMS = [['Käfer', 2, 836], ['Unlicht', 130, 836], ['Drache', 258, 836], ['Elektro', 386, 836], ['Kampf', 514, 836], ['Feuer', 642, 836], ['Pflanze', 2, 932], ['Boden', 130, 932], ['Eis', 258, 932], ['Gift', 386, 932], ['Psycho', 514, 932], ['Gestein', 642, 932], ['Flug', 2, 1028], ['Geist', 130, 1028], ['Stahl', 258, 1028], ['Wasser', 386, 1028], ['Normal', 514, 1028]];
for (const [t, x, y] of GEMS) LIST.push(G('juwel_' + t.toLowerCase().replace('ä', 'ae'), t + '-Juwel', [x, y, 120, 90], 'juwel'));

// Belegte Felder aus den Bildpunkten: ein Feld zählt, wenn genug Pixel des Fundstücks darin liegen
const { data, info } = await sharp(IN + 'items.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
