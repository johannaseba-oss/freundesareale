// Alle Spieleraktionen. Jede Aktion verändert den Spielstand und gibt {ok, msg} zurück.
// Der Aufrufer (main.js) speichert danach automatisch in der Cloud.
import { CFG, areaById, berryById, isHairy } from '../config.js';
import { dayKey } from '../time.js';
import { capacityOf, residents, rollGender, ensureBattleData, newUid } from './state.js';
import { modsFor } from './bonuses.js';
import { coinRatePerHour, cycleCoins } from './sim.js';
import { dispenseBall, canForesee, revealActive } from './gacha.js';
import { trainContest } from './contest.js';
import { inheritStats } from './eggs.js';

const clamp = (v) => Math.max(0, Math.min(100, v));
const fail = (msg) => ({ ok: false, msg });

export function feed(s, p) {
  const n = CFG.balance.needs;
  if (p.fullness >= 99) return fail('Schon satt.');
  p.fullness = clamp(p.fullness + n.feedAmount);
  p.satisfaction = clamp(p.satisfaction + n.feedSatisfaction);
  p.affection = clamp(p.affection + n.feedAffection);
  return { ok: true };
}

// Streicheln/Betüdeln: verbessert die Stimmung sofort, der Effekt hält einen Tag (dann zählen wieder Areal & Mitbewohner).
// Zuneigung steigt bis zum Tageslimit.
export function pet(s, p, t) {
  const n = CFG.balance.needs, P = CFG.social.pet;
  const day = dayKey(t);
  if (p.pet.day !== day) p.pet = { day, amount: 0 };
  const cur = p.petBoost && p.petBoost.until > t ? p.petBoost.value : 0;
  p.petBoost = { value: Math.min(P.maxBoost, cur + P.moodPerPet), until: t + P.hours * 3600e3 };
  const gain = Math.min(n.petAffection, Math.max(0, n.petAffectionPerDayMax - p.pet.amount));
  p.pet.amount += gain;
  p.affection = clamp(p.affection + gain);
  return { ok: true, affectionGain: gain, contest: trainContest(p, 'streicheln', t) };
}

export function collectCoins(s, list) {
  let total = 0;
  const berries = {}, dropped = [];
  const drop = CFG.balance.berryDrop;
  for (const p of list) {
    // seltene Beere, wenn das Pokémon Münzen abgibt
    if (p.coinsReady > 0 && drop && Math.random() < drop.chance) { s.berries[drop.berry] = (s.berries[drop.berry] || 0) + 1; dropped.push({ uid: p.uid, berry: drop.berry }); }
    total += p.coinsReady; p.coinsReady = 0; p.coinBatches = 0;
    if (p.coinProgress >= 1) p.coinProgress = 0; // pausierter Takt startet neu
    for (const [id, n] of Object.entries(p.berriesReady || {})) { berries[id] = (berries[id] || 0) + n; s.berries[id] = (s.berries[id] || 0) + n; }
    p.berriesReady = {};
  }
  s.coins += total;
  s.stats.coinsEarned += total;
  const berryCount = Object.values(berries).reduce((x, y) => x + y, 0);
  return { ok: total > 0 || berryCount > 0 || dropped.length > 0, total, berries, berryCount, dropped };
}

export function giveBerry(s, p, berryId, t) {
  const b = berryById(berryId);
  if (!p.area) return fail('Beeren wirken nur bei Pokémon in einem Areal.');
  if (p.fullness >= 99 && b.effect !== 'produktion') return fail('Ist gerade satt.');
  // zuerst aus dem Inventar, sonst mit Glücksmünzen kaufen
  if ((s.berries[b.id] || 0) > 0) s.berries[b.id]--;
  else if (b.buyable === false) return fail(`Keine ${b.name} im Beutel.`);
  else if (s.coins < b.cost) return fail('Keine im Inventar und nicht genug Glücksmünzen.');
  else s.coins -= b.cost;
  p.fullness = clamp(p.fullness + (b.hunger || 0));
  if (b.effect === 'zeitsprung') {
    p.coinProgress += coinRatePerHour(p, t, modsFor(s, p)) * b.hours;
    const maxB = CFG.balance.coins.maxBatchesReady || 1;
    while (p.coinProgress >= 1 && (p.coinBatches || 0) < maxB) { p.coinProgress -= 1; p.coinBatches = (p.coinBatches || 0) + 1; p.coinsReady += cycleCoins(p); p.coinCycles = (p.coinCycles || 0) + 1; }
    if ((p.coinBatches || 0) >= maxB) p.coinProgress = Math.min(1, p.coinProgress);
  } else if (b.effect === 'produktion') {
    const existing = p.effects.find((e) => e.berry === b.id && e.until > t);
    if (existing) existing.until += b.hours * 3600e3; // gleiche Beere verlängert die Dauer
    else p.effects.push({ type: 'produktion', berry: b.id, factor: b.factor, until: t + b.hours * 3600e3 });
  }
  return { ok: true };
}

