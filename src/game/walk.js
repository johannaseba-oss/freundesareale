// Spaziergang (wie bei Nintendogs): Zufallskarte, eingezeichnete Route (Start → … → Start), umherwandernde wilde Pokémon
// und klassische Rundenkämpfe mit den Attacken, die die Pokémon auf ihrem Level offiziell beherrschen. Werte in walk.json.
import { CFG, species } from '../config.js';
import { itemDamageMult, itemById } from './items.js';
import { bdata, calcStats } from './battle.js';
import { effectiveness } from './types.js';
import { speedOf } from './rocks.js';
import { dayKey } from '../time.js';

const W = () => CFG.walk;
const between = (rnd, [a, b]) => a + rnd() * (b - a);
const ibetween = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1));

export const maxSteps = (p) => W().stepsByStamina[(p.stamina || 1) - 1];
export const walkSpeed = (p) => W().speedBySpeed[speedOf(p).level - 1];
export const walkedToday = (s, uid, t) => (s.walk?.done?.[uid] || []).filter((d) => d === dayKey(t)).length >= W().walksPerDay;

// ---- Karte: 'W' Wald, 'A' Wasser, 'P' Weg, 'T' hohes Gras (dort leben die wilden Pokémon), 'C' Startplatz, 'F' Wiese ----
export function makeMap(rnd, theme = null) {
  const { cols, rows } = W().grid, M = W().map;
  const g = Array.from({ length: rows }, () => Array(cols).fill('F'));
  const home = [Math.floor(cols / 2), rows - 4];
  const inside = (x, y) => x > 1 && y > 1 && x < cols - 2 && y < rows - 2;
  const nearHome = (x, y) => Math.abs(x - home[0]) <= 2 && Math.abs(y - home[1]) <= 2;
  // Waldrand: zwei Felder breit, innen unregelmäßig
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const d = Math.min(x, y, cols - 1 - x, rows - 1 - y);
    if (d < 2 || (d === 2 && rnd() < 0.35)) g[y][x] = 'W';
  }
  // Flecken mit 2×2-Pinsel (sieht mit den Autotiles am besten aus)
  const blob = (kind, size, avoid = []) => {
    let x = 3 + Math.floor(rnd() * (cols - 7)), y = 3 + Math.floor(rnd() * (rows - 9));
    for (let i = 0; i < size; i++) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (inside(nx, ny) && !nearHome(nx, ny) && !avoid.includes(g[ny][nx])) g[ny][nx] = kind;
      }
      const d = Math.floor(rnd() * 4); x += [1, -1, 0, 0][d]; y += [0, 0, 1, -1][d];
      x = Math.max(2, Math.min(cols - 4, x)); y = Math.max(2, Math.min(rows - 6, y));
    }
  };
  for (let i = ibetween(rnd, M.ponds); i > 0; i--) blob('A', ibetween(rnd, M.pondSize));
  for (let i = ibetween(rnd, M.treeBlobs); i > 0; i--) blob('W', ibetween(rnd, M.blobSize), ['A']);
  for (let i = ibetween(rnd, M.tallPatches); i > 0; i--) blob('T', ibetween(rnd, M.tallSize), ['A', 'W']);
  // Startplatz (gepflastert) unten in der Mitte
  for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) g[home[1] + dy][home[0] + dx] = 'C';
  // Wege vom Startplatz zu ein paar Zielen (Schlangenlinien), nur über Wiese und Gras
  for (let i = ibetween(rnd, M.paths); i > 0; i--) {
    let [x, y] = [home[0], home[1] - 2];
    const tx = 3 + Math.floor(rnd() * (cols - 6)), ty = 3 + Math.floor(rnd() * (rows / 2));
    for (let k = 0; k < 80 && (x !== tx || y !== ty); k++) {
      if (g[y][x] === 'F' || g[y][x] === 'T') g[y][x] = 'P';
      const horiz = rnd() < (Math.abs(tx - x) / (Math.abs(tx - x) + Math.abs(ty - y) + 0.01));
      const nx = horiz ? x + Math.sign(tx - x) : x, ny = horiz ? y : y + Math.sign(ty - y);
      if (!inside(nx, ny) || g[ny][nx] === 'A' || g[ny][nx] === 'W') break;
      x = nx; y = ny;
    }
  }
  // nicht erreichbare Felder werden zu Wald
  const seen = new Set([home.join()]), q = [home];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (walkableCell(g[ny]?.[nx]) && !seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (walkableCell(g[y][x]) && !seen.has(x + ',' + y)) g[y][x] = 'W';
  const th = theme || M.themes[Math.floor(rnd() * M.themes.length)];
  return { cols, rows, g, home, theme: th, free: [...seen].map((k) => k.split(',').map(Number)) };
}
const walkableCell = (t) => t === 'F' || t === 'P' || t === 'T' || t === 'C';
export const walkable = (map, x, y) => walkableCell(map.g[y]?.[x]);
export const cellOf = (map, x, y) => map.g[y]?.[x] || 'W';

