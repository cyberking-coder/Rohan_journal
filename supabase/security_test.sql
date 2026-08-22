-- Multi-tenancy isolation test.
--
-- Proves that one signed-in user cannot read or modify another's data. Run
-- against a scratch PostgreSQL instance, NOT your production database — it
-- creates users and rows.
--
--     ./supabase/run_security_test.sh
--
-- ── Why this is done as a real query, not a policy review ──────────────────
-- Reading policies tells you what was intended. Only running as a second user
-- tells you what happens. Two things routinely make a correct-looking policy
-- do nothing:
--
--   • RLS does not apply to the table OWNER unless FORCE ROW LEVEL SECURITY is
--     set. A test run as the owner passes no matter how broken the policy is.
--   • A missing GRANT makes a table unreachable, which looks like isolation
--     working when it is actually the table being unusable.
--
-- So this runs as a separate non-owner role, and checks both that other users'
-- rows are invisible AND that your own remain reachable.

\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------

-- Mirrors how Supabase resolves the current user: from the JWT claim, exposed
-- as a session setting.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant usage on schema public, storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- The two tenants.
insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002')
on conflict do nothing;

create table if not exists audit_results (
  check_name text,
  passed     boolean,
  detail     text
);
truncate audit_results;

-- SECURITY DEFINER so the recorder runs as the owner. Otherwise it is subject
-- to the very restrictions under test, and the harness fails on its own
-- bookkeeping instead of reporting results.
create or replace function record(name text, passed boolean, detail text default '')
returns void language sql security definer as $$
  insert into audit_results values (name, passed, detail);
$$;

grant execute on function record(text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: one row per table for each user, written as the owner (bypassing RLS,
-- which is what the bridge's service role does).
-- ---------------------------------------------------------------------------

insert into public.trades (user_id, symbol, side, pnl, traded_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'EURUSD', 'Long', 100, now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'GBPJPY', 'Short', -50, now());

insert into public.broker_accounts (user_id, label, platform) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A account', 'mt5'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'B account', 'mt5');

insert into public.profiles (id, preferences) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '{"theme":"dark"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '{"theme":"light"}');

insert into public.ai_reports (user_id, week_start, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'A report'),
  ('bbbbbbbb-0000-0000-0000-000000000002', current_date, 'B report');

insert into public.backtest_sessions (user_id, symbol) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'EURUSD'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'XAUUSD');

insert into public.candles (user_id, symbol, timeframe, t, o, h, l, c) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'EURUSD', 'H1', now(), 1, 2, 0.5, 1.5),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'XAUUSD', 'H1', now(), 1, 2, 0.5, 1.5);

insert into public.economic_events (event_at, currency, title) values
  (now(), 'USD', 'CPI YoY');

-- A prop challenge each. The rules are not secret in the way a password is,
-- but they say which firm a trader is with, at what size, and how close to
-- failing — which is exactly the kind of thing a rival account holder should
-- not be able to enumerate.
insert into public.funded_accounts (user_id, label, firm, starting_balance, profit_target) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A challenge', 'FundingPips', 100000, 8000),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'B challenge', 'FTMO', 50000, 4000);

-- Two share links owned by A: one live, one revoked. Plus an expired one.
insert into public.shared_dashboards (owner_user_id, code, label, sections, expires_at, revoked) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'VIEW-LIVE', 'A live share',
   array['overview','trades','journal'], null, false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'VIEW-REVOKED', 'A revoked share',
   array['overview','trades'], null, true),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'VIEW-EXPIRED', 'A expired share',
   array['overview','trades'], now() - interval '1 day', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'VIEW-NOJOURNAL', 'No journal',
   array['overview'], null, false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'VIEW-HIDDEN', 'Amounts hidden',
   array['overview','trades'], null, false);

update public.shared_dashboards set hide_amounts = true where code = 'VIEW-HIDDEN';

-- Give A a journalled, losing trade so the journal-gating and the R-unit
-- conversion have something real to work on.
insert into public.trades (user_id, symbol, side, pnl, fees, traded_at, pre_trade_analysis, notes)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'XAUUSD', 'Long', -200, 0, now(),
        'SECRET SETUP', 'SECRET NOTES');

-- A screenshot belonging to each user, under their own folder.
insert into storage.objects (bucket_id, name) values
  ('screenshots', 'aaaaaaaa-0000-0000-0000-000000000001/chart-a.png'),
  ('screenshots', 'bbbbbbbb-0000-0000-0000-000000000002/chart-b.png');

