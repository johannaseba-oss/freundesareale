-- Freundesareale – Supabase-Schema
-- Einmal komplett im Supabase-Dashboard unter "SQL Editor" ausführen (mehrfaches Ausführen ist unschädlich).

-- =====================================================================
-- 1) Freigabeliste: nur diese E-Mail-Adressen dürfen sich registrieren
-- =====================================================================
create table if not exists public.allowed_emails (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
-- Keine Policies: Spieler können die Liste weder lesen noch ändern.
-- Pflege nur über Dashboard / SQL, z. B.:
--   insert into public.allowed_emails(email, note) values ('du@example.com', 'ich');

create or replace function public.enforce_allowlist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)) then
    raise exception 'REGISTRIERUNG_NICHT_FREIGEGEBEN';
  end if;
  return new;
end $$;

drop trigger if exists enforce_allowlist on auth.users;
create trigger enforce_allowlist before insert on auth.users
  for each row execute function public.enforce_allowlist();

-- =====================================================================
-- 2) Spielstände: genau einer pro Benutzer
-- =====================================================================
create table if not exists public.saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.saves enable row level security;
drop policy if exists "eigenen Spielstand lesen" on public.saves;
create policy "eigenen Spielstand lesen" on public.saves for select to authenticated using (auth.uid() = user_id);
-- Schreiben nur über save_game() (prüft Version gegen gleichzeitige Geräte).

-- =====================================================================
-- 3) Sicherungen (Verlauf)
-- =====================================================================
create table if not exists public.save_backups (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  version integer not null,
  reason text not null,          -- auto | taeglich | manuell | vor_wiederherstellung
  created_at timestamptz not null default now()
);
create index if not exists save_backups_user_idx on public.save_backups(user_id, created_at desc);
alter table public.save_backups enable row level security;
drop policy if exists "eigene Sicherungen lesen" on public.save_backups;
create policy "eigene Sicherungen lesen" on public.save_backups for select to authenticated using (auth.uid() = user_id);

-- =====================================================================
-- 4) Funktionen
-- =====================================================================
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now() $$;

-- Speichert den Spielstand. Gelingt nur, wenn p_expected_version der Version in der Datenbank entspricht
-- (sonst wurde inzwischen auf einem anderen Gerät gespeichert -> conflict).
-- Legt höchstens stündlich automatisch eine Sicherung des vorherigen Stands an.
create or replace function public.save_game(p_data jsonb, p_expected_version integer)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur public.saves;
  last_auto timestamptz;
begin
  if uid is null then raise exception 'NICHT_ANGEMELDET'; end if;
  if pg_column_size(p_data) > 5000000 then raise exception 'SPIELSTAND_ZU_GROSS'; end if;

  select * into cur from public.saves where user_id = uid for update;
  if not found then
    if p_expected_version <> 0 then
      return json_build_object('ok', false, 'conflict', true, 'version', 0);
    end if;
    insert into public.saves(user_id, data, version) values (uid, p_data, 1);
    return json_build_object('ok', true, 'version', 1);
  end if;

  if cur.version <> p_expected_version then
    return json_build_object('ok', false, 'conflict', true, 'version', cur.version);
  end if;

  select max(created_at) into last_auto from public.save_backups where user_id = uid and reason = 'auto';
  if last_auto is null or last_auto < now() - interval '1 hour' then
    insert into public.save_backups(user_id, data, version, reason) values (uid, cur.data, cur.version, 'auto');
    -- automatische Sicherungen 30 Tage aufbewahren (manuelle/tägliche bleiben länger, siehe unten)
    delete from public.save_backups where user_id = uid and reason = 'auto' and created_at < now() - interval '30 days';
  end if;

  update public.saves set data = p_data, version = cur.version + 1, updated_at = now() where user_id = uid;
  return json_build_object('ok', true, 'version', cur.version + 1);
end $$;

create or replace function public.create_backup()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur public.saves;
begin
  if uid is null then raise exception 'NICHT_ANGEMELDET'; end if;
  select * into cur from public.saves where user_id = uid;
  if not found then raise exception 'KEIN_SPIELSTAND'; end if;
  insert into public.save_backups(user_id, data, version, reason) values (uid, cur.data, cur.version, 'manuell');
  -- höchstens 50 manuelle Sicherungen behalten
  delete from public.save_backups where id in (
    select id from public.save_backups where user_id = uid and reason = 'manuell' order by created_at desc offset 50);
  return json_build_object('ok', true);
end $$;

-- Stellt eine Sicherung wieder her. Der aktuelle Stand wird vorher selbst gesichert.
create or replace function public.restore_backup(p_backup_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b public.save_backups; cur public.saves;
begin
  if uid is null then raise exception 'NICHT_ANGEMELDET'; end if;
  select * into b from public.save_backups where id = p_backup_id and user_id = uid;
  if not found then raise exception 'SICHERUNG_NICHT_GEFUNDEN'; end if;
  select * into cur from public.saves where user_id = uid for update;
  if found then
    insert into public.save_backups(user_id, data, version, reason) values (uid, cur.data, cur.version, 'vor_wiederherstellung');
    update public.saves set data = b.data, version = cur.version + 1, updated_at = now() where user_id = uid;
    return json_build_object('ok', true, 'version', cur.version + 1);
  end if;
  insert into public.saves(user_id, data, version) values (uid, b.data, 1);
  return json_build_object('ok', true, 'version', 1);
end $$;

revoke all on function public.save_game(jsonb, integer) from public, anon;
revoke all on function public.create_backup() from public, anon;
revoke all on function public.restore_backup(bigint) from public, anon;
grant execute on function public.save_game(jsonb, integer) to authenticated;
grant execute on function public.create_backup() to authenticated;
grant execute on function public.restore_backup(bigint) to authenticated;
grant execute on function public.server_now() to authenticated, anon;

-- =====================================================================
-- 5) Tägliche Sicherung (optional, empfohlen)
--    Dashboard -> Database -> Extensions -> "pg_cron" aktivieren, dann diesen Block ausführen.
-- =====================================================================
-- select cron.schedule('freundesareale-taeglich', '0 3 * * *', $job$
--   insert into public.save_backups(user_id, data, version, reason)
--     select user_id, data, version, 'taeglich' from public.saves;
--   delete from public.save_backups where reason = 'taeglich' and created_at < now() - interval '180 days';
-- $job$);
