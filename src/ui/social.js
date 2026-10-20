// Soziale Begegnungen im Areal (nur sichtbar, während man zuschaut).
// Wer mit wem und wie, hängt ab von Sympathie (Art, Familie, Typen, Entwicklungsstufe, Beziehungen),
// Stimmung und Arealpassung. Bei Gesprächen/Streit erscheinen kurz die Porträts über den Pokémon.
import { CFG, species } from '../config.js';
import { dirFromVector, portraitUrl } from '../gfx/sprites.js';
import { affinity, mood } from '../game/mood.js';
import { habitatFit } from '../game/habitat.js';
import { weightedPick } from '../rng.js';
import { dominates } from '../game/types.js';

const rand = (a, b) => a + Math.random() * (b - a);
const portraits = new Map();
function portrait(dex, emo) {
  const url = portraitUrl(dex, emo);
  if (!portraits.has(url)) { const i = new Image(); i.src = url; portraits.set(url, i); }
  return portraits.get(url);
}
const happyFace = (p) => (mood(p, Date.now()) >= 70 ? 'Joyous' : mood(p, Date.now()) >= 45 ? 'Happy' : 'Normal');

export class SocialDirector {
  constructor(scene, onResult) {
    this.scene = scene;
    this.onResult = onResult;
    this.reset();
  }
  reset() { this.active = []; this.bubbles = []; this.wait = rand(2, 4); this.scan = 0; this.cool = new Map(); }

  update(dt) {
    const B = CFG.social.behavior;
    for (const b of this.bubbles) b.t += dt;
    this.bubbles = this.bubbles.filter((b) => b.t < b.life);
    for (const it of this.active) this.step(it, dt);
    this.active = this.active.filter((it) => !it.done);
    // Typ-Überlegenheit: zu nahe gekommen -> Jagd
    this.scan -= dt;
    if (this.scan <= 0) { this.scan = 0.5; this.checkHunt(); }
    this.wait -= dt;
    if (this.wait <= 0) {
      this.wait = rand(B.everySeconds[0], B.everySeconds[1]);
      this.start();
    }
  }