// Alle Beeren einer Sorte verteilen: immer an das gerade hungrigste Pokémon in einem Areal,
// bis keine Beeren mehr da sind oder alle satt sind
export function feedAll(s, t, berryId = 'sinelbeere') {
  const name = berryById(berryId).name;
  if (!(s.berries[berryId] > 0)) return fail(`Keine ${name} im Beutel.`);
  let used = 0;
  const who = new Set();
  while (s.berries[berryId] > 0) {
    const p = s.pokemon.filter((q) => q.area && q.fullness < 99).sort((a, b) => a.fullness - b.fullness)[0];
    if (!p || !giveBerry(s, p, berryId, t).ok) break;
    used++;
    who.add(p.uid);
  }
  if (!used) return fail('Alle Pokémon in deinen Arealen sind satt.');
  return { ok: true, used, pokemon: who.size, left: s.berries[berryId] || 0 };
}

// „Alle füttern“: alle hungrigen Pokémon in Arealen mit Beeren aus dem Inventar versorgen
// (Sorte für Sorte in der Reihenfolge der Beerenliste, nur vorhandene Beeren – es wird nichts gekauft)
export function feedAllInventory(s, t) {
  const hungry = () => s.pokemon.some((q) => q.area && q.fullness < 99);
  if (!hungry()) return fail('Alle Pokémon in deinen Arealen sind satt.');
  if (!CFG.balance.berries.some((b) => s.berries[b.id] > 0)) return fail('Keine Beeren im Beutel.');
  const used = {}, fed = new Map(); // fed: Pokémon -> zuletzt gegebene Beere (für die Fress-Animation)
  for (const b of CFG.balance.berries) {
    while (s.berries[b.id] > 0 && hungry()) {
      const p = s.pokemon.filter((q) => q.area && q.fullness < 99).sort((a, c) => a.fullness - c.fullness)[0];
      if (!giveBerry(s, p, b.id, t).ok) break;
      used[b.id] = (used[b.id] || 0) + 1;
      fed.set(p.uid, b.id);
    }
  }
  return { ok: true, used, fed, pokemon: fed.size };
}

// ---- Route: EP-Konto und dauerhaftes Training ----
export function addRouteEp(s, n) { s.route ||= { ep: 0, cleared: 0 }; s.route.ep += Math.max(0, Math.round(n)); return { ok: true }; }
export function routeCleared(s, n) { s.route ||= { ep: 0, cleared: 0 }; const first = n > (s.route.cleared || 0); s.route.cleared = Math.max(s.route.cleared || 0, n); return { ok: true, first }; }
// +1 Level gegen EP: Kosten steigen mit dem Level, höchstens dailyPerPokemon Aufstiege pro Pokémon und Tag
export function trainLevel(s, p, t, cost, dayKey) {
  const U = CFG.route.upgrade;
  s.route ||= { ep: 0, cleared: 0 };
  if (p.level >= CFG.balance.level.max) return fail('Schon auf dem Höchstlevel.');
  if (s.route.day !== dayKey) { s.route.day = dayKey; s.route.today = {}; }
  const done = s.route.today[p.uid] || 0;
  if (done >= U.dailyPerPokemon) return fail(`Heute schon ${U.dailyPerPokemon}× trainiert – morgen geht es weiter.`);
  if (s.route.ep < cost) return fail(`Zu wenig EP (${cost} nötig, du hast ${s.route.ep}).`);
  s.route.ep -= cost;
  s.route.today[p.uid] = done + 1;
  p.trainLevels = (p.trainLevels || 0) + 1;
  p.level = Math.min(CFG.balance.level.max, p.level + 1);
  return { ok: true, level: p.level };
}

export function assign(s, p, areaId) {
  if (areaId) {
    if (!s.areas[areaId]?.unlocked) return fail('Dieses Areal ist noch nicht freigeschaltet.');
    if (p.area !== areaId && residents(s, areaId).length >= capacityOf(s, areaId)) return fail('Das Areal ist voll. Vergrößere es oder wähle ein anderes.');
  }
  p.area = areaId || null;
  return { ok: true };
}

