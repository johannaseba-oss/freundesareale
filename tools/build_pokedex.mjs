// Baut public/data/pokedex.json + public/sprites/<dex>/ aus dem PMD-Sprite-Ordner.
// Aufruf: npm run assets:pokedex   (Quelle per POKE_SRC überschreibbar)
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.env.POKE_SRC || 'D:/Pokemon Sprites/Pokemon_0001-0715_Portraits_Sprites';
// zweiter Ordner im SpriteCollab-Rohformat (portrait/NNNN, sprite/NNNN; Shiny unter 0000/0001, weiblich unter 0000/0000/0002)
const SRC2 = process.env.POKE_SRC2 || 'D:/Pokemon Sprites/x0716';
const PROFILES = process.env.POKE_PROFILES || 'C:/Users/johan/Documents/Unreal Projects/PokeWorld/Content/Data/profiles.json';
const SPECIES_CSV = path.join(ROOT, 'tools/data/pokemon_species.csv');
const OUT_SPRITES = path.join(ROOT, 'public/sprites');
const OUT_DATA = path.join(ROOT, 'public/data');

// Animationen, die das Spiel benutzt (Ersatz, falls eine fehlt)
const ANIMS = { Idle: ['Idle', 'Walk'], Walk: ['Walk'], Sleep: ['Sleep', 'EventSleep', 'Idle'], Eat: ['Eat', 'Nod', 'Hop', 'Idle'], Hop: ['Hop', 'Idle'], Attack: ['Attack', 'Strike', 'Idle'], Shoot: ['Shoot', 'Attack', 'Idle'], Hurt: ['Hurt', 'Idle'] };
const PORTRAITS = ['Normal', 'Happy', 'Joyous', 'Sad', 'Worried', 'Inspired', 'Teary-Eyed', 'Angry', 'Sigh', 'Determined'];

const species = new Map();
{
  const [head, ...rows] = fs.readFileSync(SPECIES_CSV, 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  for (const r of rows) {
    const v = r.split(',');
    const o = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
    species.set(+o.id, { family: +o.evolution_chain_id, genderRate: +o.gender_rate, from: o.evolves_from_species_id ? +o.evolves_from_species_id : 0, legendary: o.is_legendary === '1', mythical: o.is_mythical === '1', baby: o.is_baby === '1' });
  }
}
const csv = (name) => { const [head, ...rows] = fs.readFileSync(path.join(ROOT, 'tools/data', name + '.csv'), 'utf8').trim().split(/\r?\n/); const c = head.split(','); return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [c[i], v]))); };
const deName = new Map(csv('pokemon_species_names').filter((r) => r.local_language_id === '6').map((r) => [+r.pokemon_species_id, r.name]));
const deType = new Map(csv('type_names').filter((r) => r.local_language_id === '6').map((r) => [+r.type_id, r.name]));
const typesOf = new Map();
for (const r of csv('pokemon_types')) if (+r.pokemon_id <= 1025) { const a = typesOf.get(+r.pokemon_id) || []; a[+r.slot - 1] = deType.get(+r.type_id); typesOf.set(+r.pokemon_id, a); }
const ident = new Map(csv('pokemon_species').map((r) => [+r.id, r.identifier]));
const hasChild = new Set([...species.values()].filter(s => s.from).map(s => s.from));
function stageOf(dex) {
  let st = 1, cur = species.get(dex);
  while (cur && cur.from) { const p = species.get(cur.from); if (!p) break; if (!p.baby) st++; cur = p; }
  return st;
}
// Standard-Seltenheit (überschreibbar in public/data/rarity_overrides.json)
function rarityOf(dex) {
  const s = species.get(dex) || {};
  if (s.legendary || s.mythical) return 'legendaer';
  const st = stageOf(dex);
  if (s.baby) return 'gewoehnlich';
  if (st === 1) return hasChild.has(dex) ? 'gewoehnlich' : 'selten';
  if (st === 2) return 'selten';
  return 'sehr_selten';
}