  // passendes Paar suchen und Art der Begegnung festlegen
  start() {
    const S = this.scene, B = CFG.social.behavior;
    const free = [...S.actors.values()].filter((a) => !a.busy && !a.dragging && a.sprites.ready && a.state !== 'sleep');
    if (free.length < 2) return;
    const W = S.bg.naturalWidth;
    const pairs = [];
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) > B.maxDistance * W) continue;
      pairs.push([a, b]);
    }
    if (!pairs.length) return;
    const [a, b] = pairs[Math.floor(Math.random() * pairs.length)];
    const t = Date.now();
    const aff = affinity(a.p.dex, b.p.dex);
    const moodAvg = (mood(a.p, t) + mood(b.p, t)) / 200 - 0.5; // -0.5..0.5
    const unsuitable = habitatFit(a.p.dex, a.p.area).fit < 0 || habitatFit(b.p.dex, b.p.area).fit < 0;
    const score = B.affinityWeight * aff + B.moodWeight * moodAvg * 2 - (unsuitable ? B.unsuitableAreaPenalty : 0);
    // fast deterministisch: gute Beziehung + gute Laune = freundlich, Abneigung/schlechte Laune = gereizt
    const pNeg = Math.max(0.02, Math.min(0.98, 0.5 - B.friendlyBias - score * B.steepness));
    const negative = Math.random() < pNeg;
    const young = species(a.p.dex).stage <= 1 && species(b.p.dex).stage <= 1;
    const table = negative ? B.negative : { ...B.positive, chase: B.positive.chase + (young ? B.youngPlayBonus : 0), play: B.positive.play + (young ? B.youngPlayBonus : 0) };
    const kind = weightedPick(Object.keys(table), (k) => table[k]);
    this.begin(kind, a, b, !negative);
  }

  checkHunt() {
    const S = this.scene, H = CFG.social.hunt;
    if (!H) return;
    const free = [...S.actors.values()].filter((a) => !a.busy && !a.dragging && a.sprites.ready && a.state !== 'sleep');
    const W = S.bg.naturalWidth, now = performance.now();
    for (let i = 0; i < free.length; i++) for (let j = 0; j < free.length; j++) {
      if (i === j) continue;
      const hunter = free[i], prey = free[j];
      if (hunter.busy || prey.busy) continue;
      if (Math.hypot(hunter.x - prey.x, hunter.y - prey.y) > H.triggerDistance * W) continue;
      if (!dominates(hunter.p.dex, prey.p.dex)) continue;
      const key = hunter.p.uid + '>' + prey.p.uid;
      if ((this.cool.get(key) || 0) > now) continue;
      this.cool.set(key, now + H.cooldownSeconds * 1000);
      if (Math.random() > H.chance) continue;
      this.beginHunt(hunter, prey);
    }
  }

  beginHunt(hunter, prey) {
    const H = CFG.social.hunt;
    const it = { kind: 'hunt', a: hunter, b: prey, positive: false, phase: 'act', t: 0, dur: rand(H.seconds[0], H.seconds[1]) };
    hunter.busy = prey.busy = it;
    it.flee = this.fleePoint(prey, hunter);
    this.say(hunter, face(hunter.p, ['Determined', 'Angry']), 2.2);
    this.say(prey, face(prey.p, ['Teary-Eyed', 'Worried', 'Sad']), 2.2);
    this.active.push(it);
  }

  // Fluchtpunkt: vom Jäger weg, innerhalb des Areals
  fleePoint(prey, hunter) {
    const S = this.scene, s = S.area.spriteScale;
    let dx = prey.x - hunter.x, dy = prey.y - hunter.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    for (let k = 0; k < 6; k++) {
      const ang = Math.atan2(dy, dx) + rand(-0.9, 0.9);
      const pt = S.clampSafe({ x: prey.x + Math.cos(ang) * 70 * s, y: prey.y + Math.sin(ang) * 45 * s });
      if (Math.hypot(pt.x - hunter.x, pt.y - hunter.y) > d) return pt;
    }
    return S.randomPoint();
  }

  begin(kind, a, b, positive) {
    const S = this.scene, s = S.area.spriteScale;
    const it = { kind, a, b, positive, phase: 'approach', t: 0 };
    a.busy = b.busy = it;
    const mid = S.clampSafe({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const gap = kind === 'sleep' ? 14 * s : 18 * s;
    it.spotA = S.clampSafe({ x: mid.x - gap, y: mid.y });
    it.spotB = S.clampSafe({ x: mid.x + gap, y: mid.y });
    if (kind === 'chase') { it.phase = 'act'; it.dur = rand(3.5, 5); it.target = S.randomPoint(); }
    if (kind === 'grumpy') { it.phase = 'act'; it.dur = 2.8; this.say(a, 'Angry'); this.say(b, 'Sad'); it.away = S.randomPoint(); }
    this.active.push(it);
  }

  say(actor, emo, life) {
    this.bubbles = this.bubbles.filter((b) => b.actor !== actor);
    this.bubbles.push({ actor, emo, t: 0, life: life || CFG.social.behavior.portraitSeconds });
  }

  moveTo(actor, pt, speed, dt) {
    const dx = pt.x - actor.x, dy = pt.y - actor.y, d = Math.hypot(dx, dy);
    if (d < 1.5) return true;
    actor.state = 'walk';
    actor.dir = dirFromVector(dx, dy);
    const st = Math.min(d, speed * dt);
    actor.x += (dx / d) * st; actor.y += (dy / d) * st;
    return false;
  }
  face(a, b) { a.dir = dirFromVector(b.x - a.x, b.y - a.y); }

  step(it, dt) {
    const S = this.scene, speed = 16 * S.area.spriteScale;
    const { a, b } = it;
    if (!S.actors.has(a.p.uid) || !S.actors.has(b.p.uid) || a.dragging || b.dragging) return this.finish(it, false);
    it.t += dt;
    if (it.phase === 'approach') {
      const ra = this.moveTo(a, it.spotA, speed, dt), rb = this.moveTo(b, it.spotB, speed, dt);
      if ((ra && rb) || it.t > 6) {
        it.phase = 'act'; it.t = 0;
        this.face(a, b); this.face(b, a);
        a.state = b.state = 'idle'; a.t = b.t = 0;
        if (it.kind === 'talk') { it.dur = 3.2; this.say(a, happyFace(a.p)); setTimeout(() => this.say(b, happyFace(b.p)), 700); }
        if (it.kind === 'play') { it.dur = 2.6; a.state = b.state = 'hop'; this.say(a, 'Joyous', 1.6); this.say(b, 'Joyous', 1.6); }
        if (it.kind === 'sleep') { it.dur = rand(10, 16); a.state = b.state = 'sleep'; a.dir = b.dir = 0; }
        if (it.kind === 'argue') { it.dur = 3; this.say(a, 'Angry'); this.say(b, 'Angry'); }
      }
      return;
    }
    // Phase "act"
    if (it.kind === 'hunt') {
      const H = CFG.social.hunt, s = S.area.spriteScale;
      if (this.moveTo(b, it.flee, speed * H.preySpeed, dt)) it.flee = this.fleePoint(b, a);
      this.moveTo(a, { x: b.x, y: b.y }, speed * H.hunterSpeed, dt);
      // kommt der Jäger zu nahe: neuer Fluchtweg, ängstlicher Blick
      if (Math.hypot(a.x - b.x, a.y - b.y) < 14 * s && it.t - (it.close || -9) > 1.2) {
        it.close = it.t;
        it.flee = this.fleePoint(b, a);
        this.say(b, face(b.p, ['Teary-Eyed', 'Worried', 'Sad']), 1.4);
        this.say(a, face(a.p, ['Determined', 'Angry']), 1.4);
      }
    }
    if (it.kind === 'chase') {
      if (this.moveTo(a, it.target, speed * 1.9, dt)) it.target = S.randomPoint();
      this.moveTo(b, { x: a.x - 10, y: a.y }, speed * 1.8, dt);
      if (it.t < 0.1) { this.say(a, 'Joyous', 1.4); this.say(b, 'Happy', 1.4); }
    }
    if (it.kind === 'argue') {
      // gegenseitiges Anfauchen: kleines Ruckeln
      const j = Math.sin(it.t * 30) * 1.2;
      a.x += j * dt * 30; b.x -= j * dt * 30;
      a.state = b.state = Math.sin(it.t * 6) > 0 ? 'hop' : 'idle';
    }
    if (it.kind === 'grumpy') {
      this.face(b, a);
      b.state = 'idle';
      this.moveTo(a, it.away, speed * 1.4, dt);
    }
    if (it.t >= it.dur) this.finish(it, true);
  }

  finish(it, completed) {
    it.done = true;
    for (const x of [it.a, it.b]) { if (x.busy === it) x.busy = null; x.state = 'idle'; x.t = 0; x.timer = rand(1, 3); }
  }

  // Porträt-Blasen über den Köpfen
  draw(ctx, s) {
    for (const b of this.bubbles) {
      const a = b.actor;
      if (!a.box) continue;
      const img = portrait(a.p.dex, b.emo);
      if (!img.complete || !img.naturalWidth) continue;
      const pop = Math.min(1, b.t / 0.15) * Math.min(1, (b.life - b.t) / 0.25);
      const size = 26 * s * pop, x = a.x - size / 2, y = a.box.y - size - 8 * s;
      ctx.globalAlpha = Math.max(0, pop);
      ctx.fillStyle = '#fffbea';
      ctx.fillRect(x - 2 * s, y - 2 * s, size + 4 * s, size + 4 * s);
      ctx.fillStyle = '#4a3b33';
      ctx.fillRect(x - 2 * s, y + size + 2 * s, size + 4 * s, s);
      ctx.beginPath(); ctx.moveTo(a.x - 3 * s, y + size + 2 * s); ctx.lineTo(a.x + 3 * s, y + size + 2 * s); ctx.lineTo(a.x, y + size + 6 * s); ctx.fillStyle = '#fffbea'; ctx.fill();
      ctx.strokeStyle = '#4a3b33'; ctx.lineWidth = Math.max(1, s * 0.8);
      ctx.strokeRect(x - 2 * s, y - 2 * s, size + 4 * s, size + 4 * s);
      ctx.drawImage(img, x, y, size, size);
      ctx.globalAlpha = 1;
    }
  }
}

// erstes vorhandene Porträt aus einer Wunschliste
function face(p, list) {
  const sp = species(p.dex);
  return list.find((e) => sp.portraits.includes(e)) || 'Normal';
}
