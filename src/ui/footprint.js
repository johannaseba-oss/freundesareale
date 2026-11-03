// Fußabdruck-Minispiel: Auswahl der Modi, Krakeelos Ansage, die Runde mit Zeitblöcken und Krakeelos Urteil, am Ende der Rang.
import { CFG, species } from '../config.js';
import { app } from '../app.js';
import * as FP from '../game/footprint.js';
import { loadSprites, frameOf, portraitUrl } from '../gfx/sprites.js';
import { h } from './dom.js';
import { setMusic, playFile } from '../audio.js';
import { haptic } from '../haptics.js';

const F = () => CFG.footprint;
const ART = `${import.meta.env.BASE_URL}art/footprint/`;
const name = (d) => species(d).name;
const fill = (txt, v) => txt.replace(/\{(\w+)\}/g, (_, k) => v[k]);
const any = (list) => list[Math.floor(Math.random() * list.length)];
const sound = (k) => { const s = F().sounds[k]; playFile(s.file, s.vol); };

export function renderFootprintSetup(el, back) {
  const best = (m) => { const b = app.state.footprint?.best?.[m]; return b ? h('small.fp-best', `Bestes Ergebnis: Rang ${b.rank} · ${b.correct}/${F().rounds} · ${b.points} Punkte`) : ''; };
  const again = () => renderFootprintSetup(el, back);
  el.replaceChildren(h('div.bs',
    h('button.btn.small.mode-back', { onclick: back }, '‹ Zurück'),
    h('img.fp-banner', { src: ART + 'tile.webp', alt: '' }),
    h('button.mode-card', { onclick: () => start(FP.classicRound, again) }, h('b', 'Fußabdruck raten'), h('small', `${F().rounds} Fußabdrücke: Wem gehört er? Erst nur Namen, dann kommen Porträts und Sprites als Hinweise.`), best('classic')),
    h('button.mode-card', { onclick: () => start(FP.guardRound, again) }, h('b', 'Türsteher'), h('small', 'Nur Namen, keine Hinweise – dafür eine schwarze Liste oder eine Gästeliste. Lass nur herein, wer darf!'), best('guard'))));
}