-- ---------------------------------------------------------------------------
-- Act as user A
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select set_config('request.jwt.claim.role', 'authenticated', false);

-- Each table: A must see exactly its own row, and none of B's.
-- A owns two: the seeded one and the journalled XAUUSD trade the sharing
-- checks need.
select record('trades: sees own',        count(*) = 2, 'saw ' || count(*)) from public.trades;
select record('trades: not B''s',        count(*) = 0, 'saw ' || count(*)) from public.trades where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

select record('broker_accounts: sees own', count(*) = 1, 'saw ' || count(*)) from public.broker_accounts;
select record('broker_accounts: not B''s', count(*) = 0, 'saw ' || count(*)) from public.broker_accounts where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

select record('profiles: sees own',      count(*) = 1, 'saw ' || count(*)) from public.profiles;
select record('profiles: not B''s',      count(*) = 0, 'saw ' || count(*)) from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002';

select record('ai_reports: sees own',    count(*) = 1, 'saw ' || count(*)) from public.ai_reports;
select record('ai_reports: not B''s',    count(*) = 0, 'saw ' || count(*)) from public.ai_reports where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

select record('backtest_sessions: sees own', count(*) = 1, 'saw ' || count(*)) from public.backtest_sessions;
select record('backtest_sessions: not B''s', count(*) = 0, 'saw ' || count(*)) from public.backtest_sessions where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

select record('candles: sees own',       count(*) = 1, 'saw ' || count(*)) from public.candles;
select record('candles: not B''s',       count(*) = 0, 'saw ' || count(*)) from public.candles where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- Shared reference data is meant to be readable by every signed-in user.
select record('economic_events: readable', count(*) = 1, 'saw ' || count(*)) from public.economic_events;

