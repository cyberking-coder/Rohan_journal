-- Phase 7 — AI performance reports.
--
-- Safe to re-run. Run in the Supabase SQL editor after phase6.sql.
--
-- ── On why generation is not done in the browser ───────────────────────────
-- Calling an LLM needs an API key. Anything the browser can read, an attacker
-- can read: a compromised dependency, a malicious extension, or anyone with
-- the laptop. So the key lives in a Supabase Edge Function
-- (`supabase/functions/generate-report/`) and never reaches the client.
--
-- The same argument applies to the weekly quota. A quota checked in React is
-- decoration — the user can call the REST endpoint directly. So this table
-- has NO insert policy: rows are written only by the edge function, which
-- runs with the service role and counts the week's usage before it spends
-- anything on generation.

create table if not exists public.ai_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- Monday 00:00 UTC of the week this report was generated in. Stored rather
  -- than derived at read time so the quota count is a plain indexed equality
  -- check, and so a change to the reset rule can't retroactively re-bucket
  -- reports that were already charged against an old week.
  week_start    date not null,

  title         text not null,
  -- One or two sentences shown collapsed in the archive list.
  summary       text not null default '',
  -- [{ heading, body, tone }] — the report proper. Kept as jsonb because the
  -- section list is the model's to choose; pinning it to columns would mean a
  -- migration every time the prompt changes shape.
  sections      jsonb not null default '[]'::jsonb,

  -- What the report was actually written from, so an old report can be read
  -- honestly later ("this covered 41 trades to 12 Aug") instead of looking
  -- like a claim about today.
  period_start  timestamptz,
  period_end    timestamptz,
  trade_count   integer not null default 0,

  model         text,
  -- Token usage, for anyone who wants to know what this costs to run.
  input_tokens  integer,
  output_tokens integer,

  created_at    timestamptz not null default now()
);

comment on table public.ai_reports is
  'AI-written performance reviews. Written only by the generate-report edge function; the browser reads and deletes.';
comment on column public.ai_reports.week_start is
  'Monday 00:00 UTC of the generating week — the quota bucket.';

create index if not exists ai_reports_user_created_idx
  on public.ai_reports (user_id, created_at desc);
-- The quota count is `where user_id = ? and week_start = ?`, run on every
-- generate attempt.
create index if not exists ai_reports_quota_idx
  on public.ai_reports (user_id, week_start);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.ai_reports enable row level security;

drop policy if exists "ai reports - read own" on public.ai_reports;
drop policy if exists "ai reports - delete own" on public.ai_reports;
-- Deliberately absent: insert and update. See the header — a client that could
-- insert here could mint itself unlimited quota, and one that could update
-- could rewrite history. Generation goes through the edge function.

create policy "ai reports - read own" on public.ai_reports
  for select using (auth.uid() = user_id);

create policy "ai reports - delete own" on public.ai_reports
  for delete using (auth.uid() = user_id);
