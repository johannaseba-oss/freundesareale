// Lernsets für den Spaziergang (klassische Rundenkämpfe) aus den PokeAPI-CSVs in tools/data:
// je Art das neueste offizielle Level-Lernset (Karmesin/Purpur → Schwert/Schild → Ultrasonne/Ultramond → ältere),
// dazu alle vorkommenden Attacken mit deutschem Namen, Typ, Stärke, Genauigkeit, Priorität und Wirkung (move_meta).
// Aufruf: node tools/build_learnsets.mjs  →  public/data/learnsets.json
import fs from 'fs';

const csv = (name) => {
  const [head, ...rows] = fs.readFileSync(`tools/data/${name}.csv`, 'utf8').trim().split(/\r?\n/);
  const keys = head.split(',');
  return rows.map((l) => { const c = l.split(','); return Object.fromEntries(keys.map((k, i) => [k, c[i]])); });
};
const DE = 6;
const dex = JSON.parse(fs.readFileSync('public/data/pokedex.json', 'utf8')).map((p) => p.dex);
const typeName = Object.fromEntries(csv('type_names').filter((r) => +r.local_language_id === DE).map((r) => [r.type_id, r.name]));
const moveName = Object.fromEntries(csv('move_names').filter((r) => +r.local_language_id === DE).map((r) => [r.move_id, r.name]));
const VG_PREF = [25, 20, 18, 17, 16, 15, 14, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

// Level-Lernsets je Art und Edition
const byMon = new Map();
for (const r of csv('pokemon_moves')) {
  if (+r.pokemon_move_method_id !== 1) continue;
  const id = +r.pokemon_id;
  if (!dex.includes(id)) continue;
  let m = byMon.get(id); if (!m) byMon.set(id, (m = new Map()));
  let l = m.get(+r.version_group_id); if (!l) m.set(+r.version_group_id, (l = []));
  l.push([+r.level, +r.move_id]);
}
const learn = {}, used = new Set();
for (const d of dex) {
  const m = byMon.get(d);
  if (!m) continue;
  const vg = VG_PREF.find((v) => m.get(v)?.length);
  const list = [...new Map(m.get(vg).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([lv, mv]) => [mv, [lv, mv]])).values()] // je Attacke nur das erste Level
    .sort((a, b) => a[0] - b[0]);
  learn[d] = list;
  for (const [, mv] of list) used.add(mv);
}

// Attacken + Wirkung
const meta = Object.fromEntries(csv('move_meta').map((r) => [r.move_id, r]));
const statCh = {};
for (const r of csv('move_meta_stat_changes')) (statCh[r.move_id] ||= []).push([+r.stat_id, +r.change]);
const CLS = { 1: 'status', 2: 'phys', 3: 'spez' };
const moves = {};
for (const r of csv('moves')) {
  if (!used.has(+r.id)) continue;
  const mm = meta[r.id] || {};
  const o = { name: moveName[r.id] || r.identifier, type: typeName[r.type_id], power: +r.power || 0, acc: +r.accuracy || 0, cat: CLS[r.damage_class_id], prio: +r.priority || 0,
    self: [7, 13, 4].includes(+r.target_id) };
  const m = { c: +mm.meta_category_id || 0 };
  if (+mm.meta_ailment_id > 0) { m.ail = +mm.meta_ailment_id; m.ailP = +mm.ailment_chance || 0; }
  if (mm.min_hits) { m.hits = [+mm.min_hits, +mm.max_hits]; }
  if (+mm.drain) m.drain = +mm.drain;
  if (+mm.healing) m.heal = +mm.healing;
  if (+mm.crit_rate) m.crit = +mm.crit_rate;
  if (+mm.flinch_chance) m.flinch = +mm.flinch_chance;
  if (statCh[r.id]) { m.stats = statCh[r.id]; m.statP = +mm.stat_chance || 0; }
  o.m = m;
  moves[r.id] = o;
}
fs.writeFileSync('public/data/learnsets.json', JSON.stringify({ _hinweis: 'Generiert von tools/build_learnsets.mjs (PokeAPI). learn: Pokédex-Nr. → [[Level, Attacke], …] (Level 0 = beim Entwickeln). m.c = meta_category (0 Schaden, 1 Zustand, 2 Statuswerte, 3 Heilung, 4 Schaden+Zustand, 6 Schaden+Senken, 7 Schaden+Erhöhen, 8 Schaden+Saugen …); stats: [[Wert 1–8, Stufen]]', moves, learn }));
console.log('Arten', Object.keys(learn).length, 'Attacken', Object.keys(moves).length, 'kB', Math.round(fs.statSync('public/data/learnsets.json').size / 1024));