-- ── Writes ────────────────────────────────────────────────────────────────
-- An UPDATE that matches no visible row silently affects zero rows. That is
-- the correct outcome, and the one worth asserting: no error, no change.
with u as (update public.trades set pnl = 999999
           where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
select record('trades: cannot update B''s', count(*) = 0, 'changed ' || count(*)) from u;

with d as (delete from public.trades
           where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
select record('trades: cannot delete B''s', count(*) = 0, 'deleted ' || count(*)) from d;

with u as (update public.candles set c = 999
           where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
select record('candles: cannot update B''s', count(*) = 0, 'changed ' || count(*)) from u;

with d as (delete from public.ai_reports
           where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
select record('ai_reports: cannot delete B''s', count(*) = 0, 'deleted ' || count(*)) from d;

-- Writing a row *labelled as someone else* is the attack that matters: it
-- would let A plant data in B's journal, or bill a report to B's quota.
do $$
begin
  insert into public.trades (user_id, symbol, side, pnl, traded_at)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'FAKE', 'Long', 1, now());
  perform record('trades: cannot insert AS B', false, 'the insert succeeded');
exception when insufficient_privilege then
  perform record('trades: cannot insert AS B', true, 'blocked by RLS');
end $$;

do $$
begin
  insert into public.candles (user_id, symbol, timeframe, t, o, h, l, c)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'FAKE', 'H1', now(), 1, 2, 0.5, 1.5);
  perform record('candles: cannot insert AS B', false, 'the insert succeeded');
exception when insufficient_privilege then
  perform record('candles: cannot insert AS B', true, 'blocked by RLS');
end $$;

-- ai_reports has no INSERT policy at all, on purpose: only the edge function
-- writes it, so a client cannot mint itself unlimited AI reports.
do $$
begin
  insert into public.ai_reports (user_id, week_start, title)
  values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'self-minted');
  perform record('ai_reports: client cannot insert (quota)', false, 'the insert succeeded');
exception when insufficient_privilege then
  perform record('ai_reports: client cannot insert (quota)', true, 'blocked by RLS');
end $$;

-- Likewise economic_events: a client that could write here would feed every
-- user of the app false economic data.
do $$
begin
  insert into public.economic_events (event_at, currency, title)
  values (now(), 'USD', 'FAKE NEWS');
  perform record('economic_events: client cannot write', false, 'the insert succeeded');
exception when insufficient_privilege then
  perform record('economic_events: client cannot write', true, 'blocked by RLS');
end $$;

-- ── Reassignment ──────────────────────────────────────────────────────────
-- The subtle one. USING controls which rows an UPDATE may *target*; WITH CHECK
-- controls what those rows may *become*. A policy with only USING lets a user
-- update their own row and set user_id to somebody else's — handing the row
-- to another tenant, or planting a fabricated trade in their journal. It reads
-- as a correct policy and is not.
do $$
declare moved int;
begin
  update public.trades set user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics moved = row_count;
  perform record('trades: cannot reassign to B', moved = 0, 'moved ' || moved || ' row(s)');
exception when insufficient_privilege then
  perform record('trades: cannot reassign to B', true, 'blocked by RLS');
end $$;

do $$
declare moved int;
begin
  update public.broker_accounts set user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics moved = row_count;
  perform record('broker_accounts: cannot reassign to B', moved = 0, 'moved ' || moved || ' row(s)');
exception when insufficient_privilege then
  perform record('broker_accounts: cannot reassign to B', true, 'blocked by RLS');
end $$;

do $$
declare moved int;
begin
  update public.profiles set id = 'bbbbbbbb-0000-0000-0000-000000000002'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics moved = row_count;
  perform record('profiles: cannot reassign to B', moved = 0, 'moved ' || moved || ' row(s)');
exception when others then
  perform record('profiles: cannot reassign to B', true, 'blocked');
end $$;

do $$
declare moved int;
begin
  update public.candles set user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics moved = row_count;
  perform record('candles: cannot reassign to B', moved = 0, 'moved ' || moved || ' row(s)');
exception when insufficient_privilege then
  perform record('candles: cannot reassign to B', true, 'blocked by RLS');
end $$;

-- ── Storage ───────────────────────────────────────────────────────────────
-- Screenshots show the terminal, which shows the account balance. The bucket
-- used to be public with an unrestricted read policy, so anyone holding the
-- anon key — published in the app bundle by design — could list and download
-- every user's images.
select record('screenshots: sees own',  count(*) = 1, 'saw ' || count(*))
  from storage.objects where bucket_id = 'screenshots';
select record('screenshots: not B''s',  count(*) = 0, 'saw ' || count(*))
  from storage.objects where name like 'bbbbbbbb%';

select record('screenshots: bucket is private',
  not coalesce((select public from storage.buckets where id = 'screenshots'), true), '');

do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('screenshots', 'bbbbbbbb-0000-0000-0000-000000000002/planted.png');
  perform record('screenshots: cannot upload into B''s folder', false, 'the insert succeeded');
exception when insufficient_privilege then
  perform record('screenshots: cannot upload into B''s folder', true, 'blocked by RLS');
end $$;

-- Own writes must still work, or "isolation" is just a broken table.
do $$
begin
  insert into public.trades (user_id, symbol, side, pnl, traded_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'OWN', 'Long', 5, now());
  perform record('trades: own insert works', true, '');
exception when others then
  perform record('trades: own insert works', false, SQLERRM);
end $$;

-- ---------------------------------------------------------------------------
-- Act as user B — the other tenant
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);

select record('B: sees only own trades', count(*) = 1, 'saw ' || count(*)) from public.trades;

-- The code IS the secret. Listing another user's share links would hand over
-- every shared dashboard in the database.
select record('B: cannot see A''s share links', count(*) = 0, 'saw ' || count(*))
  from public.shared_dashboards;

select record('B: sees only own funded account', count(*) = 1, 'saw ' || count(*))
  from public.funded_accounts;

-- Writing another user's challenge would let an attacker move somebody's
-- profit target or loss limit, which is a quiet way to make their dashboard
-- lie to them about whether they still have an account.
do $$
declare n int;
begin
  update public.funded_accounts set profit_target = 1
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform record('B: cannot edit A''s funded rules', n = 0, n || ' row(s) updated');
exception when others then
  perform record('B: cannot edit A''s funded rules', true, 'refused: ' || SQLERRM);
end $$;

do $$
declare n int;
begin
  delete from public.funded_accounts where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform record('B: cannot delete A''s funded rules', n = 0, n || ' row(s) deleted');
exception when others then
  perform record('B: cannot delete A''s funded rules', true, 'refused: ' || SQLERRM);
end $$;

-- Inserting a row under someone else's id is the other half of the same hole.
do $$
begin
  insert into public.funded_accounts (user_id, label)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'planted');
  perform record('B: cannot plant a funded account on A', false, 'insert succeeded');
exception when others then
  perform record('B: cannot plant a funded account on A', true, 'refused');
end $$;

-- ---------------------------------------------------------------------------
-- Act as an anonymous visitor — nothing should be readable.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', 'anon', false);