// ---- Attacken nach offiziellem Regelwerk: die (bis zu) vier zuletzt per Level gelernten Attacken (data/learnsets.json) ----
let LS = null;
export async function loadLearnsets() {
  if (!LS) LS = await fetch(`${import.meta.env.BASE_URL}data/learnsets.json`, { cache: 'no-cache' }).then((r) => r.json());
  return LS;
}
export const moveData = (id) => LS?.moves[id];
export function movesAtLevel(dex, level) {
  const all = LS?.learn[dex] || [], list = all.filter(([lv]) => lv <= Math.max(1, level));
  const out = list.slice(-4).map(([, id]) => id);
  return out.length ? out : all.slice(0, 1).map(([, id]) => id);
}

// Kämpfer für den Rundenkampf (offizielle Werteformel; Statusstufen −6…+6, Zustand, Verwirrung)
export function makeFighter(src, level) {
  const stats = calcStats(src.dex, level, src.ivs || [15, 15, 15, 15, 15, 15], src.evs || [0, 0, 0, 0, 0, 0]);
  return { uid: src.uid ?? null, dex: src.dex, gender: src.gender ?? null, nick: src.nick || null, level, stats, hp: stats[0], maxHp: stats[0], moves: movesAtLevel(src.dex, level), pbuff: src.pbuff || 1, item: src.item || null, itemName: src.itemName || null,
    stage: [0, 0, 0, 0, 0, 0, 0, 0, 0], status: null, sleep: 0, confused: 0 };
}

// ---- wilde Pokémon ----
export function wildPool(theme, level = 1) {
  const types = W().wild.themeTypes[theme] || [], MS = W().wild.maxStage || {};
  const stage = Math.max(1, ...Object.entries(MS).filter(([k]) => k[0] !== '_' && level >= +k).map(([, v]) => v));
  const ok = CFG.dex.filter((s) => s.rarity !== 'legendaer' && bdata(s.dex) && (s.stage || 1) <= stage);
  const fit = ok.filter((s) => s.types.some((t) => types.includes(t)));
  return (fit.length ? fit : ok).map((s) => s.dex);
}
export function spawnWild(map, rnd, playerLevel) {
  const out = [], n = ibetween(rnd, W().wild.count);
  const far = map.free.filter(([x, y]) => Math.abs(x - map.home[0]) + Math.abs(y - map.home[1]) > 5);
  const grass = far.filter(([x, y]) => map.g[y][x] === 'T');
  for (let i = 0; i < n && far.length; i++) {
    const pool0 = grass.length && rnd() < W().wild.inGrass ? grass : far;
    const [x, y] = pool0.splice(Math.floor(rnd() * pool0.length), 1)[0];
    const level = Math.max(W().wild.minLevel, playerLevel + ibetween(rnd, W().wild.levelOffset));
    const pool = wildPool(map.theme, level), dex = pool[Math.floor(rnd() * pool.length)];
    out.push({ id: i + 1, dex, level, cx: x, cy: y, x, y, fx: x, fy: y, k: 1, next: between(rnd, W().wild.stepEvery), dir: 0, ignore: 0, gone: false });
  }
  return out;
}
// ein Schritt der wilden Pokémon: zufälliges freies Nachbarfeld (im hohen Gras bleiben sie meist im Gras), weich überblendet
export function moveWild(map, wild, dt, rnd) {
  for (const w of wild) {
    if (w.gone) continue;
    w.next -= dt;
    if (w.k < 1) { w.k = Math.min(1, w.k + dt * 2.2); w.x = w.fx + (w.cx - w.fx) * w.k; w.y = w.fy + (w.cy - w.fy) * w.k; }
    if (w.next > 0 || w.k < 1) continue;
    w.next = between(rnd, W().wild.stepEvery);
    let opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => walkable(map, w.cx + dx, w.cy + dy) && map.g[w.cy + dy][w.cx + dx] !== 'C');
    if (map.g[w.cy][w.cx] === 'T' && rnd() < W().wild.stayInGrass) { const inG = opts.filter(([dx, dy]) => map.g[w.cy + dy][w.cx + dx] === 'T'); if (inG.length) opts = inG; }
    if (!opts.length) continue;
    const [dx, dy] = opts[Math.floor(rnd() * opts.length)];
    w.fx = w.cx; w.fy = w.cy; w.cx += dx; w.cy += dy; w.k = 0;
    w.dir = dx > 0 ? 2 : dx < 0 ? 6 : dy > 0 ? 0 : 4;
  }
}