const profiles = new Map(JSON.parse(fs.readFileSync(PROFILES, 'utf8')).map(p => [p.dex, p]));

async function copyAnims(data, sp, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const anims = {};
  for (const [want, fallbacks] of Object.entries(ANIMS)) {
    for (const f of fallbacks) {
      const a = data[f];
      const file = a && path.join(sp, `${a.file || f}-Anim.png`);
      if (!a || !fs.existsSync(file)) continue;
      const meta = await sharp(file).metadata();
      anims[want] = { fw: a.fw, fh: a.fh, cols: Math.round(meta.width / a.fw), rows: Math.round(meta.height / a.fh), dur: a.dur, file: `${want}.png` };
      fs.copyFileSync(file, path.join(outDir, `${want}.png`));
      break;
    }
  }
  return anims;
}

function parseAnimData(xml) {
  const anims = {};
  for (const m of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
    const b = m[1];
    const name = /<Name>(.*?)<\/Name>/.exec(b)[1];
    const copy = /<CopyOf>(.*?)<\/CopyOf>/.exec(b);
    if (copy) { anims[name] = { copyOf: copy[1] }; continue; }
    anims[name] = {
      fw: +/<FrameWidth>(\d+)/.exec(b)[1], fh: +/<FrameHeight>(\d+)/.exec(b)[1],
      dur: [...b.matchAll(/<Duration>(\d+)<\/Duration>/g)].map(d => +d[1]),
    };
  }
  for (const k in anims) if (anims[k].copyOf) anims[k] = anims[anims[k].copyOf] ? { ...anims[anims[k].copyOf], file: anims[k].copyOf } : null;
  return anims;
}

