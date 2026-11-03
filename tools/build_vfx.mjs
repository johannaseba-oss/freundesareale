// Attackeneffekte aus dem Pixel VFX Mega Pack übernehmen: nur die benutzten Spritesheets kopieren und ihre Frames in config/vfx.json eintragen.
// Aufruf: node tools/build_vfx.mjs <Ordner pixel_vfx aus dem entpackten ZIP>
import fs from 'fs';
import path from 'path';

const SRC = process.argv[2], OUT = 'public/art/vfx', CF = 'public/config/vfx.json';
if (!SRC) throw new Error('Pfad zum entpackten Ordner pixel_vfx angeben');
const all = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(d, e.name)) : [path.join(d, e.name)]));
const index = new Map(all(path.join(SRC, 'effects')).filter((f) => f.endsWith('.json')).map((f) => [path.basename(f, '.json'), f]));
const c = JSON.parse(fs.readFileSync(CF, 'utf8'));
const used = new Set([...Object.values(c.types).flatMap((t) => [t.hit, t.missile]), ...Object.values(c.effects)].filter(Boolean));
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
c.sheets = {};
for (const name of used) {
  const f = index.get(name);
  if (!f) throw new Error('Effekt fehlt: ' + name);
  fs.copyFileSync(f.replace(/\.json$/, '.png'), `${OUT}/${name}.png`);
  c.sheets[name] = JSON.parse(fs.readFileSync(f, 'utf8')).frames.map((q) => [q.frame.x, q.frame.y, q.frame.w, q.frame.h, q.duration]);
}
fs.writeFileSync(CF, JSON.stringify(c) + '\n');
console.log(used.size, 'Effekte');
