-- ============================================================
-- UNDO rls_lockdown.sql — only if a screen breaks after the lockdown.
--
-- Puts the tables back to how they were before (open to the anon key), so
-- the dashboard works again while whatever broke is fixed. It re-opens the
-- security hole, so treat this as a few-hours measure, not a resting state.
-- meta_sync_runs and monthly_learnings go back to their original
-- "any signed-in user can read" policies.
--
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

do $$
declare p record;
declare t text;
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

  foreach t in array array['ads', 'ideas', 'copy_history', 'settings_lists', 'settings_targets', 'script_scenes', 'scripts', 'team_members']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I disable row level security', t);
    execute format('grant all on table public.%I to anon, authenticated', t);
  end loop;

  foreach t in array array['meta_sync_runs', 'monthly_learnings']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('create policy "signed-in read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- The helper functions are left in place on purpose: they're harmless, and
-- the app calls activate_my_membership() whether or not the lockdown is on.
