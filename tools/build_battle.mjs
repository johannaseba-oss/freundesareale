// Baut public/data/battle.json (Kampfdaten) aus den PokeAPI-CSV-Dateien in tools/data.
// Aufruf: node tools/build_battle.mjs
// Enthält je Pokémon: Basiswerte, EV-Ertrag, EP-Ertrag, Wachstumsgruppe, Entwicklungen (Level / Stein) und
// die eine charakteristische Attacke. Attacken-Auswahl ist überschreibbar in public/config/attacks.json.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const D = path.join(ROOT, 'tools/data');
const GER = 6; // local_language_id Deutsch

function csv(name) {
  const text = fs.readFileSync(path.join(D, name + '.csv'), 'utf8');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const dexList = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/pokedex.json'), 'utf8'));
const inDex = new Set(dexList.map((p) => p.dex));
const typeName = Object.fromEntries(csv('type_names').filter((r) => +r.local_language_id === GER).map((r) => [r.type_id, r.name]));

// Attacken
const moveNames = Object.fromEntries(csv('move_names').filter((r) => +r.local_language_id === GER).map((r) => [r.move_id, r.name]));
const moves = new Map();
for (const r of csv('moves')) {
  if (+r.id > 10000) continue;
  moves.set(+r.id, { key: r.identifier, name: moveNames[r.id] || r.identifier, type: typeName[r.type_id], power: r.power ? +r.power : 0, acc: r.accuracy ? +r.accuracy : 100, cls: +r.damage_class_id, gen: +r.generation_id });
}
// Attacken, die sich nicht als Dauer-Angriff eignen (Aufladen/Ruhepause, Selbst-K.O., feste oder bedingte Schäden)
const BANNED = new Set(['hyper-beam', 'giga-impact', 'self-destruct', 'explosion', 'solar-beam', 'solar-blade', 'sky-attack', 'skull-bash', 'razor-wind', 'fly', 'dig', 'dive', 'bounce',
  'phantom-force', 'shadow-force', 'focus-punch', 'future-sight', 'doom-desire', 'last-resort', 'dream-eater', 'synchronoise', 'belch', 'fling', 'natural-gift', 'spit-up',
  'blast-burn', 'hydro-cannon', 'frenzy-plant', 'rock-wrecker', 'roar-of-time', 'prismatic-laser', 'meteor-beam', 'geomancy', 'freeze-shock', 'ice-burn', 
  'feint', 'struggle', 'magnitude', 'present', 'beat-up',
  'wring-out', 'crush-grip', 'punishment', 'stored-power', 'power-trip', 'final-gambit', 'memento',
  'mind-blown', 'misty-explosion', 
  
  'bide', 'counter', 'mirror-coat', 'metal-burst', 'endeavor', 'super-fang', 'natures-madness', 'reversal', 'flail', 'electro-ball', 'gyro-ball',
  'heavy-slam', 'heat-crash', 'low-kick', 'grass-knot', 
  'baton-pass', 'sheer-cold', 'fissure', 'guillotine', 'horn-drill',
  'spectral-thief']);

// Wachstumsgruppen + Erfahrungstabelle
const growth = {};
for (const r of csv('experience')) (growth[r.growth_rate_id] ||= [0])[+r.level] = +r.experience;
const growthNames = Object.fromEntries(csv('growth_rates').map((r) => [r.id, r.identifier]));

// Arten
const species = new Map(csv('pokemon_species').map((r) => [+r.id, r]));
const pokemon = new Map(csv('pokemon').filter((r) => +r.id < 10000).map((r) => [+r.id, r]));
const stats = new Map();
for (const r of csv('pokemon_stats')) {
  const id = +r.pokemon_id; if (id > 10000) continue;
  const s = (stats.get(id) || stats.set(id, { base: [0, 0, 0, 0, 0, 0], ev: [0, 0, 0, 0, 0, 0] }).get(id));
  s.base[+r.stat_id - 1] = +r.base_stat;
  s.ev[+r.stat_id - 1] = +r.effort;
}

// Items (Entwicklungssteine)
const itemNames = Object.fromEntries(csv('item_names').filter((r) => +r.local_language_id === GER).map((r) => [r.item_id, r.name]));
const items = new Map(csv('items').map((r) => [+r.id, r.identifier]));
const stones = {};

// Entwicklungen
const evos = new Map();
for (const r of csv('pokemon_evolution')) {
  const to = +r.evolved_species_id, from = +(species.get(to)?.evolves_from_species_id || 0);
  if (!from || !inDex.has(from) || !inDex.has(to)) continue;
  if (+r.required_pokemon_form_id > 10000 || +r.evolved_pokemon_form_id > 10000 || r.region_id) continue; // Regionalformen (z. B. Alola) – andere Sprites
  const cond = {};
  if (r.gender_id) cond.gender = +r.gender_id === 1 ? 'w' : 'm';
  if (r.relative_physical_stats) cond.relPhys = +r.relative_physical_stats; // 1: Ang > Vert, 0: gleich, -1: Ang < Vert
  let e = null;
  if (+r.evolution_trigger_id === 1 && r.minimum_level && !r.time_of_day && !r.known_move_type_id && !r.known_move_id && !r.held_item_id && !r.location_id && !r.party_species_id && !r.party_type_id && r.needs_overworld_rain !== '1' && r.turn_upside_down !== '1') {
    e = { to, level: +r.minimum_level, ...cond };
  } else if (+r.evolution_trigger_id === 3 && r.trigger_item_id) {
    const key = items.get(+r.trigger_item_id);
    if (!key || !/stone$/.test(key)) continue;
    stones[key] ||= { name: itemNames[r.trigger_item_id] || key };
    e = { to, stone: key, ...cond };
  }
  if (!e) continue;
  const list = evos.get(from) || evos.set(from, []).get(from);
  if (!list.some((x) => x.to === e.to && x.level === e.level && x.stone === e.stone)) list.push(e);
}
// Level, ab dem eine Art "existiert" (über Levelentwicklung erreicht) – für die Attackenwahl
const evoLevelOf = new Map();
for (const [from, list] of evos) for (const e of list) if (e.level) evoLevelOf.set(e.to, e.level);

// Level-Up-Attacken (neueste Spielversion, in der das Pokémon vorkommt)
const VG_PREF = [18, 17, 16, 15, 14, 11, 10, 8];
const learn = new Map();
for (const r of csv('pokemon_moves')) {
  if (+r.pokemon_move_method_id !== 1) continue;
  const id = +r.pokemon_id; if (!inDex.has(id)) continue;
  const vg = +r.version_group_id; if (!VG_PREF.includes(vg)) continue;
  const m = learn.get(id) || learn.set(id, {}).get(id);
  (m[vg] ||= []).push({ move: +r.move_id, level: +r.level });
}

const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/config/attacks.json'), 'utf8')).signature || {};
const usedMoves = new Set();
const out = {};
for (const p of dexList) {
  const sp = species.get(p.dex), pk = pokemon.get(p.dex), st = stats.get(p.dex);
  if (!sp || !pk || !st) { console.warn('keine Daten', p.dex); continue; }
  // Attackenwahl: stärkste passende Attacke, die bis zur "Stufen-Obergrenze" gelernt wird
  const sets = learn.get(p.dex) || {};
  const vg = VG_PREF.find((v) => sets[v]?.length);
  const list = vg ? sets[vg] : [];
  const evolvesAt = Math.min(...(evos.get(p.dex) || []).filter((e) => e.level).map((e) => e.level), Infinity);
  const from = evoLevelOf.get(p.dex) || (p.stage > 1 ? 20 * (p.stage - 1) : 1);
  const evolvesFurther = [...species.values()].some((x) => +x.evolves_from_species_id === p.dex);
  // Obergrenze: Level der nächsten Entwicklung; entwickelt sich anders (Stein, Freundschaft …) -> frühe Attacke; Endstufe -> spätere
  const cap = evolvesAt < Infinity ? evolvesAt : evolvesFurther ? 22 + 10 * (p.stage - 1) : Math.max(from + 18, p.stage >= 3 ? 50 : p.stage === 2 ? 45 : 40);
  const score = (m, lvl) => {
    const stab = p.types.includes(m.type) ? 3 : 1; // Attacke vom eigenen Typ klar bevorzugt
    return m.power * stab * (m.acc / 100) * (lvl <= 1 && p.stage > 1 ? 0.6 : 1);
  };
  let best = null;
  for (const { move, level } of list) {
    const m = moves.get(move);
    if (!m || m.cls === 1 || m.power < 20 || BANNED.has(m.key) || level > cap) continue;
    const s = score(m, level);
    if (!best || s > best.s) best = { move, s };
  }
  if (!best) { // nichts Passendes: schwächste erlaubte Schadens-Attacke irgendeines Levels, sonst Tackle
    for (const { move } of list) { const m = moves.get(move); if (m && m.cls !== 1 && m.power >= 20 && !BANNED.has(m.key)) { best = { move }; break; } }
  }
  let moveKey = overrides[p.dex] || (best ? moves.get(best.move).key : 'tackle');
  usedMoves.add(moveKey);
  out[p.dex] = {
    base: st.base, ev: st.ev, exp: +pk.base_experience || 50, growth: +sp.growth_rate_id,
    evos: evos.get(p.dex) || [], move: moveKey,
  };
}
const moveTable = {};
for (const m of moves.values()) if (usedMoves.has(m.key)) moveTable[m.key] = { name: m.name, type: m.type, power: m.power, acc: m.acc, cat: m.cls === 2 ? 'phys' : 'spez' };
for (const k of usedMoves) if (!moveTable[k]) console.warn('unbekannte Attacke', k);

fs.writeFileSync(path.join(ROOT, 'public/data/battle.json'), JSON.stringify({ growth, growthNames, stones, moves: moveTable, pokemon: out }));
console.log('Kampfdaten:', Object.keys(out).length, 'Pokémon,', Object.keys(moveTable).length, 'Attacken,', Object.keys(stones).length, 'Steine');
if (process.argv.includes('--list')) for (const p of dexList) if (out[p.dex]) console.log(p.dex, p.name, '→', moveTable[out[p.dex].move]?.name, moveTable[out[p.dex].move]?.power);

// Trainer-Sprites der Computergegner (4×4-Laufsheets, 64 px) -> public/art/trainer/<n>.png
const TRAINER_SRC = process.env.TRAINER_SRC || 'D:/Pokemon Sprites/Trainer Spritesheets 4x4';
const TRAINERS = ['d3gk6d4-c3f73330-a01a-4de8-91b3-87953d5f70b6.png', 'ddc6pww-9260e97d-bdb4-43de-9bbb-a5247900e998.png', 'dbivitk-ecd855df-9554-485f-a3d1-c76f7d884497.png',
  'd5jjgkf-7e95a26a-46ff-4f1b-b773-45bc8fd4ad51.png', 'de3xng9-a3fd95bd-55aa-4b3e-a379-53b4b4aa94c7.png'];
if (fs.existsSync(TRAINER_SRC)) {
  fs.mkdirSync(path.join(ROOT, 'public/art/trainer'), { recursive: true });
  TRAINERS.forEach((f, i) => fs.copyFileSync(path.join(TRAINER_SRC, f), path.join(ROOT, `public/art/trainer/${i + 1}.png`)));
}