function start(makeRound, onClose) {
  const root = h('div.fp');
  document.body.append(root); document.body.classList.add('in-battle'); setMusic('menu');
  let raf = 0, timer = 0, closed = false, at = 0, points = 0, correct = 0;
  const close = () => { cancelAnimationFrame(raf); clearTimeout(timer); closed = true; root.remove(); document.body.classList.remove('in-battle'); onClose(); };
  const round = makeRound(), guard = round.mode === 'guard';
  // Bilder der ganzen Runde schon laden, damit später nichts ruckelt
  new Image().src = ART + 'gitter.png';
  const sprites = new Map();
  for (const q of round.questions) {
    new Image().src = `${ART}p/${q.dex}.png`;
    if (!guard) for (const d of q.options) { new Image().src = portraitUrl(d); if (!sprites.has(d)) sprites.set(d, loadSprites(d, null, false)); }
  }

  const speech = (text, emotion = 'Normal', onTap = null) => h('div.fp-say', onTap ? { onclick: onTap } : {}, h('img.fp-who', { src: portraitUrl(F().announcer, emotion), alt: 'Krakeelo' }), h('p', text));
  const shell = (...kids) => root.replaceChildren(h('button.fp-close', { onclick: close, title: 'Beenden' }, '✕'), ...kids);
  const listStrip = () => h('div.fp-list.' + round.type, round.list.map((d) => h('img', { src: portraitUrl(d), alt: '' })));

  // Türsteher: erst die Liste ansehen
  const showList = () => shell(h('div.fp-intro',
    h('h2.' + (round.type === 'black' ? 'fp-black' : 'fp-green'), round.type === 'black' ? '⛔ Schwarze Liste' : '✅ Gästeliste'),
    speech(F().texts.guardIntro[round.type]),
    listStrip(), h('button.btn.primary.big', { onclick: () => { sound('tap'); ask(); } }, 'Los geht’s!')));

  function ask() {
    if (closed) return;
    if (at >= round.questions.length) return finish();
    const q = round.questions[at], T = F().texts, total = FP.totalSeconds(), bps = F().blocksPerSecond;
    let upTo = 0;
    const blocks = F().phases.flatMap((p) => { const from = upTo; upTo += p.seconds; return Array.from({ length: Math.round(p.seconds * bps) }, (_, i) => ({ at: from + (i + 1) / bps, el: h('i', { style: { background: p.color } }) })); });
    const print = h('img.fp-print', { src: `${ART}p/${q.dex}.png`, alt: 'Fußabdruck' });
    const say = h('div.fp-saybox', speech(guard ? T.guardAsk[round.type] : T.ask));
    const cards = q.options.map((d) => {
      const por = h('div.fp-por'), spr = h('canvas.fp-spr', { width: 64, height: 64 });
      const card = guard
        ? h('button.fp-card.names', { onclick: () => answer(d) }, h('b', name(d)))
        : h('button.fp-card', { onclick: () => answer(d) }, h('div.fp-boxes', por, h('div.fp-sprbox', spr)), h('b', name(d)));
      return { d, card, por, spr };
    });
    const reject = h('button.btn.fp-reject', { onclick: () => answer('reject') }, '⛔ Abweisen');
    const pts = h('span', `${points} P`);
    const parts = [h('div.fp-top', { style: { backgroundImage: `url(${ART}gitter.png)` } }, print, h('div.fp-count', h('span', `${at + 1}/${round.questions.length}`), pts)),
      h('div.fp-time', blocks.map((b) => b.el))];
    if (guard && F().guard.listVisible) parts.push(listStrip());
    parts.push(h('div.fp-cards', cards.map((c) => c.card)));
    if (guard) parts.push(reject);
    parts.push(say);
    shell(...parts);
    let done = false, shown = 'name', second = 0;
    sound('enter');
    const t0 = performance.now();
    const showAt = (t) => { let s = 0; for (const p of F().phases) { s += p.seconds; if (t < s) return p.show; } return F().phases.at(-1).show; };
    const reveal = (c) => { if (!c.por.firstChild) c.por.append(h('img', { src: portraitUrl(c.d), alt: '' })); };
    const drawSprite = (c, ms) => {
      const e = sprites.get(c.d); if (!e?.ready) return;
      const f = frameOf(e, 'Idle', 0, ms), x = c.spr.getContext('2d'), k = Math.min(64 / f.fw, 64 / f.fh, 2);
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, 64, 64);
      x.drawImage(f.img, f.sx, f.sy, f.fw, f.fh, 32 - (f.fw * k) / 2, 32 - (f.fh * k) / 2, f.fw * k, f.fh * k);
    };
    const loop = (ms) => {
      if (closed || done) return;
      const t = (ms - t0) / 1000;
      blocks.forEach((b) => b.el.classList.toggle('off', t >= b.at)); // abgelaufene Blöcke verschwinden
      if (Math.floor(t) > second && t < total) { second = Math.floor(t); sound('tick'); }
      if (!guard) {
        const now = showAt(t);
        if (now !== shown) { shown = now; haptic('tick'); }
        if (shown !== 'name') cards.forEach(reveal);
        if (shown === 'sprite') cards.forEach((c) => drawSprite(c, ms));
      }
      if (t >= total) return answer(null); // Zeit um: das Pokémon geht einfach, zählt als Fehlversuch
      raf = requestAnimationFrame(loop);
    };
    function answer(pick) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      const t = (performance.now() - t0) / 1000, ok = pick != null && FP.isCorrect(round, q.dex, pick);
      cards.forEach((c) => { c.card.disabled = true; });
      reject.disabled = true;
      cards.find((c) => c.d === pick)?.card.classList.add('picked');
      if (pick != null) sound('tap');
      print.classList.add('leave'); // Fußabdruck zieht nach oben hinaus, erst danach die Auflösung
      haptic('tick');
      timer = setTimeout(() => {
        if (ok) { correct++; points += FP.pointsFor(Math.max(0, 1 - t / total)); haptic('medium'); }
        sound(ok ? 'right' : 'wrong');
        pts.textContent = `${points} P`;
        const v = { guess: pick && pick !== 'reject' ? name(pick) : '', real: name(q.dex) };
        const allowed = !guard || FP.mayEnter(round, q.dex);
        const msg = pick == null ? fill(T.timeout, v)
          : ok ? (allowed ? any(T.right) : fill(T.guardRejectRight[round.type], v))
          : pick === 'reject' ? fill(T.guardRejectWrong, v)
          : pick === q.dex ? fill(T.guardLetInWrong[round.type], v)
          : fill(T.wrong, v);
        const realCard = cards.find((c) => c.d === q.dex), pickedCard = cards.find((c) => c.d === pick);
        realCard.card.classList.add('right');
        if (!guard) reveal(realCard);
        if (pickedCard && pickedCard !== realCard) pickedCard.card.classList.add('wrong');
        const next = () => { clearTimeout(timer); at++; ask(); };
        say.replaceChildren(speech(msg, ok ? 'Happy' : 'Angry', next));
        say.classList.add(ok ? 'good' : 'bad');
        timer = setTimeout(next, F().messageMs);
      }, F().slideMs);
    }
    raf = requestAnimationFrame(loop);
    if (import.meta.env.DEV) app.footprint = { round, q, answer, cards, get at() { return at; }, get points() { return points; }, get correct() { return correct; } };
  }

  function finish() {
    const rank = FP.rankOf(points), r = app.act((s) => FP.saveResult(s, round.mode, points, correct), true);
    shell(h('div.fp-end',
      h('div.fp-rank', { style: { color: rank.color } }, rank.id),
      h('h2', `${correct} von ${round.questions.length} richtig`),
      h('p', `${points} Punkte${r?.isNew ? ' – neue Bestleistung!' : ''}`),
      h('div.row', h('button.btn.primary', { onclick: () => { close(); start(makeRound, onClose); } }, 'Nochmal'), h('button.btn', { onclick: close }, 'Fertig'))));
    sound('rank');
    if (rank.min >= 60) haptic('strong');
  }

  // Krakeelo erklärt kurz, dann geht es los
  shell(h('div.fp-intro',
    h('img.fp-who.big', { src: portraitUrl(F().announcer, 'Happy'), alt: 'Krakeelo' }),
    h('div.fp-say', h('p', F().texts.intro)),
    h('button.btn.primary.big', { onclick: () => { sound('tap'); if (guard) showList(); else ask(); } }, F().texts.introOk)));
}
