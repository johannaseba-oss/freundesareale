// Musik (Hintergrund in den Arealen) und Soundeffekte (per WebAudio erzeugt, passend zum Element der Attacke).
// Lautstärken sind Geräte-Einstellungen (localStorage); Browser erlauben Ton erst nach dem ersten Antippen.
const base = import.meta.env.BASE_URL;
const KEY = 'freundesareale.audio';
const load = () => { try { return { music: 0.5, sfx: 0.6, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { music: 0.5, sfx: 0.6 }; } };
export const audioSettings = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(audioSettings)); } catch { /* privat */ } };

// ---------- Musik ----------
// Musik je Bereich (public/config/music.json): 'areas' (Playlist), 'menu', 'arena', 'chaos' oder ein Level-Stück 'track:<name>'.
// Wechsel werden kurz übergeblendet; null = Stille (z. B. App im Hintergrund).
import { CFG } from './config.js';
let music = null, musicGain = null, want = null, playing = null, unlocked = false, lastFile = null, fadeTimer = 0;
function player() {
  if (!music) {
    music = new Audio();
    music.preload = 'auto';
    music.addEventListener('ended', () => { if (playing === 'areas' || Array.isArray(CFG.music?.[playing])) start(want, true); }); // Playlist: nächstes Zufallsstück
    // über WebAudio leiten, damit die Lautstärke überall wirkt (Safari/iPhone ignoriert audio.volume)
    if (ctx()) { musicGain = ac.createGain(); ac.createMediaElementSource(music).connect(musicGain); musicGain.connect(bus); }
  }
  return music;
}
// Lautstärke der Musik setzen (über den Verstärker, sonst direkt am Element)
function setVol(v) { if (musicGain) { musicGain.gain.cancelScheduledValues(ac.currentTime); musicGain.gain.value = v; } else if (music) music.volume = v; }
const getVol = () => (musicGain ? musicGain.gain.value : music ? music.volume : 0);
export const musicState = () => ({ routed: !!musicGain, level: getVol(), playing, paused: music?.paused ?? true }); // zum Prüfen
// welche Datei zu einem Bereich gehört
function fileFor(key) {
  const M = CFG.music;
  if (!key || !M) return null;
  if (key.startsWith('track:')) return key.slice(6);
  const v = M[key];
  if (!Array.isArray(v)) return v || null;
  // Liste: zufälliges Stück – möglichst nicht dasselbe wie gerade eben
  const pool = v.length > 1 ? v.filter((f) => f !== lastFile) : v;
  return pool[Math.floor(Math.random() * pool.length)];
}
function start(key, force = false) {
  const m = player(), file = fileFor(key);
  clearInterval(fadeTimer);
  if (!file || audioSettings.music <= 0) { m.pause(); playing = null; return; }
  if (!force && playing === key && !m.paused) return;
  // sofort umschalten (noch innerhalb des Antippens – sonst blockiert Safari auf dem iPhone den Start) und weich einblenden
  m.src = `${base}audio/${file}.mp3`;
  lastFile = file;
  m.loop = !Array.isArray(CFG.music?.[key]); // einzelne Stücke laufen in Schleife, Listen wechseln zufällig
  playing = key;
  if (musicGain) { musicGain.gain.cancelScheduledValues(ac.currentTime); musicGain.gain.setValueAtTime(0.0001, ac.currentTime); musicGain.gain.setTargetAtTime(audioSettings.music, ac.currentTime, 0.25); }
  else setVol(audioSettings.music);
  m.play().catch(() => {});
}
// key = gewünschter Musik-Bereich (siehe oben)
let lastKey = null;
export const resumeMusic = () => setMusic(lastKey); // nach dem Zurückkehren in die App weiterspielen
export function setMusic(key) {
  want = key || null;
  if (want) lastKey = want;
  if (!unlocked) return;
  if (!want) { clearInterval(fadeTimer); if (music) music.pause(); playing = null; return; }
  start(want);
}
export const musicForLevel = (types) => (CFG.music?.byType[types?.[0]] ? 'track:' + CFG.music.byType[types[0]] : 'menu');
export function setMusicVolume(v) {
  audioSettings.music = v; save();
  clearInterval(fadeTimer);
  setVol(v);
  if (v > 0 && want && unlocked && (!music || music.paused)) start(want, true);
  else if (v <= 0 && music) { music.pause(); playing = null; }
}
export function setSfxVolume(v) { audioSettings.sfx = v; save(); }
// erstes Antippen schaltet Ton frei
window.addEventListener('pointerdown', () => {
  if (unlocked) return;
  unlocked = true; ctx(); setMusic(want);
  for (const n of ['muenze', 'muenzeinwurf', 'mechanik', 'ballfall', 'seife', 'wasser']) loadBuf(n); // vorladen
}, { capture: true });

