import sharp from 'sharp';
const [src, out, step='50'] = process.argv.slice(2);
const m = await sharp(src).metadata(); const s=+step;
let svg = `<svg width="${m.width}" height="${m.height}">`;
for (let x=0;x<m.width;x+=s) svg+=`<line x1="${x}" y1="0" x2="${x}" y2="${m.height}" stroke="${x%(s*2)?'#0f0':'#f0f'}" stroke-width="1"/><text x="${x+2}" y="12" font-size="11" fill="#f0f">${x}</text>`;
for (let y=0;y<m.height;y+=s) svg+=`<line x1="0" y1="${y}" x2="${m.width}" y2="${y}" stroke="${y%(s*2)?'#0f0':'#f0f'}" stroke-width="1"/><text x="2" y="${y+12}" font-size="11" fill="#f0f">${y}</text>`;
svg+='</svg>';
await sharp(src).composite([{input:Buffer.from(svg)}]).png().toFile(out);