// ---- Rundenkampf nach den Hauptspiel-Regeln (vereinfacht: keine AP, keine Fähigkeiten/Items) ----
// Reihenfolge nach Priorität, dann Initiative; Schaden mit offizieller Formel (Volltreffer, STAB, Typen, Zufall 85–100 %),
// Statuswert-Stufen, Zustände (Paralyse, Schlaf, Gefroren, Verbrennung, Gift), Verwirrung, Zurückschrecken, Heilen/Saugen, Mehrfachtreffer.
const STAT_NAME = [null, 'Angriff', 'Verteidigung', 'Spezial-Angriff', 'Spezial-Verteidigung', 'Initiative', 'Genauigkeit', 'Ausweichwert'];
const stageMult = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const accMult = (s) => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));
const AIL = { 1: 'par', 2: 'slp', 3: 'frz', 4: 'brn', 5: 'psn', 6: 'conf' };
const AIL_TEXT = { par: 'ist paralysiert! Es kann eventuell nicht angreifen.', slp: 'ist eingeschlafen!', frz: 'wurde eingefroren!', brn: 'hat sich verbrannt!', psn: 'wurde vergiftet!', conf: 'ist verwirrt!' };
const IMMUNE = { par: ['Elektro'], brn: ['Feuer'], frz: ['Eis'], psn: ['Gift', 'Stahl'] };
export const STATUS_TAG = { par: 'PAR', slp: 'SLF', frz: 'GFR', brn: 'BRT', psn: 'GIF' };
const speedOfF = (f) => f.stats[5] * stageMult(f.stage[5]) * (f.status === 'par' ? 0.5 : 1) * (f.item?.speedMult || 1);
const nameOf = (f, who) => (who === 'w' ? 'Das wilde ' : '') + (f.nick || species(f.dex).name);
const other = (who) => (who === 'p' ? 'w' : 'p');
const ofName = (f, who) => (who === 'w' ? 'des wilden ' : 'von ') + (f.nick || species(f.dex).name); // „Angriff des wilden Bisasam“
const inName = (f, who) => (who === 'w' ? 'das wilde ' : '') + (f.nick || species(f.dex).name); // mitten im Satz

