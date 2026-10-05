-- ============================================================
-- ASK THE DASHBOARD — saved conversations ("Chat history").
--
-- One row per conversation, owned by the person who started it. Each person
-- sees and edits only their own chats, and only while they're on the team
-- (is_team_member() comes from rls_lockdown.sql — run that first).
--
-- The browser reads and writes this table directly, like the other tables.
-- Without it the chat still works; conversations just aren't saved.
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ============================================================

create table if not exists public.ask_chats (
  id           uuid primary key,
  owner_email  text not null,
  title        text not null default 'New chat',
  turns        jsonb not null default '[]'::jsonb,   -- questions, answers, lookups, change cards, attachments
  auto_approve boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists ask_chats_owner_updated on public.ask_chats (lower(owner_email), updated_at desc);

alter table public.ask_chats enable row level security;
revoke all on table public.ask_chats from anon;

drop policy if exists "own chats only" on public.ask_chats;
create policy "own chats only" on public.ask_chats
  for all to authenticated
  using (public.is_team_member() and lower(owner_email) = lower(auth.jwt() ->> 'email'))
  with check (public.is_team_member() and lower(owner_email) = lower(auth.jwt() ->> 'email'));

-- Check
select 'ask_chats' as table_name, rowsecurity as rls_on,
       (select count(*) from pg_policies where tablename = 'ask_chats') as policies
from pg_tables where schemaname = 'public' and tablename = 'ask_chats';
