import './style.css';
import { loadConfig, species, CFG } from './config.js';
import { createBackend } from './backend/index.js';
import { app } from './app.js';
import { now, setServerTime } from './time.js';
import { newGame, migrate } from './game/state.js';
import { SaveManager } from './save.js';
import { showAuth, hideAuth } from './ui/auth.js';
import { $, h, toast, confirmDialog } from './ui/dom.js';
import { iconImg, berryImg } from './gfx/icons.js';
import { pending, setOnLand } from './ui/fly.js';
import { openInventory } from './ui/collect.js';
import { initAreas } from './ui/areas.js';
import { initCollection, render as renderCollection, setFilter } from './ui/collection.js';
import { ballCanvas } from './gfx/balls.js';
import { initGacha } from './ui/gacha.js';
import { closeSheet } from './ui/sheet.js';
import { openSettings } from './ui/settings.js';

let screensReady = false;
let recovery = false;
let starting = false;
let tickTimer = 0;

const bootMsg = (m) => { $('#boot').classList.remove('hidden'); $('#boot-msg').textContent = m; };
const hideBoot = () => $('#boot').classList.add('hidden');

async function syncServerTime() {
  const t0 = Date.now();
  const srv = await app.backend.serverNow();
  setServerTime(srv, t0, Date.now());
}

async function main() {
  try {
    await loadConfig();
    app.backend = await createBackend();
  } catch (e) {
    bootMsg('Start fehlgeschlagen: ' + e.message);
    return;
  }
  const be = app.backend;
  be.onAuth((event, user) => {
    if (event === 'PASSWORD_RECOVERY') { recovery = true; hideBoot(); showAuth(be, 'reset'); return; }
    if (event === 'SIGNED_IN' && user && !app.user && !recovery) startGame(user);
    if (event === 'SIGNED_OUT') stopGame();
  });
  $('#auth').addEventListener('password-updated', async () => {
    recovery = false;
    toast('Neues Passwort gespeichert.');
    const u = await be.getUser();
    if (u) startGame(u); else showAuth(be, 'login');
  });
  // Recovery-Link: Supabase meldet PASSWORD_RECOVERY kurz nach dem Laden
  if (/type=recovery/.test(location.hash)) { recovery = true; hideBoot(); showAuth(be, 'reset'); return; }
  const user = await be.getUser();
  if (user) startGame(user);
  else { hideBoot(); showAuth(be, 'login'); }
}

async function startGame(user) {
  if (starting || app.user) return;
  starting = true;
  hideAuth();
  bootMsg('Lade Spielstand …');
  try {
    await syncServerTime();
    const row = await app.backend.loadSave();
    let state, version, recovered = false;
    if (row) {
      version = row.version;
      const pending = SaveManager.takeOutbox(user.id, version);
      state = migrate(pending || row.data);
      recovered = !!pending;
    } else {
      state = newGame(now());
      version = 0;
    }
    app.user = user;
    app.state = state;
    app.saver = new SaveManager(app.backend, user.id, () => app.state, version);
    app.saver.onConflict = () => reloadFromCloud('Dein Spielstand wurde auf einem anderen Gerät geändert und neu geladen.');
    app.saver.on(updateSaveState);
    app.sync();
    if (!row || recovered) app.saver.markDirty(true);
    if (recovered) toast('Nicht gespeicherter Fortschritt wurde hochgeladen.');

    if (!screensReady) { initAreas(); initCollection(); await initGacha(); bindChrome(); screensReady = true; }
    $('#app').classList.remove('hidden');
    hideBoot();
    switchTab(state.pokemon.length ? 'areas' : 'gacha');
    app.refresh();
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 1000);
    if (!row) toast('Willkommen! Ziehe am Automaten dein erstes Pokémon.');
  } catch (e) {
    // Niemals mit leerem Stand weiterspielen, wenn das Laden scheitert – sonst droht Überschreiben.
    app.user = null;
    bootMsg('');
    $('#boot-msg').replaceChildren(
      h('p', 'Der Spielstand konnte nicht geladen werden.'), h('small', e.message || String(e)), h('br'), h('br'),
      h('button.btn.primary', { onclick: () => startGame(user) }, 'Erneut versuchen'), ' ',
      h('button.btn', { onclick: () => app.backend.signOut() }, 'Abmelden'));
  } finally {
    starting = false;
  }
}