export function unlockArea(s, areaId) {
  const a = areaById(areaId);
  if (s.areas[areaId].unlocked) return fail('Schon freigeschaltet.');
  if (s.coins < a.unlockCost) return fail('Nicht genug Glücksmünzen.');
  s.coins -= a.unlockCost;
  s.areas[areaId].unlocked = true;
  return { ok: true };
}

export function upgradeArea(s, areaId) {
  const a = areaById(areaId), st = s.areas[areaId];
  if (st.level >= a.capacity.length - 1) return fail('Höchste Ausbaustufe erreicht.');
  const cost = a.upgradeCost[st.level];
  if (s.coins < cost) return fail('Nicht genug Glücksmünzen.');
  s.coins -= cost;
  st.level++;
  return { ok: true };
}

// key = der Ball, den die Physik im Automaten in den Ausgabeschacht befördert hat
export function draw(s, t, key) {
  const cost = CFG.balance.gacha.drawCost;
  if (!s.gacha?.machine?.length) return fail('Der Automat ist für diese Woche leer.');
  const free = freeDrawReady(s, t);
  if (!free && s.coins < cost) return fail('Nicht genug Glücksmünzen.');
  const ball = dispenseBall(s, key);
  if (free) s.freeDrawAt = t + CFG.balance.gacha.freeDrawEveryHours * 3600e3;
  else s.coins -= cost;
  s.stats.draws++;
  const p = {
    uid: newUid(s, t), dex: ball.dex, ball: ball.ball, drawKey: ball.key, paid: free ? 0 : cost, caughtAt: t, area: null,
    level: 1, xp: 0, fullness: CFG.balance.newPokemon.fullness, satisfaction: CFG.balance.newPokemon.satisfaction, affection: CFG.balance.newPokemon.affection,
    gender: rollGender(ball.dex), cleanliness: isHairy(ball.dex) ? CFG.grooming.startCleanliness : undefined, coinProgress: 0, coinsReady: 0, berryProgress: 0, berriesReady: {}, effects: [], pet: { day: '', amount: 0 },
  };
  ensureBattleData(p);
  s.pokemon.push(p);
  if (!s.dexOwned.includes(p.dex)) s.dexOwned.push(p.dex);
  return { ok: true, pokemon: p, ball, free };
}

// Ei ausbrüten: neues Exemplar im Beutel, mit vererbten/verbesserten Werten
export function hatchEgg(s, eggId, t) {
  const i = s.eggs.list.findIndex((e) => e.id === eggId);
  if (i < 0) return fail();
  const egg = s.eggs.list[i];
  if (t < egg.hatchAt) return fail('Das Ei braucht noch etwas Zeit.');
  const { ivs, evs } = inheritStats(s, egg);
  s.eggs.list.splice(i, 1);
  const N = CFG.balance.newPokemon;
  const p = {
    uid: newUid(s, t), dex: egg.dex, ball: 'pokeball', fromEgg: true, caughtAt: t, area: null,
    level: 1, xp: 0, fullness: N.fullness, satisfaction: N.satisfaction, affection: N.affection,
    gender: rollGender(egg.dex), cleanliness: isHairy(egg.dex) ? CFG.grooming.startCleanliness : undefined, coinProgress: 0, coinsReady: 0, berryProgress: 0, berriesReady: {}, effects: [], pet: { day: '', amount: 0 },
    ivs, evs,
  };
  ensureBattleData(p);
  s.pokemon.push(p);
  if (!s.dexOwned.includes(p.dex)) s.dexOwned.push(p.dex);
  s.stats.eggsHatched = (s.stats.eggsHatched || 0) + 1;
  return { ok: true, pokemon: p };
}

export function setNick(s, p, name) {
  p.nick = String(name || '').trim().slice(0, CFG.balance.nickMaxLength || 14) || undefined;
  return { ok: true };
}
export function setProfile(s, name, sprite) {
  s.profile = { name: String(name || '').trim().slice(0, 16), sprite };
  return { ok: true };
}

