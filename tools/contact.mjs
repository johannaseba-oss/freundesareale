import sharp from 'sharp'; import fs from 'fs'; import path from 'path';
const dir = process.argv[2], out = process.argv[3];
const files = fs.readdirSync(dir).filter(f => /\.(gif|png|jpg)$/i.test(f)).slice(0, 20);
const W = 276, H = 204, cols = 4, rows = Math.ceil(files.length / cols);
const comps = [];
for (let i = 0; i < files.length; i++) {
  const buf = await sharp(path.join(dir, files[i])).resize(W, H, { fit: 'contain', background: '#000' }).png().toBuffer();
  const svg = Buffer.from(`<svg width="${W}" height="16"><rect width="${W}" height="16" fill="black"/><text x="2" y="12" font-size="11" fill="white">${i} ${files[i].slice(0,40)}</text></svg>`);
  comps.push({ input: buf, left: (i % cols) * W, top: Math.floor(i / cols) * (H + 16) + 16 }, { input: svg, left: (i % cols) * W, top: Math.floor(i / cols) * (H + 16) });
}
await sharp({ create: { width: cols * W, height: rows * (H + 16), channels: 3, background: '#222' } }).composite(comps).png().toFile(out);
