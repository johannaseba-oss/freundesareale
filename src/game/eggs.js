// Pokémon-Eier: Zwei Pokémon derselben Entwicklungsfamilie und desselben Geschlechts, die gemeinsam in einem Areal leben,
// können nach einigen Tagen ein Ei bekommen (balance.json eggs). Zeitbasiert – läuft auch bei geschlossener App weiter.
// Aus dem Ei schlüpft die Grundform der Familie, mit Chance auf bessere IVs (von den Eltern) und Start-EVs.
import { CFG, species } from '../config.js';
import { HOUR } from '../time.js';
import { hashString } from '../rng.js';

const DAY = 24 * HOUR;
const E = () => CFG.balance.eggs;

// Grundform einer Familie (niedrigste Stufe, die es im Spiel gibt)
export function baseOf(dex) {
  const fam = species(dex).family;
  return CFG.dex.filter((p) => p.family === fam).sort((a, b) => a.stage - b.stage || a.dex - b.dex)[0].dex;
}

// Elternpaare je Areal: je Familie + Geschlecht die zwei mit den kleinsten IDs
function pairsOf(s) {
  const out = [];
  for (const a of CFG.areas) {
    const groups = new Map();
    for (const p of s.pokemon) {
      if (p.area !== a.id || !p.gender) continue;
      const k = species(p.dex).family + p.gender;
      (groups.get(k) || groups.set(k, []).get(k)).push(p);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((x, y) => x.uid - y.uid);
      out.push({ key: `${list[0].uid}-${list[1].uid}`, area: a.id, a: list[0], b: list[1] });
    }
  }
  return out;
}

// dtMs gemeinsam verbrachte Zeit seit dem letzten Lauf gutschreiben, ggf. Eier legen
export function simulateEggs(s, nowMs, dtMs) {
  const cfg = E();
  if (!cfg || dtMs <= 0) return;
  s.eggs ||= { pairs: {}, list: [] };
  const pairs = pairsOf(s);
  const keep = new Set(pairs.map((x) => x.key));
  for (const k of Object.keys(s.eggs.pairs)) if (!keep.has(k)) delete s.eggs.pairs[k]; // getrennt -> Zähler beginnt neu
  for (const pr of pairs) {
    const st = (s.eggs.pairs[pr.key] ||= { ms: 0, rolls: 0 });
    st.ms += dtMs;
    const due = Math.floor((st.ms - cfg.minDays * DAY) / DAY) + 1; // bisher fällige Würfe
    while (st.rolls < due) {
      st.rolls++;
      if (s.eggs.list.filter((e) => e.area === pr.area).length >= cfg.maxPerArea) break;
      if (hashString(`ei|${pr.key}|${st.rolls}|${s.eggs.list.length}`) / 4294967296 < cfg.chancePerDay) {
        const r = hashString(`eipos|${pr.key}|${nowMs}`) / 4294967296, r2 = hashString(`eipos2|${pr.key}|${nowMs}`) / 4294967296;
        const ang = r * Math.PI * 2, rad = Math.sqrt(r2) * 0.75;
        const laid = nowMs - (st.ms - (cfg.minDays + st.rolls - 1) * DAY) ; // ungefährer Zeitpunkt des Legens
        s.eggs.list.push({ id: hashString(`${pr.key}|${nowMs}|${st.rolls}`), dex: baseOf(pr.a.dex), area: pr.area, parents: [pr.a.uid, pr.b.uid],
          laidAt: Math.min(nowMs, laid), hatchAt: Math.min(nowMs, laid) + cfg.hatchHours * HOUR, u: Math.cos(ang) * rad, v: Math.sin(ang) * rad });
        st.ms = 0; st.rolls = 0;
        break;
      }
    }
  }
}

// Werte des Jungen: bessere IVs der Eltern mit Chance, sonst neu; evtl. Start-EVs
export function inheritStats(s, egg, rnd = Math.random) {
  const cfg = E();
  const par = egg.parents.map((u) => s.pokemon.find((p) => p.uid === u)).filter(Boolean);
  const ivMax = CFG.battle.stats.ivMax;
  const ivs = [0, 1, 2, 3, 4, 5].map((i) => {
    const best = Math.max(-1, ...par.map((p) => p.ivs?.[i] ?? -1));
    if (best >= 0 && rnd() < cfg.ivFromBestParentChance) return Math.min(ivMax, best + cfg.ivBonus[0] + Math.floor(rnd() * (cfg.ivBonus[1] - cfg.ivBonus[0] + 1)));
    return Math.floor(rnd() * (ivMax + 1));
  });
  const evs = [0, 0, 0, 0, 0, 0];
  if (rnd() < cfg.evChance) evs[Math.floor(rnd() * 6)] = cfg.evAmount[0] + Math.floor(rnd() * (cfg.evAmount[1] - cfg.evAmount[0] + 1));
  return { ivs, evs };
}