// Cloud-Stand nachladen, ohne lokal gezogene, noch nicht gespeicherte Pokémon zu verlieren
// (z. B. wenn auf einem zweiten Gerät gleichzeitig gespeichert wurde). Erkennung über Art + Fangzeitpunkt.
export function mergeUnsavedPokemon(local, cloud) {
  const id = (p) => `${p.dex}|${p.caughtAt}`;
  const have = new Set(cloud.pokemon.map(id));
  let n = 0;
  for (const p of local.pokemon) {
    if (have.has(id(p))) continue;
    const q = JSON.parse(JSON.stringify(p));
    if (cloud.pokemon.some((c) => c.uid === q.uid)) q.uid = newUid(cloud, q.caughtAt);
    cloud.pokemon.push(q);
    if (q.drawKey != null && cloud.gacha?.machine?.some((b) => b.key === q.drawKey)) dispenseBall(cloud, q.drawKey);
    if (q.paid) cloud.coins = Math.max(0, cloud.coins - q.paid);
    else cloud.freeDrawAt = Math.max(cloud.freeDrawAt || 0, local.freeDrawAt || 0);
    cloud.stats.draws = Math.max(cloud.stats.draws || 0, local.stats?.draws || 0);
    n++;
  }
  return n;
}

// Gratis-Ziehung: steht alle paar Stunden (balance.json gacha.freeDrawEveryHours) wieder bereit
export const freeDrawReady = (s, t) => !s.freeDrawAt || t >= s.freeDrawAt;
export const canDraw = (s, t) => !!s.gacha?.machine?.length && (freeDrawReady(s, t) || s.coins >= CFG.balance.gacha.drawCost);

// Psycho-Blick: ein sehr glückliches Psycho-Pokémon deckt für einen Tag den Inhalt zufälliger Bälle im Automaten auf.
// Ändert nichts am Inhalt oder an der Reihenfolge – nur die Sichtbarkeit.
export function foresee(s, p, t) {
  const P = CFG.balance.gacha.psychic;
  if (!canForesee(p, t)) return fail('Nur sehr glückliche Psycho-Pokémon in einem Areal können das.');
  if (revealActive(s, t)) return fail('Der Psycho-Blick wirkt noch.');
  const keys = s.gacha.machine.map((x) => x.key);
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  s.gacha.reveal = { keys: keys.slice(0, P.revealCount), until: t + P.hours * 3600e3, by: p.uid };
  return { ok: true };
}

// Ballpositionen im Automaten speichern (nach dem Zur-Ruhe-Kommen)
export function storeBallPositions(s, list) {
  const pos = new Map(list.map((b) => [b.key, b]));
  for (const m of s.gacha.machine) { const q = pos.get(m.key); if (q) { m.x = Math.round(q.x); m.y = Math.round(q.y); m.a = Math.round((q.a ?? 0) * 100) / 100; } }
  return { ok: true };
}

// Beere vom Boden eines Areals aufsammeln
// alle Beeren, die in den Arealen am Boden liegen, auf einmal einsammeln
export function pickAllGround(s) {
  const picked = [];
  for (const [areaId, st] of Object.entries(s.areas)) {
    if (!st.unlocked || !st.ground?.length) continue;
    for (const g of st.ground) { s.berries[g.berry] = (s.berries[g.berry] || 0) + 1; picked.push({ areaId, id: g.id, berry: g.berry }); }
    st.ground = [];
  }
  return { ok: picked.length > 0, picked };
}

export function pickGroundBerry(s, areaId, id) {
  const st = s.areas[areaId], i = (st.ground || []).findIndex((g) => g.id === id);
  if (i < 0) return fail();
  const g = st.ground.splice(i, 1)[0];
  s.berries[g.berry] = (s.berries[g.berry] || 0) + 1;
  return { ok: true, berry: g.berry };
}

// Putz-Minispiel geschafft: Sauberkeit voll, Zufriedenheit etwas höher, Stimmung (wie beim Betüdeln, hält einen Tag) höher
// frac = entfernter Anteil des Schmutzes (0-1); ab 90 % gilt es als geschafft, sonst wird es nur anteilig sauberer
export function groomed(s, p, t, frac = 1) {
  if (!isHairy(p.dex)) return fail();
  const R = CFG.grooming.reward, P = CFG.social.pet;
  if (frac < 0.9) { p.cleanliness = clamp(p.cleanliness + frac * (R.cleanliness - p.cleanliness)); return { ok: true, partial: true }; }
  p.cleanliness = R.cleanliness;
  p.satisfaction = clamp(p.satisfaction + R.satisfaction);
  p.shineUntil = t + (CFG.grooming.shineHours || 1) * 3600e3; // glänzt eine Stunde lang im Areal
  const cur = p.petBoost && p.petBoost.until > t ? p.petBoost.value : 0;
  p.petBoost = { value: Math.min(P.maxBoost, cur + R.mood), until: t + P.hours * 3600e3 };
  s.stats.grooms = (s.stats.grooms || 0) + 1;
  return { ok: true, contest: trainContest(p, 'putzen', t) };
}
