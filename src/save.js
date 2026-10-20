// Automatisches Cloud-Speichern nach jeder Aktion.
// Die Cloud ist maßgeblich. Nur wenn ein Speichern fehlschlägt, wird der ungespeicherte Stand zusätzlich
// lokal als "Ausgang" gepuffert und beim nächsten Versuch / nächsten Start hochgeladen.
const OUTBOX = 'freundesareale.outbox';

export class SaveManager {
  constructor(backend, userId, getState, version) {
    this.backend = backend;
    this.userId = userId;
    this.getState = getState;
    this.version = version;
    this.timer = null;
    this.saving = null;
    this.dirty = false;
    this.failures = 0;
    this.status = 'ok';
    this.listeners = new Set();
    this.onConflict = () => {};
    this.flushBound = () => { if (this.dirty) this.saveNow(); };
    window.addEventListener('online', this.flushBound);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushBound(); });
    window.addEventListener('pagehide', this.flushBound);
  }

  dispose() {
    clearTimeout(this.timer);
    window.removeEventListener('online', this.flushBound);
    window.removeEventListener('pagehide', this.flushBound);
    this.listeners.clear();
  }

  on(fn) { this.listeners.add(fn); fn(this.status, this.lastError); }
  setStatus(st, err) { this.status = st; this.lastError = err; for (const fn of this.listeners) fn(st, err); }

  // Aktion passiert -> speichern (gebündelt, wichtige Aktionen sofort)
  markDirty(immediate = false) {
    this.dirty = true;
    if (this.status === 'ok') this.setStatus('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), immediate ? 0 : 1200);
  }

  async saveNow() {
    clearTimeout(this.timer);
    if (this.saving) { this.again = true; return this.saving; }
    if (!this.dirty) return;
    this.dirty = false;
    const data = JSON.parse(JSON.stringify(this.getState()));
    this.setStatus('saving');
    this.saving = (async () => {
      try {
        const res = await this.backend.saveGame(data, this.version);
        if (res.ok) {
          this.version = res.version;
          this.failures = 0;
          localStorage.removeItem(OUTBOX);
          this.setStatus(this.dirty ? 'pending' : 'ok');
        } else if (res.conflict) {
          this.setStatus('conflict');
          this.onConflict(res.version);
        }
      } catch (err) {
        this.dirty = true;
        this.failures++;
        try { localStorage.setItem(OUTBOX, JSON.stringify({ user: this.userId, baseVersion: this.version, data, at: Date.now() })); } catch { /* voll */ }
        this.setStatus('error', err);
        const delay = Math.min(60, 5 * this.failures) * 1000;
        this.timer = setTimeout(() => this.saveNow(), delay);
      } finally {
        this.saving = null;
        if (this.again) { this.again = false; if (this.dirty) this.saveNow(); }
      }
    })();
    return this.saving;
  }

  // Beim Start: gibt es einen nicht hochgeladenen Stand, der auf der aktuellen Cloud-Version aufbaut?
  static takeOutbox(userId, cloudVersion) {
    try {
      const o = JSON.parse(localStorage.getItem(OUTBOX) || 'null');
      if (!o || o.user !== userId) return null;
      if (o.baseVersion !== cloudVersion) { localStorage.removeItem(OUTBOX); return null; } // Cloud ist neuer -> Cloud gewinnt
      return o.data;
    } catch { return null; }
  }
}
