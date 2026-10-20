import { createSupabaseBackend } from './supabase.js';

export async function createBackend() {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  // ?devcloud erzwingt im Entwicklungsmodus die simulierte Cloud (zum Testen ohne echte Datenbank)
  const forceDev = import.meta.env.DEV && new URLSearchParams(location.search).has('devcloud');
  if (url && key && !forceDev) return createSupabaseBackend(url, key);
  if (import.meta.env.DEV) {
    const { createDevBackend } = await import('./dev.js');
    return createDevBackend();
  }
  throw new Error('Supabase ist nicht eingerichtet (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen in .env.local).');
}