async function reloadFromCloud(msg) {
  const row = await app.backend.loadSave();
  if (!row) return;
  app.state = migrate(row.data);
  app.saver.version = row.version;
  app.saver.dirty = false;
  app.saver.setStatus('ok');
  closeSheet();
  app.sync();
  app.refresh();
  if (msg) toast(msg);
}

function stopGame() {
  clearInterval(tickTimer);
  app.saver?.dispose();
  app.saver = null;
  app.state = null;
  app.user = null;
  closeSheet();
  $('#app').classList.add('hidden');
  hideBoot();
  showAuth(app.backend, 'login');
}

function tick() {
  if (!app.state) return;
  app.sync();
  for (const p of app.state.pokemon) {
    if (p.levelUps) { toast(`${species(p.dex).name} ist jetzt Level ${p.level}!`); p.levelUps = 0; app.saver.markDirty(); }
  }
  app.refresh();
}

let lastHud = '';
function renderHud() {
  if (!app.state) return;
  const shown = Math.max(0, app.state.coins - pending.coins); // fliegende Münzen zählen erst beim Ankommen
  const berries = Math.max(0, Object.values(app.state.berries || {}).reduce((a, b) => a + b, 0) - pending.berries);
  const free = app.state.pokemon.filter((p) => !p.area).length;
  const key = shown + '|' + berries + '|' + free;
  if (key === lastHud) return;
  lastHud = key;
  $('#hud-coins').replaceChildren(iconImg('coin', 3), String(shown));
  $('#hud-bag').replaceChildren(berryImg('sinelbeere', 2), String(berries));
  const ball = ballCanvas('pokeball', 2); ball.className = 'ico';
  $('#hud-box').replaceChildren(ball, String(free));
}

function updateSaveState(status, err) {
  const el = $('#hud-save');
  el.className = 'save-state ' + status;
  el.textContent = { ok: 'Gespeichert', pending: 'Ungespeichert', saving: 'Speichert …', error: 'Fehler', conflict: 'Konflikt' }[status];
  const banner = $('#banner');
  if (status === 'error') {
    banner.classList.remove('hidden');
    banner.replaceChildren(h('span', `Speichern fehlgeschlagen (${err?.message || 'keine Verbindung'}). Neuer Versuch läuft automatisch – bitte App nicht löschen.`),
      h('button.btn.small', { onclick: () => app.saver.saveNow() }, 'Jetzt erneut'));
  } else if (status === 'ok') banner.classList.add('hidden');
}

function switchTab(tab) {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const id of ['areas', 'collection', 'gacha']) $('#scr-' + id).classList.toggle('hidden', id !== tab);
  if (tab === 'collection') renderCollection(true);
  app.refresh();
}

function bindChrome() {
  for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => switchTab(b.dataset.tab);
  app.views.add(renderHud);
  setOnLand(renderHud);
  $('#hud-bag').onclick = openInventory;
  $('#hud-box').onclick = () => { setFilter('frei'); switchTab('collection'); };
  $('#hud-settings').onclick = () => openSettings({
    onLogout: async () => {
      if (app.saver.dirty || app.saver.status === 'error') {
        try { await app.saver.saveNow(); } catch { /* Status zeigt Fehler */ }
        if (app.saver.status === 'error' && !(await confirmDialog('Der letzte Fortschritt ist noch nicht in der Cloud gespeichert. Trotzdem abmelden? Er geht dann verloren.', 'Abmelden'))) return;
      }
      await app.backend.signOut();
      stopGame();
    },
    onRestored: async () => reloadFromCloud(),
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !app.state) return;
    try { await syncServerTime(); } catch { /* offline: Gerätezeit + letzter Offset */ }
    // Auf anderem Gerät weitergespielt? Dann Cloud-Stand übernehmen.
    try {
      const row = await app.backend.loadSave();
      if (row && row.version !== app.saver.version && !app.saver.dirty) await reloadFromCloud('Spielstand von einem anderen Gerät geladen.');
    } catch { /* offline */ }
    tick();
  });
}

// Testhaken für die Entwicklung
if (import.meta.env.DEV) { window.__fa = app; app.CFG = CFG; import('./game/actions.js').then((m) => { app.A = m; }); }

main();

if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
