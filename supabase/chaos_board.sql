-- Chaos-Rangliste: bis zu welcher Welle es die anderen geschafft haben (mit Trainerbild).
-- Liest nur Trainername, Trainerbild und Chaos-Rekord aus den Spielständen – sonst nichts.
-- Im Supabase-Dashboard unter "SQL Editor" ausführen (mehrfaches Ausführen ist unschädlich).
create or replace function public.chaos_board()
returns table(me boolean, name text, sprite integer, best integer)
language sql stable security definer set search_path = public as $$
  select s.user_id = auth.uid(),
         left(coalesce(nullif(s.data->'profile'->>'name', ''), 'Trainer'), 16),
         coalesce((s.data->'profile'->>'sprite')::integer, 1),
         coalesce((s.data->'defense'->>'chaosBest')::integer, 0)
  from public.saves s
  where auth.uid() is not null
    and (coalesce((s.data->'defense'->>'chaosBest')::integer, 0) > 0 or s.user_id = auth.uid())
  order by 4 desc
  limit 30
$$;
revoke all on function public.chaos_board() from public, anon;
grant execute on function public.chaos_board() to authenticated;
