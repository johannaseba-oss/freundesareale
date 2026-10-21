// Wetter-Effekte auf dem Spielfeld (Regen, Schnee, Wind, Sonne, Wolken, Nacht) für Arena und PokeDefense.
// st: Zustand für Partikel (wx, wxKind), w: Wetter-ID, W/H: Größe, T: Feldgröße
export function drawWeather(x, st, w, W, H, T, dt, now) {
  const A = st;
  if (A.wxKind !== w) { // Partikel für das neue Wetter
    A.wxKind = w;
    const n = { regen: 70, schnee: 55, wind: 34, sonne: 6, bewoelkt: 4, nacht: 18 }[w] || 0;
    A.wx = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.5 + Math.random() * 0.8, s: Math.random() }));
  }
  const tint = { sonne: 'rgba(255,200,80,.10)', regen: 'rgba(50,80,150,.13)', schnee: 'rgba(225,235,255,.16)', wind: 'rgba(230,240,220,.06)', nacht: 'rgba(15,25,70,.34)', bewoelkt: 'rgba(110,115,130,.16)' }[w];
  if (tint) { x.fillStyle = tint; x.fillRect(0, 0, W, H); }
  const px = Math.max(2, Math.round(T / 14));
  for (const p of A.wx) {
    if (w === 'regen') { p.y += H * 1.6 * p.v * dt; p.x += H * 0.25 * dt; x.fillStyle = 'rgba(200,220,255,.65)'; for (let k = 0; k < 4; k++) x.fillRect(p.x - k * px * 0.3, p.y - k * px, px * 0.7, px); }
    else if (w === 'schnee') { p.y += H * 0.12 * p.v * dt; p.x += Math.sin(now / 700 + p.s * 9) * 12 * dt; x.fillStyle = '#ffffff'; x.fillRect(p.x, p.y, px, px); }
    else if (w === 'wind') { p.x += W * 0.9 * p.v * dt; p.y += Math.sin(now / 300 + p.s * 7) * 8 * dt; x.fillStyle = p.s < 0.3 ? '#5fae3a' : 'rgba(255,255,255,.7)'; if (p.s < 0.3) x.fillRect(p.x, p.y, px * 2, px * 1.5); else x.fillRect(p.x, p.y, T * 1.1, Math.max(2, px * 0.7)); }
    else if (w === 'sonne') { p.x += 6 * dt; x.fillStyle = 'rgba(255,240,170,.08)'; x.save(); x.translate(p.x, 0); x.rotate(0.35); x.fillRect(0, -H * 0.2, T * (0.5 + p.s), H * 1.6); x.restore(); }
    else if (w === 'bewoelkt') { p.x += 10 * p.v * dt; x.fillStyle = 'rgba(40,40,60,.07)'; x.beginPath(); x.ellipse(p.x, p.y, T * 2.5, T * 1.2, 0, 0, 7); x.fill(); }
    else if (w === 'nacht') { const a = 0.4 + 0.4 * Math.sin(now / 400 + p.s * 20); x.fillStyle = `rgba(255,250,170,${a})`; x.fillRect(p.x, p.y, px, px); } // Glühwürmchen
    if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W; }
    if (p.x > W + T * 3) { p.x = -T * 3; p.y = Math.random() * H; }
  }
}
