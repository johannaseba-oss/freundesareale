// Einstellungen: Konto, Abmelden, Passwort ändern, Sicherungen ansehen/wiederherstellen.
import { app } from '../app.js';
import { h, modal, toast, confirmDialog } from './dom.js';

const REASON = { auto: 'Automatisch', taeglich: 'Täglich', manuell: 'Manuell', vor_wiederherstellung: 'Vor Wiederherstellung' };

export function openSettings({ onLogout, onRestored }) {
  modal(async (el, close) => {
    const list = h('div.backup-list', h('p.effects', 'Lade Sicherungen …'));
    const loadList = async () => {
      try {
        const rows = await app.backend.listBackups();
        list.replaceChildren(...(rows.length ? rows.map((b) => h('div.backup',
          h('span', new Date(b.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }), h('br'), h('small.effects', `${REASON[b.reason] || b.reason} · Version ${b.version}`)),
          h('button.btn.small', { onclick: async () => {
            if (!(await confirmDialog('Diesen Spielstand wiederherstellen? Dein aktueller Stand wird vorher automatisch gesichert.', 'Wiederherstellen'))) return;
            try { await app.saver.saveNow(); await app.backend.restoreBackup(b.id); close(); await onRestored(); toast('Spielstand wiederhergestellt.'); }
            catch (e) { toast('Wiederherstellen fehlgeschlagen: ' + e.message, true); }
          } }, 'Laden'))) : [h('p.effects', 'Noch keine Sicherungen. Sie entstehen automatisch beim Spielen (höchstens stündlich).')]));
      } catch (e) { list.replaceChildren(h('p.err', 'Sicherungen konnten nicht geladen werden: ' + e.message)); }
    };
    const pw = h('input', { type: 'password', placeholder: 'Neues Passwort (mind. 8 Zeichen)', autocomplete: 'new-password', style: { flex: 1, padding: '8px', border: '3px solid var(--line)', borderRadius: '10px' } });
    el.append(
      h('h3', 'Einstellungen'),
      h('p', 'Angemeldet als ', h('b', app.user.email)),
      h('p.effects', app.backend.kind === 'dev' ? '⚠ Entwicklungsmodus: Supabase ist noch nicht eingerichtet, gespeichert wird nur in diesem Browser.' : 'Dein Spielstand wird nach jeder Aktion in der Cloud gespeichert.'),
      h('hr'),
      h('b', 'Sicherungen'), list,
      h('div.row', h('button.btn', { onclick: async () => {
        try { await app.saver.saveNow(); await app.backend.createBackup(); toast('Sicherung erstellt.'); loadList(); } catch (e) { toast('Sicherung fehlgeschlagen: ' + e.message, true); }
      } }, 'Jetzt sichern')),
      h('hr'),
      h('b', 'Passwort ändern'),
      h('div.row', pw, h('button.btn.small', { onclick: async () => {
        if (pw.value.length < 8) return toast('Mindestens 8 Zeichen.', true);
        try { await app.backend.updatePassword(pw.value); pw.value = ''; toast('Passwort geändert.'); } catch (e) { toast(e.message, true); }
      } }, 'Speichern')),
      h('hr'),
      h('div.row', h('button.btn', { onclick: close }, 'Schließen'), h('button.btn', { onclick: async () => { close(); await onLogout(); } }, 'Abmelden')));
    loadList();
  });
}