export function battleTurn(me, foe, choice, rnd) {
  const steps = [], F = { p: me, w: foe };
  const say = (text, extra = {}) => steps.push({ text, ...extra });
  const faintCheck = (who) => { if (F[who].hp <= 0) { say(`${nameOf(F[who], who)} wurde besiegt!`, { faint: who }); return true; } return false; };
  const applyAilment = (who, ail, fromStatusMove) => {
    const d = F[who], k = AIL[ail];
    if (!k) { if (fromStatusMove) say('Aber es passierte nichts …'); return; }
    if (k === 'conf') { if (d.confused > 0) { if (fromStatusMove) say(`${nameOf(d, who)} ist bereits verwirrt.`); return; } d.confused = 2 + Math.floor(rnd() * 4); say(`${nameOf(d, who)} ${AIL_TEXT.conf}`); return; }
    if (d.status || species(d.dex).types.some((t) => IMMUNE[k]?.includes(t))) { if (fromStatusMove) say('Es hat keine Wirkung …'); return; }
    d.status = k; if (k === 'slp') d.sleep = 1 + Math.floor(rnd() * 3);
    say(`${nameOf(d, who)} ${AIL_TEXT[k]}`, { status: who, value: k });
  };
  const applyStats = (who, list) => {
    const d = F[who];
    for (const [stat, ch] of list) {
      const i = stat - 1; if (i < 1 || i > 7) continue;
      const before = d.stage[i]; d.stage[i] = Math.max(-6, Math.min(6, before + ch));
      const s = STAT_NAME[i], n = ofName(d, who);
      if (d.stage[i] === before) say(`${s} ${n} kann nicht weiter ${ch > 0 ? 'steigen' : 'sinken'}!`);
      else say(`${s} ${n} ${ch > 0 ? 'steigt' : 'sinkt'}${Math.abs(ch) >= 2 ? (ch > 0 ? ' stark' : ' stark') : ''}!`);
    }
  };
  const damage = (a, d, mv, crit) => {
    const phys = mv.cat === 'phys', ai = phys ? 1 : 3, di = phys ? 2 : 4;
    const as = crit ? Math.max(0, a.stage[ai]) : a.stage[ai], ds = crit ? Math.min(0, d.stage[di]) : d.stage[di];
    const A = a.stats[ai] * stageMult(as) * (phys ? a.pbuff || 1 : 1), D = d.stats[di] * stageMult(ds);
    const eff = mv.type === '???' ? 1 : effectiveness(mv.type, species(d.dex).types);
    let dmg = Math.floor(Math.floor((Math.floor((2 * a.level) / 5 + 2) * mv.power * A) / D) / 50) + 2;
    dmg *= itemDamageMult(a.item, mv, eff) * (crit ? 1.5 : 1) * (0.85 + rnd() * 0.15) * (species(a.dex).types.includes(mv.type) ? 1.5 : 1) * eff * (phys && a.status === 'brn' ? 0.5 : 1);
    return { dmg: eff ? Math.max(1, Math.floor(dmg)) : 0, eff };
  };
  // eine Aktion; first = hat zuerst gehandelt (für Zurückschrecken)
  const act = (who, id, first) => {
    const a = F[who], dw = other(who), d = F[dw], mv = moveData(id);
    if (a.flinch) { a.flinch = false; say(`${nameOf(a, who)} schreckt zurück!`); return; }
    if (a.status === 'slp') { if (--a.sleep > 0) { say(`${nameOf(a, who)} schläft tief und fest.`); return; } a.status = null; say(`${nameOf(a, who)} ist aufgewacht!`, { status: who, value: null }); }
    if (a.status === 'frz') { if (rnd() < 0.2) { a.status = null; say(`${nameOf(a, who)} ist wieder aufgetaut!`, { status: who, value: null }); } else { say(`${nameOf(a, who)} ist gefroren!`); return; } }
    if (a.status === 'par' && rnd() < 0.25) { say(`${nameOf(a, who)} ist paralysiert! Es kann nicht angreifen!`); return; }
    if (a.confused > 0) {
      if (--a.confused <= 0) say(`${nameOf(a, who)} ist nicht mehr verwirrt!`);
      else {
        say(`${nameOf(a, who)} ist verwirrt!`);
        if (rnd() < 1 / 3) { const r = damage(a, a, { power: 40, cat: 'phys', type: '???' }, false); a.hp = Math.max(0, a.hp - r.dmg); say('Es hat sich vor Verwirrung selbst verletzt!', { hit: who, dmg: r.dmg, eff: 1, hp: a.hp }); faintCheck(who); return; }
      }
    }
    if (!mv) { say(`${nameOf(a, who)} weiß nicht, was es tun soll …`); return; }
    say(`${nameOf(a, who)} setzt ${mv.name} ein!`, { who, key: id });
    const m = mv.m || {};
    if (mv.acc && !mv.self && rnd() * 100 >= mv.acc * accMult(a.stage[6] - d.stage[7])) { say(`Die Attacke ${ofName(a, who)} ging daneben!`); return; }
    if (mv.power > 0) {
      const hits = m.hits ? m.hits[0] + Math.floor(rnd() * (m.hits[1] - m.hits[0] + 1)) : 1;
      let total = 0, n = 0, lastEff = 1;
      for (let i = 0; i < hits && d.hp > 0; i++) {
        const crit = rnd() < [1 / 24, 1 / 8, 1 / 2, 1][Math.min(3, (m.crit || 0) + (a.item?.critAdd || 0))];
        const r = damage(a, d, mv, crit); lastEff = r.eff;
        if (!r.eff) { say(`Es hat keine Wirkung auf ${inName(d, dw)} …`); return; }
        let dmg = r.dmg;
        if (d.item?.sash && !d.sashUsed && d.hp === d.maxHp && dmg >= d.hp) { dmg = d.hp - 1; d.sashUsed = true; }
        d.hp = Math.max(0, d.hp - dmg); total += dmg; n++;
        say(crit ? 'Ein Volltreffer!' : null, { hit: dw, dmg, eff: r.eff, hp: d.hp });
        if (d.sashUsed === true && d.hp === 1) { d.sashUsed = 'done'; say(`${nameOf(d, dw)} hält mit dem Fokusgurt durch!`); }
      }
      if (lastEff > 1) say('Das ist sehr effektiv!'); else if (lastEff < 1) say('Das ist nicht sehr effektiv …');
      if (hits > 1) say(`Getroffen: ${n}-mal!`);
      if (m.drain) { // positiv = Saugen, negativ = Rückstoß
        const ch = Math.max(1, Math.floor((total * Math.abs(m.drain)) / 100));
        a.hp = m.drain > 0 ? Math.min(a.maxHp, a.hp + ch) : Math.max(0, a.hp - ch);
        say(m.drain > 0 ? `${inName(d, dw).replace(/^./, (c) => c.toUpperCase())} wurde Energie abgesaugt!` : `${nameOf(a, who)} wird durch den Rückstoß getroffen!`, { set: who, hp: a.hp });
      }
      // Items: Muschelglocke heilt, Leben-Orb kostet KP, Beulenhelm trifft Angreifer bei Körperkontakt
      if (a.item?.lifesteal && total > 0 && a.hp > 0 && a.hp < a.maxHp) { a.hp = Math.min(a.maxHp, a.hp + Math.max(1, Math.floor(total * a.item.lifesteal))); say(`${nameOf(a, who)} wird durch ${a.itemName || 'sein Item'} geheilt.`, { set: who, hp: a.hp }); }
      if (a.item?.recoil && total > 0 && a.hp > 0) { a.hp = Math.max(0, a.hp - Math.max(1, Math.floor(a.maxHp * a.item.recoil))); say(`${nameOf(a, who)} verliert durch ${a.itemName || 'sein Item'} etwas KP.`, { hit: who, dmg: 1, eff: 1, hp: a.hp }); }
      if (d.item?.helmet && mv.cat === 'phys' && a.hp > 0) { a.hp = Math.max(0, a.hp - Math.max(1, Math.floor(a.maxHp * d.item.helmet))); say(`${nameOf(a, who)} verletzt sich am ${d.itemName || 'Item'}!`, { hit: who, dmg: 1, eff: 1, hp: a.hp }); }
      if (faintCheck(dw)) { if (a.hp <= 0) faintCheck(who); return; }
      if (a.hp <= 0 && faintCheck(who)) return;
      if (first && ((m.flinch && rnd() * 100 < m.flinch) || (a.item?.flinch && rnd() < a.item.flinch))) d.flinch = true;
      if (m.ail && (m.c === 4 || m.c === 0) && rnd() * 100 < (m.ailP || 0)) applyAilment(dw, m.ail, false);
      if (m.stats && (m.c === 6 || m.c === 7) && rnd() * 100 < (m.statP || 100)) applyStats(m.c === 7 ? who : dw, m.stats);
      return;
    }
    // Status-Attacken
    if (m.c === 1 && m.ail) { applyAilment(mv.self ? who : dw, m.ail, true); return; }
    if (m.c === 2 && m.stats) { applyStats(mv.self ? who : dw, m.stats); return; }
    if (m.c === 3 && m.heal) { if (a.hp >= a.maxHp) { say('Aber es schlug fehl!'); return; } a.hp = Math.min(a.maxHp, a.hp + Math.floor((a.maxHp * m.heal) / 100)); say(`${nameOf(a, who)} hat sich erholt!`, { set: who, hp: a.hp }); return; }
    if (m.c === 5) { applyStats(dw, m.stats || [[2, 2]]); applyAilment(dw, 6, true); return; }
    say('Aber es passierte nichts …');
  };
  const endOfTurn = () => {
    for (const who of ['p', 'w']) {
      const f = F[who];
      if (f.hp > 0 && f.item?.regen && f.hp < f.maxHp) { f.hp = Math.min(f.maxHp, f.hp + Math.max(1, Math.floor(f.maxHp * f.item.regen))); say(`${nameOf(f, who)} wird durch ${f.itemName || 'sein Item'} ein wenig geheilt.`, { set: who, hp: f.hp }); }
      if (f.hp <= 0 || (f.status !== 'brn' && f.status !== 'psn')) continue;
      const dmg = Math.max(1, Math.floor(f.maxHp / (f.status === 'brn' ? 16 : 8)));
      f.hp = Math.max(0, f.hp - dmg);
      say(`${nameOf(f, who)} wird ${f.status === 'brn' ? 'durch die Verbrennung' : 'durch das Gift'} verletzt!`, { hit: who, dmg, eff: 1, hp: f.hp });
      if (faintCheck(who)) return;
    }
  };
  const foeMove = foe.moves[Math.floor(rnd() * foe.moves.length)];
  if (choice === 'flee') {
    const B = W().battle, ch = Math.max(B.fleeMin, Math.min(B.fleeMax, B.fleeBase + (speedOfF(me) / speedOfF(foe) - 1) * B.fleeSpeed));
    if (rnd() < ch) { say('Du bist entkommen!', { fled: true }); return steps; }
    say('Flucht gescheitert!');
    act('w', foeMove, true); if (me.hp > 0 && foe.hp > 0) endOfTurn();
    return steps;
  }
  const myMove = me.moves[choice], pm = moveData(myMove)?.prio || 0, pf = moveData(foeMove)?.prio || 0;
  const qm = me.item?.quick && rnd() < me.item.quick, qf = foe.item?.quick && rnd() < foe.item.quick; // Flinkklaue
  const meFirst = pm !== pf ? pm > pf : qm !== qf ? qm : speedOfF(me) !== speedOfF(foe) ? speedOfF(me) > speedOfF(foe) : rnd() < 0.5;
  const order = meFirst ? [['p', myMove], ['w', foeMove]] : [['w', foeMove], ['p', myMove]];
  order.forEach(([who, id], i) => { if (me.hp > 0 && foe.hp > 0) act(who, id, i === 0); });
  if (me.hp > 0 && foe.hp > 0) endOfTurn();
  me.flinch = foe.flinch = false;
  return steps;
}

