-- ============================================================
-- RLS LOCKDOWN — only people on the team can read or change data.
--
-- Why: until this runs, anyone holding the public anon key (it ships in the
-- website's code) can read and write ads, the team list, settings, ideas and
-- scripts with no login at all — measured 2026-08-19 and again 2026-10-05.
-- Public sign-up is also open, so "any logged-in user" is not a boundary
-- either: a stranger can make an account. The rule here is "your login email
-- is on team_members".
--
-- What it does NOT touch: the server routes (Ask the dashboard, Meta sync,
-- monthly learnings, the agent API, invites) use the service-role key, which
-- bypasses RLS. They keep working exactly as before.
--
-- Safe to run more than once. Undo: rls_lockdown_rollback.sql.
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

-- ---- 1. Who counts as a team member ----------------------------------------
-- security definer: reads team_members without going through its own RLS,
-- which would otherwise make every policy below recurse into itself.
create or replace function public.is_team_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where lower(tm.email) = lower(auth.jwt() ->> 'email')
  );
$$;

create or replace function public.is_founder()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where lower(tm.email) = lower(auth.jwt() ->> 'email')
      and tm.role = 'Founder'
  );
$$;

-- An invited person finishing password setup marks themselves active. Before
-- this, the browser updated team_members directly — which, under the rules
-- below, would also have let anyone edit their own role. This flips status
-- and nothing else.
create or replace function public.activate_my_membership()
returns void
language sql security definer
set search_path = public
as $$
  update public.team_members
     set status = 'active'
   where lower(email) = lower(auth.jwt() ->> 'email')
     and status is distinct from 'active';
$$;

revoke all on function public.is_team_member() from public, anon;
revoke all on function public.is_founder() from public, anon;
revoke all on function public.activate_my_membership() from public, anon;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.is_founder() to authenticated;
grant execute on function public.activate_my_membership() to authenticated;

-- ---- 2. Clear out every existing policy on these tables -------------------
-- Policies are OR-ed together: one old "allow everyone" policy left in place
-- would keep the table wide open no matter what is added below.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('ads', 'ideas', 'copy_history', 'settings_lists', 'settings_targets',
                        'team_members', 'meta_sync_runs', 'monthly_learnings', 'script_scenes', 'scripts')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ---- 3. Team-only tables: members read and write, nobody else -------------
do $$
declare t text;
begin
  foreach t in array array['ads', 'ideas', 'copy_history', 'settings_lists', 'settings_targets', 'script_scenes', 'scripts']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table not found', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format(
      'create policy "team members only" on public.%I for all to authenticated
         using (public.is_team_member()) with check (public.is_team_member())', t);
  end loop;
end $$;

-- ---- 4. Server-written tables: members read, only the server writes -------
-- (The service role bypasses RLS, so no write policy is needed for it.)
do $$
declare t text;
begin
  foreach t in array array['meta_sync_runs', 'monthly_learnings']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table not found', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format(
      'create policy "team members read" on public.%I for select to authenticated
         using (public.is_team_member())', t);
  end loop;
end $$;

-- ---- 5. The team list: members read it, only a Founder changes it ---------
-- Settings → Team adds members and changes roles from the browser (Founder
-- only in the UI); this makes that true in the database too. Invites and
-- removals go through server routes and are unaffected.
alter table public.team_members enable row level security;
revoke all on table public.team_members from anon;

create policy "team members read the team" on public.team_members
  for select to authenticated using (public.is_team_member());
create policy "founders add members" on public.team_members
  for insert to authenticated with check (public.is_founder());
create policy "founders edit members" on public.team_members
  for update to authenticated using (public.is_founder()) with check (public.is_founder());
create policy "founders remove members" on public.team_members
  for delete to authenticated using (public.is_founder());

-- ---- 6. Check: what is now protected --------------------------------------
select tablename, rowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) as policies
from pg_tables t
where schemaname = 'public'
  and tablename in ('ads', 'ideas', 'copy_history', 'settings_lists', 'settings_targets',
                    'team_members', 'meta_sync_runs', 'monthly_learnings', 'script_scenes', 'scripts')
order by tablename;
