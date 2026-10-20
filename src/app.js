// Gemeinsamer Zustand + Aktions-Wrapper: simulieren -> Aktion -> automatisch speichern -> neu zeichnen.
import { now } from './time.js';
import { simulate } from './game/sim.js';
import { ensureDailyPool } from './game/gacha.js';
import { toast } from './ui/dom.js';

export const app = {
  state: null,
  backend: null,
  user: null,
  saver: null,
  views: new Set(),

  sync() {
    if (!this.state) return;
    simulate(this.state, now());
    if (ensureDailyPool(this.state, now(), this.user.id)) this.saver?.markDirty();
  },

  // fn(state, t) -> {ok, msg?}; immediate = sofort speichern (wichtige Aktionen)
  act(fn, immediate = false) {
    this.sync();
    const r = fn(this.state, now()) || { ok: true };
    if (r.ok === false) { if (r.msg) toast(r.msg, true); return r; }
    this.saver.markDirty(immediate);
    this.refresh();
    return r;
  },

  refresh() { for (const v of this.views) v(); },
};
