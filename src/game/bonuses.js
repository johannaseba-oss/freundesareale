// Gruppenboni, Pärchen und Areal-Effekte legendärer Pokémon.
// Alles hängt nur davon ab, wer gerade zusammen in einem Areal wohnt -> wird automatisch an- und abgeschaltet.
import { CFG, species } from '../config.js';
import { mood } from './mood.js';

const neutral = () => ({ coin: 1, xp: 1, hunger: 1, sat: 1, berry: 1, sources: [] });
const pct = (v) => Math.round(v * 100);

export function legendaryEffect(dex) {
  const e = CFG.bonuses.legendary[dex];
  if (!e) return null;
  return { ...e, text: CFG.bonuses.legendaryTexts[e.type].replace('{p}', pct(e.value)) };
}

// Welche Boni kann dieses Pokémon grundsätzlich bekommen? (für die Detailansicht)
export function bonusTraits(dex) {
  const B = CFG.bonuses, sp = species(dex), out = [];
  for (const g of B.groups) if (g.members.includes(dex)) out.push(`${g.name}: ${g.text} (ab ${g.min})`);
  const sg = B.socialGroups[sp.social];
  if (sg) out.push(`${sg.name}: lebt gern mit Artgenossen zusammen (ab ${sg.min} aus derselben Familie)`);
  if (B.pairs.socialTypes.includes(sp.social) && sp.genderRate > 0 && sp.genderRate < 8) out.push(`${B.pairs.name}: Männchen + Weibchen derselben Familie`);
  for (const x of B.pairs.extra) if (x.a.includes(dex) || x.b.includes(dex)) out.push(`${x.name}`);
  const le = legendaryEffect(dex);
  if (le) out.push(`Areal-Fähigkeit: ${le.text}`);
  return out;
}

// Arealstimmung = Durchschnitt der Bewohner-Stimmung; Münzbonus nach balance.json areaMood
export function areaMood(list, t = Date.now()) {
  if (!list.length) return null;
  const avg = list.reduce((a, p) => a + mood(p, t), 0) / list.length;
  const tier = (CFG.balance.areaMood?.tiers || []).find((x) => avg >= x.min);
  return { value: avg, bonus: tier?.bonus || 0 };
}

// -> { mods: Map(uid -> Faktoren), active: [{name, text, uids}] }
export function areaBonuses(list) {
  const B = CFG.bonuses;
  const mods = new Map(list.map((p) => [p.uid, neutral()]));
  const active = [];
  const addCoin = (uids, bonus, source) => {
    for (const u of uids) { const m = mods.get(u); m.coin *= 1 + bonus; m.sources.push(source); }
    active.push({ ...source, uids });
  };

  // Gruppen über Arten hinweg (Rudel, Herde, Pferde)
  for (const g of B.groups) {
    const mem = list.filter((p) => g.members.includes(p.dex));
    if (mem.length < g.min) continue;
    const bonus = Math.min(g.maxCoin, g.coinPerMember * mem.length);
    addCoin(mem.map((p) => p.uid), bonus, { name: g.name, text: `${mem.length} Mitglieder: +${pct(bonus)} % Glücksmünzen-Tempo` });
  }
  // Artgenossen nach Sozialverhalten (gleiche Entwicklungsfamilie)
  const fam = new Map();
  for (const p of list) {
    const sp = species(p.dex);
    if (!B.socialGroups[sp.social]) continue;
    const k = sp.family + '|' + sp.social;
    if (!fam.has(k)) fam.set(k, []);
    fam.get(k).push(p);
  }
  for (const [k, mem] of fam) {
    const sg = B.socialGroups[k.split('|')[1]];
    if (mem.length < sg.min) continue;
    const bonus = Math.min(sg.maxCoin, sg.coinPerMember * mem.length);
    addCoin(mem.map((p) => p.uid), bonus, { name: `${sg.name} (${species(mem[0].dex).name} & Co.)`, text: `${mem.length} Artgenossen: +${pct(bonus)} % Glücksmünzen-Tempo` });
  }
  // Pärchen
  const used = new Set();
  const P = B.pairs;
  const sorted = [...list].sort((a, b) => a.uid - b.uid);
  for (const x of P.extra) {
    for (const a of sorted.filter((p) => x.a.includes(p.dex))) {
      if (used.has(a.uid)) continue;
      const b = sorted.find((p) => x.b.includes(p.dex) && !used.has(p.uid));
      if (!b) break;
      used.add(a.uid); used.add(b.uid);
      addCoin([a.uid, b.uid], P.coin, { name: x.name, text: `+${pct(P.coin)} % Glücksmünzen-Tempo` });
    }
  }
  const byFam = new Map();
  for (const p of sorted) {
    const sp = species(p.dex);
    if (used.has(p.uid) || !p.gender || !P.socialTypes.includes(sp.social)) continue;
    if (!byFam.has(sp.family)) byFam.set(sp.family, { m: [], w: [] });
    byFam.get(sp.family)[p.gender].push(p);
  }
  for (const { m, w } of byFam.values()) {
    for (let i = 0; i < Math.min(m.length, w.length); i++) {
      addCoin([m[i].uid, w[i].uid], P.coin, { name: `${P.name}: ${species(m[i].dex).name} ♂ & ${species(w[i].dex).name} ♀`, text: `+${pct(P.coin)} % Glücksmünzen-Tempo` });
    }
  }
  // Legendäre: wirken auf das ganze Areal
  for (const p of list) {
    const e = legendaryEffect(p.dex);
    if (!e) continue;
    const src = { name: `${species(p.dex).name} (legendär)`, text: e.text };
    for (const m of mods.values()) {
      if (e.type === 'muenzTempo') m.coin *= 1 / (1 - e.value);
      else if (e.type === 'beerenTempo') m.berry *= 1 + e.value;
      else if (e.type === 'hunger') m.hunger *= 1 - e.value;
      else if (e.type === 'zufriedenheit') m.sat *= 1 - e.value;
      else if (e.type === 'xp') m.xp *= 1 + e.value;
      m.sources.push(src);
    }
    active.push({ ...src, uids: list.map((q) => q.uid) });
  }
  const am = areaMood(list);
  if (am?.bonus > 0) addCoin(list.map((p) => p.uid), am.bonus, { name: 'Arealstimmung', text: `Gute Stimmung im Areal: Münzen +${pct(am.bonus)} %` });
  return { mods, active };
}

// Faktoren für alle Pokémon in Arealen (Pokémon in der Sammlung bekommen keine)
export function allMods(s) {
  const out = new Map();
  for (const a of CFG.areas) {
    const list = s.pokemon.filter((p) => p.area === a.id);
    if (list.length) for (const [u, m] of areaBonuses(list).mods) out.set(u, m);
  }
  return out;
}
export const modsFor = (s, p) => (p.area ? areaBonuses(s.pokemon.filter((q) => q.area === p.area)).mods.get(p.uid) : neutral());
