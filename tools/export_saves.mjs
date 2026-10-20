// Lädt ALLE Spielstände + Sicherungen aus Supabase in backups/<datum>.json (zusätzliche Sicherung außerhalb der Cloud).
// Braucht SUPABASE_SERVICE_ROLE_KEY in .env.local (nur auf deinem PC, niemals in die App!).
// Aufruf: npm run backup:export   – lässt sich z. B. per Windows-Aufgabenplanung täglich ausführen.
// Wiederherstellen eines Spielers: Inhalt von "data" im Supabase-Dashboard (Tabelle saves) einfügen
// oder die Sicherung in der App unter Einstellungen -> Sicherungen laden.
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY fehlt in .env.local'); process.exit(1); }
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const saves = await sb.from('saves').select('*');
const backups = await sb.from('save_backups').select('*').order('created_at', { ascending: false }).limit(2000);
if (saves.error || backups.error) { console.error(saves.error || backups.error); process.exit(1); }
const dir = path.join(ROOT, 'backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `spielstaende-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), saves: saves.data, backups: backups.data }, null, 1));
console.log(`${saves.data.length} Spielstände, ${backups.data.length} Sicherungen -> ${file}`);
