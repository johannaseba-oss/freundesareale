// Rennmodus (public/config/race.json): Stall mit Boxen, Pflege, Sprungtraining-Auswertung und das tägliche Rennen.
// Das Rennen wird aus den Anmeldungen des Tages deterministisch berechnet (gleicher Startwert = gleiches Ergebnis für alle).
import { CFG, species } from '../config.js';
import { hashString, mulberry32 } from '../rng.js';

const R = () => CFG.race;
const fail = (msg) => ({ ok: false, msg });
export const STATS = ['schoenheit', 'sprung', 'tempo', 'wendig'];
const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
const nameOf = (p) => p.nick || species(p.dex)?.name || '';

export const raceSpecies = () => R().species.filter((d) => species(d));
export const canRace = (dex) => raceSpecies().includes(dex);
export const stallMons = (s) => s.pokemon.filter((p) => p.stall).sort((a, b) => (a.box ?? 0) - (b.box ?? 0));
export const stallSize = () => R().stall.boxes.length;

// ---------- Uhr: Rennen täglich um race.hour Uhr (Zeitzone race.timeZone) ----------
function zoned(ms) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: R().race.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const P = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${P.year}-${P.month}-${P.day}`, sec: (+P.hour % 24) * 3600 + +P.minute * 60 + +P.second };
}
export const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const fmtDay = (day) => { const [y, m, d] = day.split('-'); return `${+d}.${+m}.${y}`; };
// entryDay = Rennen, für das man sich gerade anmeldet; lastDay = letztes schon gelaufenes Rennen
export function raceClock(ms) {
  const z = zoned(ms), start = R().race.hour * 3600, before = z.sec < start;
  return { today: z.day, entryDay: before ? z.day : addDays(z.day, 1), lastDay: before ? addDays(z.day, -1) : z.day, msToStart: ((start - z.sec + 86400) % 86400 || 86400) * 1000 };
}

// ---------- Stall ----------
function initProfile(p) {
  if (p.race) return;
  const [a, b] = R().stats.start;
  p.race = { ...Object.fromEntries(STATS.map((k) => [k, Math.round(a + Math.random() * (b - a))])), races: 0, wins: 0, places: [0, 0, 0, 0, 0], hist: [], care: {}, train: {} };
}
export function toStall(s, p) {
  if (!canRace(p.dex)) return fail('Dieses Pokémon kann keine Rennen laufen.');
  if (p.stall) return { ok: true };
  const used = new Set(stallMons(s).map((m) => m.box)), box = R().stall.boxes.findIndex((_, i) => !used.has(i));
  if (box < 0) return fail('Der Stall ist voll.');
  p.area = null; p.stall = true; p.box = box;
  initProfile(p);
  return { ok: true };
}
export function fromStall(s, p) {
  p.stall = undefined; p.box = undefined;
  return { ok: true };
}

// ---------- Pflege (Platzhalter-Aktionen aus race.json) ----------
const raise = (p, gains, k = 1) => { for (const [st, g] of Object.entries(gains || {})) p.race[st] = Math.min(R().stats.max, Math.round(((p.race[st] || 0) + g * k) * 10) / 10); };
export function careLeft(p, a, t) { const c = p.race?.care || {}; return c.day === raceClock(t).today ? a.perDay - (c.n?.[a.id] || 0) : a.perDay; }
export function careAction(s, p, id, t) {
  const a = R().care.actions.find((x) => x.id === id);
  if (!a || !p.race) return fail();
  if (careLeft(p, a, t) <= 0) return fail(`${nameOf(p)}: ${a.name} geht heute nicht mehr – morgen wieder.`);
  if (s.coins < (a.cost || 0)) return fail(`${a.name} kostet ${a.cost} Münzen.`);
  s.coins -= a.cost || 0;
  const day = raceClock(t).today;
  if (p.race.care.day !== day) p.race.care = { day, n: {} };
  p.race.care.n[a.id] = (p.race.care.n[a.id] || 0) + 1;
  raise(p, a.gains);
  return { ok: true, gains: a.gains };
}

// ---------- Sprungtraining ----------
export function trainLeft(p, t) { const tr = p.race?.train || {}; return R().training.perDay - (tr.day === raceClock(t).today ? tr.n || 0 : 0); }
// Werte des Pokémon für das Minispiel
export function trainingSetup(p) {
  const T = R().training, M = R().stats.max, st = p.race;
  return { delay: lerp(T.delayMs[0], T.delayMs[1], st.wendig / M) / 1000, jump: lerp(T.jump[0], T.jump[1], st.sprung / M), recover: lerp(T.recover[0], T.recover[1], st.tempo / M) };
}
export function finishTraining(s, p, ratio, t) {
  if (!p.race) return fail();
  if (trainLeft(p, t) <= 0) return fail('Heute ist kein Training mehr möglich.');
  const day = raceClock(t).today;
  if (p.race.train.day !== day) p.race.train = { day, n: 0 };
  p.race.train.n++;
  const before = { ...p.race };
  raise(p, R().training.gains, Math.max(0, Math.min(1, ratio)));
  return { ok: true, gains: Object.fromEntries(STATS.map((k) => [k, Math.round((p.race[k] - before[k]) * 10) / 10]).filter(([, v]) => v > 0)) };
}

// ---------- Anmeldung ----------
export function enterRace(s, p, t) {
  if (!p.stall || !p.race) return fail('Nur Pokémon aus dem Stall können starten.');
  const { entryDay } = raceClock(t);
  s.race ||= {}; s.race.entries ||= {};
  s.race.entries[entryDay] = { uid: p.uid, dex: p.dex, gender: p.gender || null, shiny: !!p.shiny, name: nameOf(p), stats: Object.fromEntries(STATS.map((k) => [k, p.race[k]])), at: t };
  const oldest = addDays(entryDay, -R().race.keepDays);
  for (const d of Object.keys(s.race.entries)) if (d < oldest) delete s.race.entries[d];
  for (const d of Object.keys(s.race.done || {})) if (d < oldest) delete s.race.done[d];
  return { ok: true, day: entryDay };
}
export function withdrawRace(s, t) {
  const { entryDay } = raceClock(t);
  if (s.race?.entries?.[entryDay]) delete s.race.entries[entryDay];
  return { ok: true };
}
export const myEntry = (s, t) => s.race?.entries?.[raceClock(t).entryDay] || null;
// gelaufene, noch nicht angesehene Rennen (älteste zuerst)
export function pendingRaces(s, t) {
  const last = raceClock(t).lastDay;
  return Object.keys(s.race?.entries || {}).filter((d) => d <= last && !s.race.done?.[d]).sort();
}

// ---------- Startfeld ----------
// entries: [{ key, me, trainer, sprite, entry }] aller Spielerinnen für den Tag. Je lanes Starter ein Lauf; leere Bahnen füllt der Computer.
export function buildField(day, entries) {
  const L = R().race.lanes, M = R().stats.max;
  const list = entries.filter((e) => e.entry && species(e.entry.dex)).sort((a, b) => hashString(day + '|' + a.key) - hashString(day + '|' + b.key) || (a.key < b.key ? -1 : 1));
  const meAt = Math.max(0, list.findIndex((e) => e.me)), heat = Math.floor(meAt / L);
  const humans = list.slice(heat * L, heat * L + L);
  const rnd = mulberry32(hashString(`feld|${day}|${heat}|${humans.map((e) => e.key).join(',')}`));
  const names = CFG.battle.names.filter((n) => !humans.some((e) => e.trainer === n));
  const runners = humans.map((e) => ({ key: e.key, me: !!e.me, trainer: e.trainer || 'Trainer', sprite: e.sprite || 1, ...e.entry }));
  const [a, b] = R().race.cpuStats, sp = raceSpecies();
  while (runners.length < L) {
    const dex = sp[Math.floor(rnd() * sp.length)], g = species(dex).genderRate;
    const trainer = names.splice(Math.floor(rnd() * names.length), 1)[0] || 'Trainer';
    runners.push({ key: 'cpu' + runners.length, cpu: true, trainer, sprite: 1 + Math.floor(rnd() * 80), dex, gender: g < 0 ? null : rnd() * 8 < g ? 'w' : 'm', shiny: false, name: species(dex).name,
      stats: Object.fromEntries(STATS.map((k) => [k, Math.min(M, Math.round(a + rnd() * (b - a)))])) });
  }
  for (let i = runners.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [runners[i], runners[j]] = [runners[j], runners[i]]; } // Bahnen auslosen
  return runners;
}

// ---------- Rennen berechnen ----------
// Ergebnis: tracks[i] = Positionen alle 0,1 s, events[i] = Sprünge ({ h, ok, t }), finish[i] = Zielzeit, place[i] = Platz (1 = Sieg)
export function simulateRace(day, runners) {
  const C = R().race, M = R().stats.max, dt = 0.05, rnd = mulberry32(hashString(`rennen|${day}|${runners.map((r) => r.key + ':' + r.dex).join(',')}`));
  const hurdles = Array.from({ length: C.hurdles }, (_, i) => Math.round((C.length * (i + 1)) / (C.hurdles + 1) * 10) / 10);
  const st = runners.map((r) => {
    const v = r.stats;
    return { x: 0, v: 0, mult: 1, noise: 1, next: 0, finish: null, track: [0], events: [],
      top: lerp(C.speed[0], C.speed[1], v.tempo / M) * (1 + (rnd() * 2 - 1) * C.form) * (1 + (C.beautyEffect || 0) * (v.schoenheit / M)),
      rec: lerp(C.recover[0], C.recover[1], v.tempo / M),
      pj: Math.min(C.jumpMax, C.jumpBase + (v.sprung / M) * C.jumpSprung + (v.wendig / M) * C.jumpWendig) };
  });
  let t = 0, step = 0;
  while (st.some((r) => r.finish == null) && t < 600) {
    t += dt; step++;
    for (const r of st) {
      if (r.finish != null) continue;
      if (step % 20 === 1) r.noise = 1 + (rnd() * 2 - 1) * C.noise;
      r.mult = Math.min(1, r.mult + r.rec * dt);
      r.v += (r.top * r.noise * r.mult - r.v) * Math.min(1, dt * 2.2);
      r.x += r.v * dt;
      if (r.next < hurdles.length && r.x >= hurdles[r.next] - 0.4) {
        const ok = rnd() < r.pj;
        r.events.push({ h: r.next, ok, t: Math.round(t * 100) / 100 });
        if (!ok) { r.mult = C.slow; r.v *= C.slow; }
        r.next++;
      }
      if (r.x >= C.length) r.finish = t - (r.x - C.length) / Math.max(0.1, r.v) + rnd() * 1e-4;
    }
    if (step % 2 === 0) for (const r of st) r.track.push(Math.round(Math.min(r.x, C.length + 3) * 100) / 100);
  }
  const order = st.map((_, i) => i).sort((a, b) => st[a].finish - st[b].finish);
  const place = []; order.forEach((i, k) => (place[i] = k + 1));
  return { hurdles, length: C.length, step: 0.1, tracks: st.map((r) => r.track), events: st.map((r) => r.events), finish: st.map((r) => Math.round(r.finish * 100) / 100), place, order };
}

// ---------- Wetten (zufällige Trainer setzen auf ein Pokémon) ----------
export function betsFor(day, runners) {
  const B = CFG.race.bets, M = R().stats.max, rnd = mulberry32(hashString(`wetten|${day}|${runners.map((r) => r.key).join(',')}`));
  const names = CFG.battle.names.filter((n) => !runners.some((r) => r.trainer === n));
  const w = runners.map((r) => 0.2 + (r.stats.sprung + r.stats.tempo + r.stats.wendig) / (3 * M) + (B.beautyWeight || 0) * (r.stats.schoenheit / M));
  return Array.from({ length: B.count }, () => {
    let x = rnd() * w.reduce((a, b) => a + b, 0), pick = 0;
    while ((x -= w[pick]) > 0 && pick < w.length - 1) pick++;
    const item = rnd() < B.itemChance;
    return { trainer: names.splice(Math.floor(rnd() * names.length), 1)[0] || 'Trainer', on: pick,
      stake: item ? B.items[Math.floor(rnd() * B.items.length)] : Math.round((B.coins[0] + rnd() * (B.coins[1] - B.coins[0])) / 10) * 10, item };
  });
}

// ---------- Ergebnis eintragen (Profil, Abzeichen) ----------
export function settleRace(s, day, runners, res) {
  s.race ||= {}; s.race.done ||= {}; s.race.badges ||= {};
  if (s.race.done[day]) return fail('Dieses Rennen ist schon ausgewertet.');
  const i = runners.findIndex((r) => r.me), place = res.place[i], entry = s.race.entries?.[day];
  const p = entry && s.pokemon.find((x) => x.uid === entry.uid);
  if (p?.race) {
    p.race.races++; if (place === 1) p.race.wins++;
    p.race.places[place - 1] = (p.race.places[place - 1] || 0) + 1;
    p.race.hist.unshift({ day, place, time: res.finish[i], field: runners.map((r) => r.name) });
    p.race.hist.length = Math.min(p.race.hist.length, 60);
  }
  s.race.done[day] = place;
  s.race.races = (s.race.races || 0) + 1; if (place === 1) s.race.wins = (s.race.wins || 0) + 1;
  const RW = R().rewards, got = [];
  const pb = RW.places[place - 1];
  if (pb) { s.race.badges[pb.id] = (s.race.badges[pb.id] || 0) + 1; got.push(pb); }
  for (const m of RW.milestones) if (!s.race.badges[m.id] && ((m.races && s.race.races >= m.races) || (m.wins && s.race.wins >= m.wins))) { s.race.badges[m.id] = 1; got.push(m); }
  const coins = RW.coins?.[place - 1] || 0;
  s.coins += coins;
  return { ok: true, place, badges: got, coins };
}
