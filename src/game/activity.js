// Tag-/Nachtaktivität laut Wildnisprofil (Tag / Nacht / Dämmerung / Wechselnd)
import { CFG } from '../config.js';

export function isActiveNow(dex, date = new Date()) {
  const act = CFG.social.activity;
  const ranges = act.hours[CFG.dexById.get(dex)?.active] || act.hours.Tag;
  const h = date.getHours() + date.getMinutes() / 60;
  return ranges.some(([from, to]) => h >= from && h < to);
}
