// Baut public/data/pokedex.json + public/sprites/<dex>/ aus dem PMD-Sprite-Ordner.
// Aufruf: npm run assets:pokedex   (Quelle per POKE_SRC überschreibbar)
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.env.POKE_SRC || 'D:/Pokemon Sprites/Pokemon_0001-0715_Portraits_Sprites';
const PROFILES = process.env.POKE_PROFILES || 'C:/Users/johan/Documents/Unreal Projects/PokeWorld/Content/Data/profiles.json';
const SPECIES_CSV = path.join(ROOT, 'tools/data/pokemon_species.csv');
const OUT_SPRITES = path.join(ROOT, 'public/sprites');
const OUT_DATA = path.join(ROOT, 'public/data');

// Animationen, die das Spiel benutzt (Ersatz, falls eine fehlt)
const ANIMS = { Idle: ['Idle', 'Walk'], Walk: ['Walk'], Sleep: ['Sleep', 'EventSleep', 'Idle'], Eat: ['Eat', 'Nod', 'Hop', 'Idle'], Hop: ['Hop', 'Idle'] };
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
const dirs = fs.readdirSync(SRC).filter(d => /^\d{4}_/.test(d)).sort();
for (const d of dirs) {
  const num = +d.slice(0, 4);
  const sp = path.join(SRC, d, 'Standard', 'Sprites');
  const pp = path.join(SRC, d, 'Standard', 'Portraits');
  const xmlPath = path.join(sp, 'AnimData.xml');
  if (!fs.existsSync(xmlPath)) { missing.push(d); continue; }
  const data = parseAnimData(fs.readFileSync(xmlPath, 'utf8'));
  const outDir = path.join(OUT_SPRITES, String(num).padStart(4, '0'));
  const anims = await copyAnims(data, sp, outDir);
  if (!anims.Walk || !anims.Idle) { missing.push(d); fs.rmSync(outDir, { recursive: true, force: true }); continue; }
  const portraits = [];
  for (const e of PORTRAITS) {
    const f = fs.existsSync(pp) && fs.readdirSync(pp).find(x => x.endsWith(`_${e}.png`));
    if (f) { fs.copyFileSync(path.join(pp, f), path.join(outDir, `p_${e}.png`)); portraits.push(e); }
  }
  // weibliche Sprite-Variante (falls vorhanden)
  let femaleAnims = null;
  const fsp = path.join(SRC, d, '0000_Default__0000_Default__0002_Female', 'Sprites');
  if (fs.existsSync(path.join(fsp, 'AnimData.xml'))) {
    const fa = await copyAnims(parseAnimData(fs.readFileSync(path.join(fsp, 'AnimData.xml'), 'utf8')), fsp, path.join(outDir, 'w'));
    if (fa.Walk && fa.Idle) femaleAnims = fa; else fs.rmSync(path.join(outDir, 'w'), { recursive: true, force: true });
  }
  const pr = profiles.get(num) || {};
  const spc = species.get(num) || {};
  dex.push({
    dex: num, key: d.slice(5), name: pr.name || d.slice(5).replace(/_/g, ' '), types: pr.typen || [],
    rarity: rarityOf(num), stage: stageOf(num), family: spc.family || num, genderRate: spc.genderRate ?? -1, social: pr.sozial || '', active: pr.aktiv || 'Tag', anims, femaleAnims, portraits,
  });
}

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
