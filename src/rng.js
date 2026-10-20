export function hashString(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return (h ^ (h >>> 16)) >>> 0;
}
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function weightedPick(items, weightOf, rnd = Math.random) {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let r = rnd() * total;
  for (const it of items) { r -= weightOf(it); if (r < 0) return it; }
  return items[items.length - 1];
}
