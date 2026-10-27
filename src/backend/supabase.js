import { createClient } from '@supabase/supabase-js';

// "Angemeldet bleiben": an = Anmeldung in localStorage (bleibt nach Schließen des Browsers),
// aus = nur sessionStorage (endet mit dem Browser-Tab). Gespeichert wird hier nur die Anmeldung, nie der Spielstand.
const REMEMBER = 'freundesareale.remember';
export const getRemember = () => { try { return localStorage.getItem(REMEMBER) !== '0'; } catch { return true; } };
const authStorage = {
  getItem: (k) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => {
    try {
      if (getRemember()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
      else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
    } catch { /* Speicher blockiert */ }
  },
  removeItem: (k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ok */ } },
};

// Cloud-Backend. Die Datenbank ist die maßgebliche Quelle für den Spielstand.
export function createSupabaseBackend(url, anonKey) {
  const sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage } });
  const redirect = () => window.location.origin + window.location.pathname;
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };

  return {
    kind: 'supabase',
    async getUser() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session?.user || null)); },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
      if (error) {
        if (/REGISTRIERUNG_NICHT_FREIGEGEBEN|Database error saving new user/i.test(error.message)) throw new Error('Diese E-Mail-Adresse ist nicht für die Registrierung freigegeben.');
        throw error;
      }
      return { needsConfirmation: !data.session };
    },
    async signIn(email, password, remember = true) {
      try { localStorage.setItem(REMEMBER, remember ? '1' : '0'); } catch { /* ok */ }
      unwrap(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() })); },
    async updatePassword(password) { unwrap(await sb.auth.updateUser({ password })); },
    async serverNow() { return new Date(unwrap(await sb.rpc('server_now'))).getTime(); },
    async loadSave() {
      const row = unwrap(await sb.from('saves').select('data, version').maybeSingle());
      return row ? { data: row.data, version: row.version } : null;
    },
    async saveGame(data, expectedVersion) { return unwrap(await sb.rpc('save_game', { p_data: data, p_expected_version: expectedVersion })); },
    async listBackups() {
      return unwrap(await sb.from('save_backups').select('id, version, reason, created_at').order('created_at', { ascending: false }).limit(100));
    },
    async createBackup() { return unwrap(await sb.rpc('create_backup')); },
    async restoreBackup(id) { return unwrap(await sb.rpc('restore_backup', { p_backup_id: id })); },
    // Chaos-Rangliste (supabase/chaos_board.sql); fehlt die Funktion, gibt es keine Anzeige
    async chaosBoard() { const { data, error } = await sb.rpc('chaos_board'); return error ? null : data; },
    // Rennen: Anmeldungen aller für einen Tag (supabase/race_entries.sql); fehlt die Funktion, läuft man nur gegen den Computer
    async raceEntries(day) { const { data, error } = await sb.rpc('race_entries', { p_day: day }); return error ? null : data; },
  };
}
