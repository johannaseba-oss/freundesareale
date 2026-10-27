// Putz-Minispiel für haarige Pokémon.
// 1) Seife aus der Ablage greifen und über die Dreckhaufen schieben: hinter der Seife entstehen Bläschen,
//    die Haufen schrumpfen Stufe für Stufe und es bleibt Schaum zurück.
// 2) Brause greifen und über Schaum und Bläschen ziehen: Wasserpixel spülen alles nach unten weg.
// Erst wenn der Dreck weg und alles abgespült ist, glänzt das Fell.
import { CFG, species, furOf } from '../config.js';
import { app } from '../app.js';
import * as A from '../game/actions.js';
import { portraitUrl } from '../gfx/sprites.js';
import { haptic } from '../haptics.js';
import { loopFile } from '../audio.js';
import { gainLines } from '../game/contest.js';
import { nameOf } from '../game/state.js';
import { h, toast, gainPop } from './dom.js';

const BASE = import.meta.env.BASE_URL;
const ART = `${BASE}art/putzen/`;
const rand = (a, b) => a + Math.random() * (b - a);
const imgs = new Map();
const img = (name) => { if (!imgs.has(name)) { const i = new Image(); i.src = ART + name + '.png'; imgs.set(name, i); } return imgs.get(name); };
const ready = (i) => i.complete && i.naturalWidth;
// Schrumpf-Stufen der Dreckhaufen (groß -> klein)
const STAGES = ['dreck_klumpen', 'dreck_rund', 'dreck_kruemel', 'dreck_punkte'];
const MUD = ['#5b3a22', '#7a4a2c', '#9a6040', '#4a2c1a'];
const WATER = ['#7fc8f0', '#a9dcf7', '#5aa9e0', '#d4effc'];
let bubbleCount = 31;
fetch(ART + 'putzen.json').then((r) => r.json()).then((m) => { bubbleCount = m.bubbles || bubbleCount; }).catch(() => {});

