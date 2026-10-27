-- Rennen: Anmeldungen aller Spielerinnen für einen Renntag (aus den Spielständen: data.race.entries[Tag]).
-- Liefert nur Trainername, Trainerbild, die Anmeldung (Pokémon + Rennwerte) und einen anonymen Schlüssel – sonst nichts.
-- Im Supabase-Dashboard unter "SQL Editor" ausführen (mehrfaches Ausführen ist unschädlich).
create or replace function public.race_entries(p_day text)
returns table(key text, me boolean, trainer text, sprite integer, entry jsonb)
language sql stable security definer set search_path = public as $$
  select md5(s.user_id::text),
         s.user_id = auth.uid(),
         left(coalesce(nullif(s.data->'profile'->>'name', ''), 'Trainer'), 16),
         coalesce((s.data->'profile'->>'sprite')::integer, 1),
         s.data->'race'->'entries'->p_day
  from public.saves s
  where auth.uid() is not null
    and p_day ~ '^\d{4}-\d{2}-\d{2}$'
    and s.data->'race'->'entries' ? p_day
$$;
revoke all on function public.race_entries(text) from public, anon;
grant execute on function public.race_entries(text) to authenticated;