// ---------- Soundeffekte ----------
let ac = null, master = null, bus = null, noiseBuf = null;
function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // größerer Audiopuffer ('balanced'): kurze Lastspitzen (Sprites laden, Zeichnen) reißen keine Lücken in die Musik
    try { ac = new AC({ latencyHint: 'balanced' }); } catch { ac = new AC(); }
    // gemeinsamer Ausgang für Musik und Geräusche mit Begrenzer: mehrere gleichzeitige Geräusche plus Musik
    // dürfen die Summe nicht über Vollaussteuerung treiben (sonst übersteuert die ganze Mischung hörbar)
    bus = ac.createDynamicsCompressor();
    bus.threshold.value = -8; bus.knee.value = 6; bus.ratio.value = 12; bus.attack.value = 0.003; bus.release.value = 0.2;
    bus.connect(ac.destination);
    master = ac.createGain(); master.connect(bus);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
// Grundbausteine: Ton mit Tonhöhenverlauf und Rauschen mit Filter
function tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(filter, f0, f1, dur, vol = 0.3, delay = 0, q = 1) {
  const t = ac.currentTime + delay, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; fl.type = filter; fl.Q.value = q;
  fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
// Klang je Element
const TYPE_SFX = {
  Feuer: () => { noise('bandpass', 400, 1500, 0.28, 0.35, 0, 0.8); tone('sawtooth', 120, 60, 0.2, 0.08); },
  Wasser: () => { tone('sine', 900, 280, 0.16, 0.3); noise('lowpass', 1800, 400, 0.18, 0.12, 0.02); },
  Elektro: () => { for (let i = 0; i < 4; i++) tone('square', 1400 + Math.random() * 1600, 600 + Math.random() * 900, 0.045, 0.1, i * 0.03); },
  Pflanze: () => { tone('triangle', 520, 760, 0.09, 0.28); noise('highpass', 3000, 5000, 0.06, 0.08); },
  Eis: () => { tone('sine', 2100, 1800, 0.18, 0.18); tone('sine', 2800, 2500, 0.16, 0.12, 0.05); noise('highpass', 6000, 8000, 0.1, 0.06); },
  Gestein: () => { noise('lowpass', 500, 120, 0.25, 0.5); tone('sine', 110, 55, 0.22, 0.25); },
  Boden: () => { noise('lowpass', 350, 90, 0.3, 0.5); tone('sine', 80, 45, 0.28, 0.3); },
  Kampf: () => { noise('lowpass', 1200, 300, 0.1, 0.45); tone('sine', 160, 70, 0.12, 0.3); },
  Normal: () => { noise('bandpass', 900, 500, 0.08, 0.35, 0, 1.2); tone('sine', 220, 120, 0.09, 0.2); },
  Flug: () => { noise('bandpass', 700, 2600, 0.22, 0.25, 0, 0.6); },
  Psycho: () => { tone('sine', 440, 880, 0.25, 0.18); tone('sine', 660, 1320, 0.25, 0.12, 0.03); },
  Geist: () => { tone('triangle', 300, 520, 0.3, 0.16); tone('sine', 305, 500, 0.3, 0.12); },
  Gift: () => { for (let i = 0; i < 3; i++) tone('sine', 300 + i * 120, 500 + i * 140, 0.07, 0.18, i * 0.05); },
  Käfer: () => { tone('sawtooth', 210, 240, 0.14, 0.1); tone('square', 420, 380, 0.1, 0.06); },
  Drache: () => { tone('sawtooth', 140, 70, 0.3, 0.16); noise('lowpass', 800, 200, 0.25, 0.2); },
  Unlicht: () => { tone('sawtooth', 260, 90, 0.2, 0.12); noise('lowpass', 900, 200, 0.14, 0.2); },
  Stahl: () => { tone('square', 900, 880, 0.12, 0.1); tone('square', 1350, 1330, 0.14, 0.07); tone('sine', 2700, 2600, 0.2, 0.05); },
  Fee: () => { [1320, 1760, 2093].forEach((f, i) => tone('sine', f, f, 0.12, 0.14, i * 0.04)); },
};
// gedrosselt, damit viele gleichzeitige Treffer nicht übersteuern
let recent = [];
function allow(max = 10) {
  const now = performance.now();
  recent = recent.filter((t) => now - t < 1000);
  if (recent.length >= max) return false;
  recent.push(now);
  return true;
}
function ready() { if (!unlocked || audioSettings.sfx <= 0 || !ctx()) return false; master.gain.value = audioSettings.sfx; return true; }

// Aufgenommene Geräusche (public/audio/sfx/<name>.wav): einmal abspielen oder in Schleife (z. B. beim Putzen)
const buffers = new Map();
function loadBuf(name) {
  if (!buffers.has(name)) buffers.set(name, fetch(`${base}audio/sfx/${name}.wav`).then((r) => r.arrayBuffer()).then((b) => new Promise((res, rej) => ac.decodeAudioData(b, res, rej))).catch(() => null));
  return buffers.get(name);
}
export function playFile(name, vol = 1) {
  if (!ready()) return;
  loadBuf(name).then((buf) => {
    if (!buf) return;
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = buf; g.gain.value = vol; s.connect(g); g.connect(master); s.start();
  });
}
export function loopFile(name, vol = 1) {
  let src = null, g = null, stopped = false;
  if (!ready()) return { stop() {} };
  loadBuf(name).then((buf) => {
    if (!buf || stopped) return;
    src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    g = ac.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(vol, ac.currentTime, 0.04);
    src.connect(g); g.connect(master); src.start();
  });
  return { stop() { stopped = true; if (g) { g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.06); src.stop(ac.currentTime + 0.3); } } };
}
let lastCoin = 0;