// ---- Belohnungen im Spielstand ----
export function walkWin(s, uid, foe) {
  const R = W().rewards, p = s.pokemon.find((x) => x.uid === uid);
  const ep = Math.round(R.epPerWin + foe.level * R.epPerLevel);
  s.route ||= { ep: 0, cleared: 0 }; s.route.ep += ep;
  const gained = [0, 0, 0, 0, 0, 0];
  if (p) {
    const S = CFG.battle.stats; p.evs ||= [0, 0, 0, 0, 0, 0];
    bdata(foe.dex).ev.forEach((v, i) => {
      const total = p.evs.reduce((a, b) => a + b, 0);
      const add = Math.max(0, Math.min(Math.round(v * R.evMult), S.evMaxStat - p.evs[i], S.evMaxTotal - total));
      p.evs[i] += add; gained[i] = add;
    });
  }
  return { ok: true, ep, gained };
}
export function walkDone(s, uid, steps, home, t) {
  const d = dayKey(t);
  s.walk ||= { done: {} };
  s.walk.done[uid] = [...(s.walk.done[uid] || []).filter((x) => x === d), d];
  for (const [k, v] of Object.entries(s.walk.done)) if (!v.includes(d)) delete s.walk.done[k];
  const ep = home ? Math.round(steps * W().rewards.epPerStep) : 0;
  s.route ||= { ep: 0, cleared: 0 }; s.route.ep += ep;
  return { ok: true, ep };
}
