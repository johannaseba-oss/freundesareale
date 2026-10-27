// NUR FÜR DIE ENTWICKLUNG: simuliert Supabase im Browser, solange noch keine Zugangsdaten eingetragen sind.
// Wird im Produktions-Build nie verwendet (siehe backend/index.js).
const KEY = 'freundesareale.dev-cloud';
const db = () => JSON.parse(localStorage.getItem(KEY) || '{"users":{},"saves":{},"backups":[],"session":null,"seq":1}');
const put = (d) => localStorage.setItem(KEY, JSON.stringify(d));
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
let authCb = () => {};

export function createDevBackend() {
  const uid = () => db().session;
  return {
    kind: 'dev',
    failNextSaves: 0, // Testhaken: __fa.backend.failNextSaves = 2
    async getUser() { const id = uid(); return id ? { id, email: db().users[id].email } : null; },
    onAuth(cb) { authCb = cb; },
    async signUp(email, password) {
      await wait(); const d = db();
      if (Object.values(d.users).some((u) => u.email === email)) throw new Error('Benutzer existiert bereits.');
      const id = 'dev-' + Math.random().toString(36).slice(2, 10);
      d.users[id] = { email, password }; d.session = id; put(d);
      authCb('SIGNED_IN', { id, email });
      return { needsConfirmation: false };
    },
    async signIn(email, password, remember = true) {
      await wait(); const d = db();
      const id = Object.keys(d.users).find((k) => d.users[k].email === email && d.users[k].password === password);
      if (!id) throw new Error('Invalid login credentials');
      d.session = id; put(d); authCb('SIGNED_IN', { id, email });
    },
    async signOut() { const d = db(); d.session = null; put(d); authCb('SIGNED_OUT', null); },
    async resetPassword() { await wait(); },
    async updatePassword(password) { const d = db(); d.users[d.session].password = password; put(d); },
    async serverNow() { await wait(30); return Date.now(); },
    async loadSave() { await wait(); const s = db().saves[uid()]; return s ? structuredClone(s) : null; },
    async saveGame(data, expected) {
      await wait();
      if (this.failNextSaves > 0) { this.failNextSaves--; throw new Error('Netzwerkfehler (simuliert)'); }
      const d = db(), id = uid(), cur = d.saves[id];
      if ((cur?.version || 0) !== expected) return { ok: false, conflict: true, version: cur?.version || 0 };
      if (cur) d.backups.push({ id: d.seq++, user: id, data: cur.data, version: cur.version, reason: 'auto', created_at: new Date().toISOString() });
      d.saves[id] = { data, version: expected + 1 }; put(d);
      return { ok: true, version: expected + 1 };
    },
    async listBackups() { return db().backups.filter((b) => b.user === uid()).reverse().slice(0, 100).map(({ id, version, reason, created_at }) => ({ id, version, reason, created_at })); },
    async createBackup() { const d = db(), s = d.saves[uid()]; d.backups.push({ id: d.seq++, user: uid(), data: s.data, version: s.version, reason: 'manuell', created_at: new Date().toISOString() }); put(d); return { ok: true }; },
    async chaosBoard() {
      const d = db(), me = uid();
      return Object.entries(d.saves).map(([id, s]) => ({ me: id === me, name: s.data?.profile?.name || 'Trainer', sprite: s.data?.profile?.sprite || 1, best: s.data?.defense?.chaosBest || 0 }))
        .filter((r) => r.best > 0 || r.me).sort((a, b) => b.best - a.best).slice(0, 30);
    },
    async raceEntries(day) {
      const d = db(), me = uid();
      return Object.entries(d.saves).filter(([, s]) => s.data?.race?.entries?.[day]).map(([id, s]) => ({ key: id, me: id === me, trainer: s.data?.profile?.name || 'Trainer', sprite: s.data?.profile?.sprite || 1, entry: s.data.race.entries[day] }));
    },
    async restoreBackup(bid) {
      const d = db(), id = uid(), b = d.backups.find((x) => x.id === bid && x.user === id), cur = d.saves[id];
      d.backups.push({ id: d.seq++, user: id, data: cur.data, version: cur.version, reason: 'vor_wiederherstellung', created_at: new Date().toISOString() });
      d.saves[id] = { data: b.data, version: cur.version + 1 }; put(d);
      return { ok: true, version: cur.version + 1 };
    },
  };
}