export function openGrooming(p, onDone) {
  const G = CFG.grooming, sp = species(p.dex);
  const fur = new Image();
  fur.src = `${BASE}art/fell/${G.furs[furOf(p.dex)]}`;
  const cv = h('canvas.groom-cv');
  const bar = h('i', { style: { width: '0%' } });
  const portrait = h('img.portrait', { src: portraitUrl(p.dex, 'Worried', p.shiny), alt: '' });
  const titleEl = h('b', `${nameOf(p)} putzen`);
  const hint = h('div.groom-hint', 'Zieh die Seife über den Dreck!');
  const soapBtn = h('div.tool', { 'data-tool': 'soap' }, h('img', { src: ART + 'seife.png', alt: 'Seife', draggable: false }));
  const waterBtn = h('div.tool', { 'data-tool': 'water' }, h('img', { src: ART + 'brause.png', alt: 'Brause', draggable: false }));
  const done = h('div.groom-done.hidden');
  const el = h('div.groom',
    cv,
    h('div.groom-top', portrait, h('div.groom-title', titleEl, h('div.bar.clean', bar)), h('button.btn.small', { onclick: () => finish(false) }, '✕')),
    hint,
    h('div.tool-tray', soapBtn, waterBtn),
    done);
  document.body.append(el);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 3);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  };
  resize();

  // Verschmutzungsgrad würfeln (schmutzigere Pokémon sind eher stark/extrem verschmutzt)
  const dirtiness = Math.min(1, Math.max(0, (100 - (p.cleanliness ?? 50)) / 100));
  const sev = weighted(G.severity.map((v) => ({ ...v, weight: v.weightClean + (v.weightDirty - v.weightClean) * dirtiness })));
  titleEl.textContent = `${nameOf(p)} putzen · ${sev.name}`;
  const count = Math.round(rand(sev.count[0], sev.count[1] + 0.99) - 0.49);
  // Härtere Schmutzarten werden bei starker Verschmutzung häufiger
  const kinds = G.dirt.map((k) => ({ ...k, weight: k.weight * (k.hp >= 7 ? sev.heavy : 1) }));
  const dirts = [];
  for (let i = 0; i < count; i++) {
    const kind = weighted(kinds);
    const stage0 = kind.stage ?? 2;
    const hp = kind.hp + (kind.hp > 1 ? sev.extraHp : 0);
    const size = [86, 72, 58, 40][stage0] * sev.sizeScale * (kind.size || 1) * rand(0.9, 1.1);
    // bei extremer Verschmutzung dicht an dicht über das ganze Fell
    dirts.push({ x: rand(36, W - 36), y: rand(130, H - 175), hp, max: hp, stage0, size, rot: rand(-0.3, 0.3), wipe: 0, shake: 0, pop: 0, kind: kind.id });
  }
  const totalHp = dirts.reduce((s, d) => s + d.max, 0);
  const soap = []; // Bläschen und Schaumreste, die abgespült werden müssen
  const particles = [];
  let soapMade = 0, tool = null, held = null, shine = -1, closed = false, raf, lastHit = 0;
  let waterLoop = null, soapLoop = null, soapStopT = 0; // Wasser-/Seifen-Geräusch, solange das Werkzeug benutzt wird

  function weighted(list) {
    const tot = list.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * tot;
    for (const x of list) { r -= x.weight; if (r < 0) return x; }
    return list[0];
  }
  const dirtLeft = () => dirts.reduce((s, d) => s + Math.max(0, d.hp), 0);
  const soapLeft = () => soap.filter((b) => !b.rinse).length;
  const progress = () => {
    const dirtFrac = 1 - dirtLeft() / totalHp;
    const rinseFrac = soapMade ? 1 - soapLeft() / Math.max(soapMade, 1) : 0;
    return dirtFrac * 0.7 + rinseFrac * 0.3 * (dirtLeft() === 0 ? 1 : dirtFrac);
  };
  const updateUi = () => {
    bar.style.width = Math.round(progress() * 100) + '%';
    const needRinse = dirtLeft() === 0 && soapLeft() > 0;
    hint.textContent = needRinse ? 'Jetzt mit der Brause den Schaum abspülen!' : 'Zieh die Seife über den Dreck!';
    waterBtn.classList.toggle('glow', needRinse);
    soapBtn.classList.toggle('glow', dirtLeft() > 0 && !tool);
    if (dirtLeft() === 0 && soapLeft() === 0 && shine < 0) celebrate();
  };

  function addSoap(x, y, kind) {
    if (kind === 'bubble' && soap.length > 240) return; // genug Bläschen – nichts verschwindet ohne Abspülen
    const b = kind === 'foam'
      ? { kind, x: x + rand(-14, 14), y: y + rand(-10, 10), size: rand(46, 62), rot: rand(-0.3, 0.3), born: performance.now() }
      : { kind: 'bubble', n: Math.floor(Math.random() * bubbleCount), x: x + rand(-18, 18), y: y + rand(-14, 14), size: rand(14, 30), rot: 0, born: performance.now(), wob: rand(0, 6) };
    soap.push(b);
    soapMade++;
  }

  // ---- Werkzeuge greifen (aus der Ablage ziehen) ----
  const toLocal = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  for (const btn of [soapBtn, waterBtn]) {
    btn.addEventListener('pointerdown', (e) => {
      if (shine >= 0) return;
      e.preventDefault();
      tool = btn.dataset.tool;
      const pt = toLocal(e);
      held = { x: pt.x, y: pt.y - 40, lx: pt.x, ly: pt.y - 40, id: e.pointerId };
      btn.classList.add('out');
      if (tool === 'water') waterLoop = loopFile('wasser', 0.55);
      try { el.setPointerCapture(e.pointerId); } catch { /* ok */ }
      haptic('tick');
      updateUi();
    });
  }
  el.addEventListener('pointermove', (e) => {
    if (!held || e.pointerId !== held.id) return;
    const pt = toLocal(e);
    held.x = pt.x; held.y = pt.y - 40; // Werkzeug etwas über dem Finger, damit man es sieht
    const dist = Math.hypot(held.x - held.lx, held.y - held.ly);
    if (dist < 1) return;
    if (tool === 'soap') scrub(dist);
    held.lx = held.x; held.ly = held.y;
  });
  const drop = (e) => {
    if (!held || (e && e.pointerId !== held.id)) return;
    held = null; tool = null;
    waterLoop?.stop(); waterLoop = null; soapLoop?.stop(); soapLoop = null;
    soapBtn.classList.remove('out'); waterBtn.classList.remove('out');
    updateUi();
  };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);

  // Seife: Bläschen hinter der Seife, Dreck darunter wird kleiner, Schaum bleibt zurück
  function scrub(dist) {
    // Seifengeräusch läuft, solange geschrubbt wird, und klingt kurz danach aus
    soapLoop ||= loopFile('seife', 0.7);
    clearTimeout(soapStopT);
    soapStopT = setTimeout(() => { soapLoop?.stop(); soapLoop = null; }, 260);
    held.trail = (held.trail || 0) + dist;
    while (held.trail > 24) { held.trail -= 24; addSoap(held.lx, held.ly, 'bubble'); }
    for (const d of dirts) {
      if (d.hp <= 0 || Math.hypot(d.x - held.x, d.y - held.y) > d.size * 0.7 + 20) continue;
      d.wipe += dist;
      d.shake = 0.15;
      if (Math.random() < 0.3) particles.push(crumb(d.x, d.y));
      if (d.wipe >= G.wipePerHit) {
        d.wipe = 0; d.hp--;
        addSoap(d.x, d.y, 'foam');
        for (let i = 0; i < 5; i++) particles.push(crumb(d.x, d.y));
        if (d.hp <= 0) { d.pop = 1; haptic('medium'); addSoap(d.x, d.y, 'foam'); }
        else haptic('tick');
        updateUi();
      }
    }
  }
  // Brause: Wasserpixel, Schaum und Bläschen darunter werden nach unten weggespült
  function rinse() {
    if (tool !== 'water' || !held) return;
    const nx = held.x - 26, ny = held.y - 24; // Brausekopf (oben links im Sprite)
    for (let i = 0; i < 6; i++) particles.push({ x: nx + rand(-14, 14), y: ny + rand(0, 8), vx: rand(-25, 25), vy: rand(260, 380), g: 600, life: rand(0.45, 0.8), s: rand(3, 6), c: WATER[Math.floor(Math.random() * 4)] });
    let hit = false;
    for (const b of soap) {
      if (b.rinse) continue;
      if (Math.abs(b.x - nx) < 46 && b.y > ny - 20 && b.y < ny + 230) { b.rinse = { vy: rand(120, 220), vx: rand(-20, 20) }; hit = true; }
    }
    if (hit && performance.now() - lastHit > 90) { lastHit = performance.now(); haptic('tick'); updateUi(); }
  }
  function crumb(x, y) { return { x: x + rand(-10, 10), y: y + rand(-10, 10), vx: rand(-90, 90), vy: rand(-140, -30), g: 420, life: rand(0.4, 0.8), s: rand(3, 6), c: MUD[Math.floor(Math.random() * 4)] }; }

  function celebrate() {
    shine = 0;
    haptic('strong');
    held = null; tool = null;
    portrait.src = portraitUrl(p.dex, 'Joyous', p.shiny);
    hint.remove();
    el.querySelector('.tool-tray')?.remove();
    done.classList.remove('hidden');
    done.replaceChildren(h('img.portrait.big', { src: portraitUrl(p.dex, 'Joyous', p.shiny), alt: '' }), h('h2', 'Blitzsauber!'), h('p', `${nameOf(p)} fühlt sich pudelwohl.`), h('button.btn.primary', { onclick: () => finish(true) }, 'Fertig'));
  }

  function finish(success) {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    waterLoop?.stop(); soapLoop?.stop(); clearTimeout(soapStopT);
    const frac = success ? 1 : progress();
    if (frac > 0) {
      const r = app.act((s, t) => A.groomed(s, p, t, frac), true);
      if (r.ok && !r.partial) { toast(`${nameOf(p)} ist jetzt blitzsauber!`); if (r.contest) setTimeout(() => gainPop(gainLines(r.contest)), 250); }
      else if (r.ok) toast(`${nameOf(p)} ist etwas sauberer.`);
    }
    el.remove();
    onDone?.();
  }

  const drawSprite = (name, x, y, w, rot = 0, alpha = 1) => {
    const i = img(name);
    if (!ready(i)) return;
    const hgt = w * (i.naturalHeight / i.naturalWidth);
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(i, -w / 2, -hgt / 2, w, hgt);
    ctx.restore();
  };

  let prev = performance.now();
  const frame = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    if (cv.clientWidth !== W || cv.clientHeight !== H) resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (ready(fur)) {
      const k = Math.max(W / fur.naturalWidth, H / fur.naturalHeight);
      ctx.drawImage(fur, (W - fur.naturalWidth * k) / 2, (H - fur.naturalHeight * k) / 2, fur.naturalWidth * k, fur.naturalHeight * k);
    } else { ctx.fillStyle = '#c9b9a0'; ctx.fillRect(0, 0, W, H); }
    // Dreckhaufen: Stufe nach verbleibender Härte
    for (const d of dirts) {
      if (d.hp <= 0 && d.pop <= 0) continue;
      const left = Math.max(0, d.hp) / d.max;
      const st = d.hp <= 0 ? 3 : Math.min(3, d.stage0 + Math.floor((1 - left) * (4 - d.stage0)));
      const w = d.size * (d.hp <= 0 ? d.pop * 0.6 : 0.55 + 0.45 * left) * (st === 3 ? 0.7 : 1);
      if (d.hp <= 0) d.pop -= dt * 3;
      const jx = d.shake > 0 ? rand(-2, 2) : 0;
      d.shake = Math.max(0, d.shake - dt);
      drawSprite(STAGES[st], d.x + jx, d.y, w, d.rot, d.hp <= 0 ? Math.max(0, d.pop) : 1);
      if (d.kind === 'kruste' && d.hp > 0) drawSprite(STAGES[st], d.x + jx, d.y, w * 0.9, d.rot + 0.4, 0.55 * left);
    }
    // Schaum & Bläschen (abgespülte rutschen nach unten und verblassen)
    const t = now / 1000;
    for (const b of soap) {
      let alpha = 1;
      if (b.rinse) { b.rinse.vy += 500 * dt; b.x += b.rinse.vx * dt; b.y += b.rinse.vy * dt; b.rinse.a = (b.rinse.a ?? 1) - dt * 1.6; alpha = Math.max(0, b.rinse.a); }
      const appear = Math.min(1, (now - b.born) / 150);
      if (b.kind === 'foam') drawSprite('schaum', b.x, b.y, b.size * appear, b.rot, alpha * 0.95);
      else drawSprite(`blase_${b.n}`, b.x + Math.sin(t * 2 + b.wob) * 1.2, b.y, b.size * appear, 0, alpha);
    }
    for (let i = soap.length - 1; i >= 0; i--) if (soap[i].rinse && soap[i].rinse.a <= 0) soap.splice(i, 1);
    rinse();
    // Krümel & Wasserpixel
    for (const q of particles) {
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2));
      ctx.fillStyle = q.c;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), q.s, q.s);
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    ctx.globalAlpha = 1;
    // gehaltenes Werkzeug
    if (held && tool === 'soap') drawSprite('seife', held.x, held.y, 92, Math.sin(t * 10) * 0.06);
    if (held && tool === 'water') drawSprite('brause', held.x, held.y, 84, -0.15);
    // Glanzeffekt am Ende
    if (shine >= 0) {
      shine += dt;
      const x = (shine / 1.1) * (W + H) - H;
      const grad = ctx.createLinearGradient(x, 0, x + H * 0.5, H * 0.5);
      grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 18; i++) {
        const sx = (Math.sin(i * 12.9898) * 0.5 + 0.5) * W, sy = (Math.sin(i * 78.233) * 0.5 + 0.5) * H;
        const tw = Math.max(0, Math.sin(shine * 6 + i)), s = 3 + tw * 6;
        ctx.globalAlpha = tw; ctx.fillStyle = '#fffbe0';
        ctx.fillRect(sx - s / 2, sy - 1, s, 2); ctx.fillRect(sx - 1, sy - s / 2, 2, s);
      }
      ctx.globalAlpha = 1;
    }
    raf = requestAnimationFrame(frame);
  };
  updateUi();
  raf = requestAnimationFrame(frame);
  if (import.meta.env.DEV) app.groom = { dirts, soap, progress, finish, celebrate, get tool() { return tool; } };
}
