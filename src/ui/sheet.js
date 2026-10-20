// Detailansicht eines Pokémon: Pflege (Streicheln durch Reiben, Füttern), Beeren, Areal-Zuweisung.
import { CFG, species, areaById, isHairy } from '../config.js';
import { openGrooming } from './groom.js';
import { app } from '../app.js';
import { now, fmtDuration } from '../time.js';
import * as A from '../game/actions.js';
import { capacityOf, residents, xpForLevel, genderSymbol } from '../game/state.js';
import { msToNextCoin, msToNextBerry, coinRange } from '../game/sim.js';
import { modsFor, bonusTraits } from '../game/bonuses.js';
import { habitatText, habitatFit } from '../game/habitat.js';
import { mood, petBoost, affinity } from '../game/mood.js';
import { isPsychic, canForesee, revealActive } from '../game/gacha.js';
import { typeChip } from '../game/types.js';
import { collectWithFx } from './collect.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { iconCanvas, iconImg, berryImg } from '../gfx/icons.js';
import { ballCanvas } from '../gfx/balls.js';
import { $, h, bar, toast } from './dom.js';

let current = null;

export function emotionOf(p) {
  const n = CFG.balance.needs;
  if (p.fullness < n.hungryBelow / 2) return 'Sad';
  if (p.fullness < n.hungryBelow) return 'Worried';
  if (mood(p, Date.now()) >= 80) return 'Happy';
  return 'Normal';
}

export function closeSheet() {
  if (!current) return;
  cancelAnimationFrame(current.raf);
  app.views.delete(current.update);
  current = null;
  $('#sheet').classList.add('hidden');
  $('#sheet').replaceChildren();
}