fs.mkdirSync(OUT_DATA, { recursive: true });
const dex = [];
const missing = [];
// Quellen sammeln: alter Ordner (NNNN_Name/Standard/...) und neuer Rohordner (sprite/NNNN, portrait/NNNN)
const entries = [];
for (const d of fs.readdirSync(SRC).filter((d) => /^\d{4}_/.test(d)).sort()) {
  const pf = (dir) => (e) => { const x = fs.existsSync(dir) && fs.readdirSync(dir).find((n) => n.endsWith(`_${e}.png`)); return x ? path.join(dir, x) : null; };
  entries.push({ num: +d.slice(0, 4), key: d.slice(5), sp: path.join(SRC, d, 'Standard', 'Sprites'), portrait: pf(path.join(SRC, d, 'Standard', 'Portraits')),
    fsp: path.join(SRC, d, '0000_Default__0000_Default__0002_Female', 'Sprites'),
    ssp: path.join(SRC, d, '0000_Default__0001_Shiny', 'Sprites'), sportrait: pf(path.join(SRC, d, '0000_Default__0001_Shiny', 'Portraits')) });
}
if (fs.existsSync(SRC2)) for (const d of fs.readdirSync(path.join(SRC2, 'sprite')).filter((d) => /^\d{4}$/.test(d)).sort()) {
  const num = +d; if (entries.some((e) => e.num === num)) continue;
  const S2 = path.join(SRC2, 'sprite', d), P2 = path.join(SRC2, 'portrait', d);
  const pf = (dir) => (e) => (fs.existsSync(path.join(dir, e + '.png')) ? path.join(dir, e + '.png') : null);
  const key = (ident.get(num) || d).replace(/-/g, '_').replace(/^./, (c) => c.toUpperCase());
  entries.push({ num, key, sp: S2, portrait: pf(P2), fsp: path.join(S2, '0000', '0000', '0002'), ssp: path.join(S2, '0000', '0001'), sportrait: pf(path.join(P2, '0000', '0001')) });
}
entries.sort((x, y) => x.num - y.num);
const sameMeta = (x, y) => Object.keys(x).length === Object.keys(y).length && Object.entries(x).every(([k, v]) => y[k] && v.fw === y[k].fw && v.fh === y[k].fh && v.cols === y[k].cols && v.rows === y[k].rows && v.dur.join() === y[k].dur.join());
let shinies = 0;
for (const E of entries) {
  const { num, key: d, sp } = E;
  const xmlPath = path.join(sp, 'AnimData.xml');
  if (!fs.existsSync(xmlPath)) { missing.push(num + '_' + d); continue; }
  const data = parseAnimData(fs.readFileSync(xmlPath, 'utf8'));
  const outDir = path.join(OUT_SPRITES, String(num).padStart(4, '0'));
  const anims = await copyAnims(data, sp, outDir);
  if (!anims.Walk || !anims.Idle) { missing.push(num + '_' + d); fs.rmSync(outDir, { recursive: true, force: true }); continue; }
  const portraits = [];
  for (const e of PORTRAITS) { const pfile = E.portrait(e); if (pfile) { fs.copyFileSync(pfile, path.join(outDir, `p_${e}.png`)); portraits.push(e); } }
  // weibliche Sprite-Variante (falls vorhanden)
  let femaleAnims = null;
  if (fs.existsSync(path.join(E.fsp, 'AnimData.xml'))) {
    const fa = await copyAnims(parseAnimData(fs.readFileSync(path.join(E.fsp, 'AnimData.xml'), 'utf8')), E.fsp, path.join(outDir, 'w'));
    if (fa.Walk && fa.Idle) femaleAnims = fa; else fs.rmSync(path.join(outDir, 'w'), { recursive: true, force: true });
  }
  // Shiny-Variante (sprites/NNNN/s/): shiny = true, oder eigene Maße in shinyAnims, falls sie abweichen
  let shiny = false, shinyAnims = null;
  if (fs.existsSync(path.join(E.ssp, 'AnimData.xml'))) {
    const sa = await copyAnims(parseAnimData(fs.readFileSync(path.join(E.ssp, 'AnimData.xml'), 'utf8')), E.ssp, path.join(outDir, 's'));
    if (sa.Walk && sa.Idle) {
      shiny = true; shinies++;
      if (!sameMeta(sa, anims)) shinyAnims = sa;
      for (const e of portraits) { const pfile = E.sportrait(e); if (pfile) fs.copyFileSync(pfile, path.join(outDir, 's', `p_${e}.png`)); else if (fs.existsSync(path.join(outDir, `p_${e}.png`))) fs.copyFileSync(path.join(outDir, `p_${e}.png`), path.join(outDir, 's', `p_${e}.png`)); }
    } else fs.rmSync(path.join(outDir, 's'), { recursive: true, force: true });
  }
  const pr = profiles.get(num) || {};
  const spc = species.get(num) || {};
  dex.push({
    dex: num, key: d, name: pr.name || deName.get(num) || d.replace(/_/g, ' '), types: pr.typen || (typesOf.get(num) || []).filter(Boolean),
    rarity: rarityOf(num), stage: stageOf(num), family: spc.family || num, genderRate: spc.genderRate ?? -1, social: pr.sozial || '', active: pr.aktiv || 'Tag', anims, femaleAnims, portraits,
    ...(shiny ? { shiny: 1 } : {}), ...(shinyAnims ? { shinyAnims } : {}),
  });
}
console.log('Shiny-Varianten:', shinies);

let overrides = {};
const ovPath = path.join(OUT_DATA, 'rarity_overrides.json');
if (fs.existsSync(ovPath)) overrides = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
else fs.writeFileSync(ovPath, JSON.stringify({ _hinweis: 'Pokédex-Nummer -> gewoehnlich | selten | sehr_selten | legendaer. Überschreibt die automatische Einstufung.', '25': 'selten' }, null, 2));
for (const p of dex) if (overrides[p.dex]) p.rarity = overrides[p.dex];

fs.writeFileSync(path.join(OUT_DATA, 'pokedex.json'), JSON.stringify(dex));
const count = {};
for (const p of dex) count[p.rarity] = (count[p.rarity] || 0) + 1;
console.log(`Pokédex: ${dex.length} Pokémon`, count);
console.log(`Ohne vollständige Sprites (nicht im Pool): ${missing.length}`, missing.join(', '));