export const sfx = {
  coin() { const t = performance.now(); if (t - lastCoin < 70) return; lastCoin = t; playFile('muenze', 0.6); }, // Münze landet im Zähler
  attack(type) { if (ready() && allow()) (TYPE_SFX[type] || TYPE_SFX.Normal)(); },
  hit() { if (ready() && allow(12)) { noise('lowpass', 1100, 180, 0.07, 0.3); tone('sine', 200, 90, 0.06, 0.18); } }, // einfacher Treffer
  bite() { if (ready() && allow(12)) { noise('bandpass', 1400, 600, 0.04, 0.3, 0, 1.5); noise('bandpass', 1300, 500, 0.04, 0.26, 0.07, 1.5); } }, // Gegner schnappt zu
  crit() { if (!ready()) return; noise('lowpass', 2000, 200, 0.25, 0.5); tone('square', 880, 1760, 0.12, 0.12, 0.02); },
  ko() { if (ready() && allow(14)) { tone('square', 660, 1320, 0.08, 0.1); tone('square', 990, 1980, 0.1, 0.08, 0.06); } },
  explosion() { if (!ready()) return; noise('lowpass', 1500, 60, 0.7, 0.8); tone('sine', 90, 30, 0.6, 0.5); },
  star() { if (ready()) { tone('sine', 1320, 1320, 0.08, 0.16); tone('sine', 1980, 1980, 0.12, 0.14, 0.06); } },
  place() { if (ready()) { noise('lowpass', 600, 150, 0.12, 0.3); tone('sine', 300, 180, 0.1, 0.15); } },
  wave(final) { if (!ready()) return; [392, 523, final ? 622 : 659].forEach((f, i) => tone('square', f, f, 0.16, 0.08, i * 0.12)); },
  levelUp() { if (ready() && allow(14)) [784, 988, 1175].forEach((f, i) => tone('triangle', f, f, 0.1, 0.12, i * 0.06)); },
  evolve() { if (!ready()) return; [523, 659, 784, 1047, 1319].forEach((f, i) => tone('sine', f, f * 1.01, 0.2, 0.14, i * 0.09)); },
  lose() { if (ready()) [392, 330, 262].forEach((f, i) => tone('triangle', f, f * 0.98, 0.3, 0.14, i * 0.22)); },
  win() { if (ready()) [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.25, 0.14, i * 0.14)); },
};
if (import.meta.env.DEV) window.__audio = { musicState, setMusicVolume }; // Testhaken