export function openSheet(p) {
  closeSheet();
  const sp = species(p.dex);
  const root = $('#sheet');
  root.classList.remove('hidden');
  root.onclick = (e) => { if (e.target === root) closeSheet(); };

  const portrait = h('img.portrait', { src: portraitUrl(p.dex, emotionOf(p)), alt: '' });
  const sub = h('div.sub');
  const head = h('div.sheet-head', portrait,
    h('div', h('h2', sp.name, h('span.gender.' + p.gender, genderSymbol(p))), sub),
    h('button.btn.small.close', { onclick: closeSheet }, '✕'));

  // ---- Bühne zum Streicheln / Füttern ----
  const cv = h('canvas');
  const stage = h('div.pet-stage', cv, h('div.pet-hint', p.area ? 'Zum Streicheln reiben' : 'Schläft im Beutel'));
  const sprites = loadSprites(p.dex, p.gender);
  const fx = { anim: 'Idle', t: 0, until: 0, hearts: [], bowl: 0 };
  const heart = iconCanvas('heart', 1), bowl = iconCanvas('food', 1);
  let last = performance.now();
  const drawStage = () => {
    const nowT = performance.now(), dt = (nowT - last) / 1000; last = nowT;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const W = cv.clientWidth * dpr, H = cv.clientHeight * dpr;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // Hintergrund: Wiese mit Pixelstreifen
    ctx.fillStyle = '#cfe6b5'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#bcdba0';
    const px = Math.round(4 * dpr);
    for (let y = H * 0.55; y < H; y += px * 6) for (let x = (y / px) % 3 * px * 4; x < W; x += px * 12) ctx.fillRect(x, y, px * 2, px);
    const scale = Math.max(3, Math.floor((H * 0.75) / 40));
    fx.t += dt * 1000;
    if (fx.until && nowT > fx.until) { fx.anim = 'Idle'; fx.until = 0; fx.t = 0; }
    const cx = W / 2, cy = H * 0.72;
    ctx.fillStyle = 'rgba(30,40,20,.25)';
    ctx.beginPath(); ctx.ellipse(cx, cy, 11 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
    if (fx.bowl > nowT) ctx.drawImage(bowl, cx - 6 * scale * 0.8, cy - 2 * scale, 12 * scale * 0.8, 6 * scale * 0.8);
    if (sprites.ready) {
      const sleeping = !p.area;
      const f = frameOf(sprites, sleeping ? 'Sleep' : fx.anim, 0, fx.t);
      const w = f.fw * scale, hh = f.fh * scale;
      fx.box = { x: cx - w / 2, y: cy - hh * 0.75, w, h: hh * 0.8 };
      ctx.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, Math.round(cx - w / 2), Math.round(cy - hh / 2 - 4 * scale), w, hh);
    }
    for (const q of fx.hearts) {
      q.y -= 40 * dpr * dt; q.life -= dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2));
      ctx.drawImage(heart, q.x, q.y, 9 * px * 0.8, 8 * px * 0.8);
    }
    ctx.globalAlpha = 1;
    fx.hearts = fx.hearts.filter((q) => q.life > 0);
    if (current) current.raf = requestAnimationFrame(drawStage);
  };
  const play = (anim, ms) => { fx.anim = anim; fx.t = 0; fx.until = performance.now() + ms; };

  // Reiben = Streicheln
  let rub = null;
  cv.addEventListener('pointerdown', (e) => { rub = { x: e.clientX, y: e.clientY, dist: 0 }; try { cv.setPointerCapture(e.pointerId); } catch { /* ok */ } });
  cv.addEventListener('pointermove', (e) => {
    if (!rub || !p.area) return;
    const r = cv.getBoundingClientRect(), dpr = cv.width / r.width;
    const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr, b = fx.box;
    if (!b || x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) { rub.x = e.clientX; rub.y = e.clientY; return; }
    rub.dist += Math.hypot(e.clientX - rub.x, e.clientY - rub.y);
    rub.x = e.clientX; rub.y = e.clientY;
    if (rub.dist > 160) {
      rub.dist = 0;
      app.act((s, t) => A.pet(s, p, t));
      fx.hearts.push({ x: x - 10, y: y - 20, life: 1 });
      if (fx.anim !== 'Hop') play('Hop', 700);
      portrait.src = portraitUrl(p.dex, 'Joyous');
    }
  });
  const endRub = () => { rub = null; };
  cv.addEventListener('pointerup', endRub);
  cv.addEventListener('pointercancel', endRub);

  // ---- Kurzinfos (nur das Nötigste) ----
  const line = (label) => { const v = h('span'); return { el: h('div.info-line', h('span.k', label), v), v }; };
  const lCoin = line('Nächste Münze'), lSat = line('Stimmung'), lHun = line('Sättigung'), lFav = line('Lieblingsareal'), lCln = line('Sauberkeit');
  const clnBar = bar('clean', 0);
  const clnWrap = h('span.satwrap', clnBar);
  lCln.v.replaceWith(clnWrap);
  clnWrap.append(lCln.v);
  const hairy = isHairy(p.dex);
  const hunBar = bar('hunger', 0);
  const hunWrap = h('span.satwrap', hunBar);
  lHun.v.replaceWith(hunWrap);
  hunWrap.append(lHun.v);
  const satBar = bar('sat', 0);
  const satWrap = h('span.satwrap', satBar);
  lSat.v.replaceWith(satWrap);
  satWrap.append(lSat.v);
  const extra = h('div.info-extra');
  const favs = CFG.areas.filter((a) => habitatFit(p.dex, a.id).fit > 0).map((a) => a.name);
  lFav.v.textContent = favs.length ? favs.slice(0, 2).join(', ') : 'keins besonders';

  const feedLabel = h('span.k', 'Füttern');
  const berryBtns = CFG.balance.berries.map((b) => {
    const btn = h('button.btn.small', { title: b.name + ': ' + b.text, onclick: () => {
      const r = app.act((s2, t) => A.giveBerry(s2, p, b.id, t));
      if (r.ok) { fx.bowl = performance.now() + 1800; play('Eat', 1800); portrait.src = portraitUrl(p.dex, 'Happy'); toast(`${sp.name} hat eine ${b.name} gegessen.`); }
    } });
    btn.dataset.id = b.id;
    return btn;
  });

  const sel = h('select', { onchange: () => {
    if (!sel.value) return;
    const r = app.act((s2) => A.assign(s2, p, sel.value), true);
    if (r.ok) { toast(`${sp.name} zieht in ${areaById(sel.value).name} ein.`); closeSheet(); }
  } });
  const moveRow = h('div.row');

  const update = () => {
    const st = app.state, t = now();
    if (!sub.dataset.done) { sub.dataset.done = '1'; sub.replaceChildren(h('div', `Lv. ${p.level} · `, h('span.tag.' + sp.rarity, CFG.balance.rarityNames[sp.rarity])), h('div.type-chips.left', ...sp.types.map((ty) => typeChip(ty)))); }
    else sub.firstChild.firstChild.textContent = `Lv. ${p.level} · `;
    const cr = coinRange(p);
    const unsuited = p.area && habitatFit(p.dex, p.area).fit < 0;
    lCoin.v.textContent = !p.area ? 'ruht im Beutel' : p.coinsReady ? `${p.coinsReady} bereit` : unsuited ? 'keine – Areal ungeeignet' : `in ${fmtDuration(msToNextCoin(st, p, t))} · ${cr[0]}–${cr[1]} Stück`;
    const md = mood(p, t), boost = petBoost(p, t);
    satBar.firstChild.style.width = md + '%';
    lSat.v.textContent = Math.round(md) + ' %';
    hunBar.firstChild.style.width = p.fullness + '%';
    if (hairy) { clnBar.firstChild.style.width = (p.cleanliness ?? 0) + '%'; lCln.v.textContent = Math.round(p.cleanliness ?? 0) + ' %'; }
    lHun.v.textContent = Math.round(p.fullness) + ' %';
    const notes = [];
    if (p.shineUntil && p.shineUntil > t) notes.push(h('div.note', `✨ Glänzt frisch geputzt (noch ${fmtDuration(p.shineUntil - t)})`));
    if (hairy && (p.cleanliness ?? 100) < CFG.grooming.dirtyBelow) notes.push(h('div.note.warn', 'Das Fell ist schmutzig – Zeit zum Putzen!'));
    if (p.area && p.fullness < CFG.balance.needs.hungryBelow) notes.push(h('div.note.warn', 'Hat Hunger – gib ihm eine Beere!'));
    if (p.area) {
      const mates = residents(st, p.area).filter((q) => q.uid !== p.uid).map((q) => ({ q, v: affinity(p.dex, q.dex) }));
      const good = mates.filter((m) => m.v >= 0.3).map((m) => species(m.q.dex).name);
      const bad = mates.filter((m) => m.v <= -0.3).map((m) => species(m.q.dex).name);
      if (good.length) notes.push(h('div.note', 'Versteht sich gut mit ' + [...new Set(good)].slice(0, 3).join(', ')));
      if (bad.length) notes.push(h('div.note.warn', 'Kommt nicht klar mit ' + [...new Set(bad)].slice(0, 3).join(', ')));
    }
    if (isPsychic(p)) {
      const rv = revealActive(st, t);
      if (rv) notes.push(h('div.note', `🔮 Psycho-Blick aktiv (noch ${fmtDuration(rv.until - t)})`));
      else if (canForesee(p, t)) notes.push(h('button.btn.small.psy', { onclick: () => {
        const r = app.act((s2, t2) => A.foresee(s2, p, t2), true);
        if (r.ok) toast(`${sp.name} blickt in die Pokébälle – schau im Automaten nach!`);
      } }, '🔮 Psycho-Blick: 5 Bälle im Automaten aufdecken'));
      else notes.push(h('div.note', `🔮 Ab ${CFG.balance.gacha.psychic.minMood} % Stimmung (und in einem Areal) kann es in den Automaten blicken.`));
    }
    if (boost) notes.push(h('div.note', `♥ Betüdelt: Stimmung +${Math.round(boost)} (noch ${fmtDuration(p.petBoost.until - t)})`));
    if (p.area) { const hf = habitatFit(p.dex, p.area).fit; if (hf < 0) notes.push(h('div.note.warn', `Fühlt sich in ${areaById(p.area).name} nicht wohl und produziert hier keine Münzen.`)); }
    if (p.area && CFG.berryProducers.has(p.dex)) notes.push(h('div.note', `Beeren: nächste in ${fmtDuration(msToNextBerry(st, p))}`));
    const m = p.area ? modsFor(st, p) : null;
    if (m?.sources.length) notes.push(h('div.note', 'Boni: ' + [...new Set(m.sources.map((x) => x.name))].join(', ')));
    const eff = p.effects.filter((e) => e.until > t);
    if (eff.length) notes.push(h('div.note', eff.map((e) => `${CFG.balance.berries.find((b) => b.id === e.berry)?.name}: noch ${fmtDuration(e.until - t)}`).join(' · ')));
    const nk = notes.map((n) => n.textContent).join('|');
    if (extra.dataset.k !== nk) { extra.dataset.k = nk; extra.replaceChildren(...notes); }
    for (const btn of berryBtns) {
      const id = btn.dataset.id, n = st.berries[id] || 0, b = CFG.balance.berries.find((x) => x.id === id);
      const label = n ? '×' + n : String(b.cost);
      if (btn.dataset.l !== label) { btn.dataset.l = label; btn.replaceChildren(berryImg(id, 2), ...(n ? [label] : [iconImg('coin', 1), label])); }
    }
    // Pokémon im Beutel: direkt einziehen lassen (im Areal geht Umziehen per Drag & Drop)
    const selKey = p.area + '|' + CFG.areas.map((a) => (st.areas[a.id].unlocked ? a.id + residents(st, a.id).length + '/' + capacityOf(st, a.id) : '')).join();
    if (sel.dataset.key !== selKey) {
      sel.dataset.key = selKey;
      sel.replaceChildren(h('option', { value: '' }, 'Einziehen in …'),
        ...CFG.areas.filter((a) => st.areas[a.id].unlocked).map((a) => h('option', { value: a.id, disabled: residents(st, a.id).length >= capacityOf(st, a.id) }, `${a.name} (${residents(st, a.id).length}/${capacityOf(st, a.id)})${['  ✕', '', '  ♥'][habitatFit(p.dex, a.id).fit + 1]}`)));
      moveRow.replaceChildren(...(p.area ? [] : [sel]));
    }
  };

  root.replaceChildren(h('div.sheet-inner.compact',
    head, stage,
    h('div.info', lSat.el, lHun.el, hairy ? lCln.el : null, lCoin.el, lFav.el), extra,
    h('div.row.actions', feedLabel, ...berryBtns),
    hairy ? h('div.row', h('button.btn.groom-btn', { onclick: () => {
      if ((p.cleanliness ?? 0) >= 97) return toast(`${sp.name} ist schon ganz sauber.`);
      closeSheet();
      openGrooming(p, () => openSheet(p));
    } }, '🧽 Fell putzen')) : null,
    moveRow));

  current = { update, raf: 0 };
  update();
  app.views.add(update);
  current.raf = requestAnimationFrame(drawStage);
}