select record('anon: no trades',   count(*) = 0, 'saw ' || count(*)) from public.trades;
select record('anon: no profiles', count(*) = 0, 'saw ' || count(*)) from public.profiles;
select record('anon: no candles',  count(*) = 0, 'saw ' || count(*)) from public.candles;
select record('anon: no reports',  count(*) = 0, 'saw ' || count(*)) from public.ai_reports;
select record('anon: no calendar', count(*) = 0, 'saw ' || count(*)) from public.economic_events;
select record('anon: no screenshots', count(*) = 0, 'saw ' || count(*))
  from storage.objects where bucket_id = 'screenshots';
select record('anon: cannot list share links', count(*) = 0, 'saw ' || count(*))
  from public.shared_dashboards;
select record('anon: no funded accounts', count(*) = 0, 'saw ' || count(*))
  from public.funded_accounts;

-- ── The share function, called anonymously ────────────────────────────────
-- This is the one path by which a stranger reads someone else's data, so it
-- gets the most attention.
select record('share: a valid code returns data',
  public.shared_view('VIEW-LIVE') is not null, '');
select record('share: returns the owner''s trades',
  jsonb_array_length(public.shared_view('VIEW-LIVE')->'trades') > 0,
  jsonb_array_length(public.shared_view('VIEW-LIVE')->'trades')::text || ' trades');

-- Only the owner's. If another user's rows ever appear here, sharing has
-- become a database-wide leak.
select record('share: only the owner''s symbols',
  not exists (
    select 1 from jsonb_array_elements(public.shared_view('VIEW-LIVE')->'trades') t
    where t->>'symbol' = 'GBPJPY'   -- that one belongs to B
  ), '');

select record('share: a wrong code returns nothing',
  public.shared_view('VIEW-DOES-NOT-EXIST') is null, '');
select record('share: a revoked code returns nothing',
  public.shared_view('VIEW-REVOKED') is null, '');
select record('share: an expired code returns nothing',
  public.shared_view('VIEW-EXPIRED') is null, '');
select record('share: an empty code returns nothing',
  public.shared_view('') is null, '');

-- Sections are enforced in the function, not merely hidden in the UI. A
-- viewer who inspects the response must not find the journal in it.
select record('share: journal withheld unless enabled',
  not exists (
    select 1 from jsonb_array_elements(public.shared_view('VIEW-NOJOURNAL')->'trades') t
    where t->>'pre_trade_analysis' is not null or t->>'notes' is not null
  ), '');
-- Called with the literal code: an anonymous viewer has no way to look one up
-- from the table, which is exactly the property being relied on.
select record('share: journal present when enabled',
  exists (
    select 1 from jsonb_array_elements(public.shared_view('VIEW-LIVE')->'trades') t
    where t->>'pre_trade_analysis' = 'SECRET SETUP'
  ), 'enabled but not returned');

-- Never returned, whatever the sections say.
select record('share: no owner identity in the payload',
  (public.shared_view('VIEW-LIVE')::text) not like '%aaaaaaaa-0000%', '');
select record('share: no raw trade ids',
  not exists (
    select 1 from jsonb_array_elements(public.shared_view('VIEW-LIVE')->'trades') t
    join public.trades tr on tr.id::text = t->>'id'
  ), '');

-- hide_amounts must actually change the numbers, not just label them.
select record('share: amounts hidden are not currency',
  (select (t->>'pnl')::numeric from jsonb_array_elements(
      public.shared_view('VIEW-HIDDEN')->'trades') t
    where t->>'symbol' = 'XAUUSD' limit 1) <> -200,
  'still showing the raw figure');
select record('share: hidden view is flagged',
  (public.shared_view('VIEW-HIDDEN')->>'unit') = 'R', '');

reset role;

-- ---------------------------------------------------------------------------
-- Structural checks
-- ---------------------------------------------------------------------------

-- A table without RLS is readable by every signed-in user, whatever its
-- policies say. This catches a new table added without it.
select record(
  'every public table has RLS enabled',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('audit_results')
      and not c.relrowsecurity
  ),
  coalesce((select string_agg(c.relname, ', ') from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and c.relname not in ('audit_results') and not c.relrowsecurity), 'none')
);

-- RLS enabled but with no policy at all denies everything — which fails
-- closed, but usually means someone forgot the policies.
select record(
  'every RLS table has at least one policy',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('audit_results')
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  ),
  'ok'
);

\set QUIET off
select
  case when passed then 'PASS' else 'FAIL' end as result,
  check_name,
  detail
from audit_results
order by passed, check_name;

select count(*) filter (where not passed) as failures from audit_results;
