// Spielzeit = Serverzeit (verhindert, dass eine falsch gestellte Geräteuhr die Produktion verfälscht).
let offset = 0;
export const now = () => Date.now() + offset;
export function setServerTime(serverMs, sentAt, receivedAt) {
  const local = (sentAt + receivedAt) / 2;
  offset = serverMs - local;
}
export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

// Tages-Schlüssel für den Automaten (lokale Zeitzone, Tageswechsel zur konfigurierten Stunde)
export function dayKey(ms, startHour = 0) {
  const d = new Date(ms - startHour * HOUR);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function nextDayStart(ms, startHour = 0) {
  const d = new Date(ms - startHour * HOUR);
  d.setHours(24, 0, 0, 0);
  return d.getTime() + startHour * HOUR;
}
export function fmtDuration(ms) {
  if (ms <= 0) return 'gleich';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} Std. ${r} Min.` : `${h} Std.`;
  const d = Math.floor(h / 24);
  return `${d} T. ${h % 24} Std.`;
}
