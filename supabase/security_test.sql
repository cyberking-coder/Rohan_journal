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
-- anon gets schema usage too, as it does on Supabase. Without this, the
-- function-grant checks below would pass because the SCHEMA was denied, not
-- the function — a test that passes for the wrong reason is worse than none.
grant usage on schema public to anon;
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

-- A paid subscription for A. Written as the owner, which is what the webhook's
-- service role does — there is deliberately no other way for a row to exist.
insert into public.subscriptions (user_id, plan, status, stripe_customer_id, current_period_end)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'premium', 'active', 'cus_A',
        now() + interval '30 days');

-- Give A a qualifying record: 25 closed trades across 12 days, all synced, so
-- the leaderboard function can be exercised on real data rather than only on
-- its empty case. Amounts are large and lopsided on purpose — if account size
-- can leak, this is where it would show.
insert into public.trades (user_id, symbol, side, pnl, fees, traded_at, closed_at, status, source)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'EURUSD', 'Long',
       case when i % 5 < 3 then 4000 else -2000 end, 0,
       now() - make_interval(days => i % 12),
       now() - make_interval(days => i % 12),
       'closed', 'mt5'
from generate_series(1, 25) i;


-- A prop challenge each. The rules are not secret in the way a password is,
-- but they say which firm a trader is with, at what size, and how close to
-- failing — which is exactly the kind of thing a rival account holder should
-- not be able to enumerate.
insert into public.funded_accounts (user_id, label, firm, starting_balance, profit_target) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A challenge', 'FundingPips', 100000, 8000),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'B challenge', 'FTMO', 50000, 4000);

-- ── Community seed ────────────────────────────────────────────────────────
-- A opts into everything; B opts into nothing. B's absence is the default and
-- is what most accounts look like.
insert into public.community_profiles (user_id, handle, on_leaderboard, publishes)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'alpha', true, true);

insert into public.shared_setups (user_id, title, thesis, tags, published, stat_trades)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A published setup',
   'A thesis long enough to satisfy the length constraint on this column.',
   array['fvg'], true, 40),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A DRAFT setup',
   'An unpublished draft that must never be visible to anybody else at all.',
   array['fvg'], false, 5);

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

-- Tag it with a mistake. "revenge-trade" is an admission, and it must travel
-- with the written journal rather than leaking on its own.
update public.trades set tags = array['fvg','revenge-trade']
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and symbol = 'XAUUSD';

-- Every one of A's trades is synced. Done last, after all of them exist —
-- placed earlier it missed the journalled trade seeded below it, and the
-- badge check then failed for a reason that had nothing to do with the badge.
update public.trades set source = 'mt5'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

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
-- A owns 27: two from the original seed and 25 for the leaderboard.
select record('trades: sees own',        count(*) = 27, 'saw ' || count(*)) from public.trades;
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

-- ── Community ─────────────────────────────────────────────────────────────
-- This is the one feature that shows users to each other, so the checks are
-- about what leaks rather than only about what is blocked.

-- Enumerating participants would expose everyone who opted in, plus the
-- suspended flag. Other people's handles arrive through leaderboard(), which
-- returns only what it means to.
select record('B: cannot list community profiles', count(*) = 0, 'saw ' || count(*))
  from public.community_profiles;

-- Owner-only, exactly like every other table. Published setups reach people
-- through browse_setups(), not through a policy here.
select record('B: cannot read A''s setups directly', count(*) = 0, 'saw ' || count(*))
  from public.shared_setups;

-- Impersonation: the handle is an identity others see.
do $$
begin
  insert into public.community_profiles (user_id, handle)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'imposter');
  perform record('B: cannot create a profile as A', false, 'insert succeeded');
exception when others then
  perform record('B: cannot create a profile as A', true, 'refused');
end $$;

do $$
begin
  insert into public.community_profiles (user_id, handle) values
    ('bbbbbbbb-0000-0000-0000-000000000002', 'ALPHA');
  perform record('handles are unique case-insensitively', false, 'a near-duplicate handle was allowed');
exception when unique_violation then
  perform record('handles are unique case-insensitively', true, 'refused');
when others then
  perform record('handles are unique case-insensitively', true, 'refused: ' || SQLERRM);
end $$;

do $$
declare n int;
begin
  update public.shared_setups set removed = false, title = 'hijacked';
  get diagnostics n = row_count;
  perform record('B: cannot edit A''s setups', n = 0, n || ' row(s) updated');
exception when others then
  perform record('B: cannot edit A''s setups', true, 'refused: ' || SQLERRM);
end $$;

-- browse_setups returns published work by design. What it must NOT return is
-- a draft, or anything identifying beyond the chosen handle.
select record('browse: shows a published setup',
  jsonb_array_length(public.browse_setups()) = 1,
  jsonb_array_length(public.browse_setups())::text || ' setup(s)');

select record('browse: never shows a draft',
  not exists (
    select 1 from jsonb_array_elements(public.browse_setups()) e
    where e->>'title' like '%DRAFT%'
  ), 'an unpublished draft leaked');

select record('browse: no user ids in the payload',
  public.browse_setups()::text not like '%aaaaaaaa-0000%', 'an owner id leaked');

select record('browse: shows the handle, not the account',
  exists (
    select 1 from jsonb_array_elements(public.browse_setups()) e
    where e->>'author' = 'alpha'
  ), 'the author handle is present');

-- The rule that makes the whole feature safe to ship: no money, anywhere.
select record('leaderboard: publishes no currency',
  public.leaderboard()::text not similar to '%(pnl|balance|equity|total_net|gross_win)%',
  'a money field leaked into the leaderboard');

-- A now qualifies, so the function is exercised on real data.
select record('leaderboard: lists a qualifying trader',
  jsonb_array_length(public.leaderboard()->'entries') = 1,
  jsonb_array_length(public.leaderboard()->'entries')::text || ' entries');

select record('leaderboard: shows the handle, not the account',
  public.leaderboard()->'entries'->0->>'handle' = 'alpha',
  coalesce(public.leaderboard()->'entries'->0->>'handle', 'none'));

-- The core promise. A's trades are 4,000 winners and 2,000 losers; if any raw
-- amount reaches the payload, account size is inferable.
select record('leaderboard: no raw amounts in the payload',
  public.leaderboard()::text not like '%4000%'
  and public.leaderboard()::text not like '%2000%',
  'a raw trade amount leaked');

-- The strongest available statement that this figure carries no account size:
-- multiply every one of A's amounts by ten and the score must not move. An
-- exact expected constant would be brittle and would prove less — this is the
-- actual invariant the feature promises.
do $$
declare before numeric; after numeric;
begin
  before := (public.leaderboard()->'entries'->0->>'expectancy_r')::numeric;

  reset role;
  update public.trades set pnl = pnl * 10
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  set role authenticated;

  after := (public.leaderboard()->'entries'->0->>'expectancy_r')::numeric;

  reset role;
  update public.trades set pnl = pnl / 10
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  set role authenticated;

  perform record('leaderboard: the score is scale-free',
    before is not null and before = after,
    coalesce(before::text, 'null') || ' vs ' || coalesce(after::text, 'null'));
end $$;

-- Set immediately before the assertion rather than relying on the seed. An
-- earlier check in this file inserts a trade for A to prove own-writes work,
-- and that trade defaults to 'manual' — so a badge test that depended on the
-- seed's state was testing the order of this file, not the badge.
reset role;
update public.trades set source = 'mt5'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set role authenticated;

select record('leaderboard: reports the synced badge',
  (public.leaderboard()->'entries'->0->>'verified')::boolean,
  'all trades came from a sync');

-- One hand-entered trade changes the numbers, so it must remove the badge.
--
-- Seeded as the owner, not as B: B cannot write A's trades, and the attempt
-- rightly fails RLS. Adding data on someone else's behalf is a job for the
-- harness, not for the tenant under test — which is the whole point of the
-- rest of this file.
reset role;
insert into public.trades (user_id, symbol, side, pnl, fees, traded_at, closed_at, status, source)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'EURUSD', 'Long', 100, 0,
        now(), now(), 'closed', 'manual');
set role authenticated;

select record('leaderboard: one manual trade removes the badge',
  not (public.leaderboard()->'entries'->0->>'verified')::boolean,
  'a self-reported trade was counted as verified');

-- Opting out must remove the entry entirely and immediately. Also done as the
-- harness rather than as B, for the same reason.
reset role;
update public.community_profiles set on_leaderboard = false
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set role authenticated;

select record('leaderboard: opting out removes you at once',
  jsonb_array_length(public.leaderboard()->'entries') = 0,
  jsonb_array_length(public.leaderboard()->'entries')::text || ' entries');

reset role;
update public.community_profiles set on_leaderboard = true
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set role authenticated;

-- Reporting must work for a normal user, and must not be forgeable.
do $$
declare sid uuid;
begin
  select id into sid from public.shared_setups limit 1;
  insert into public.content_reports (setup_id, reason) values (sid, 'spam');
  perform record('B: can report a setup', true, 'reporter_id defaulted from the token');
exception when others then
  perform record('B: can report a setup', false, SQLERRM);
end $$;

do $$
begin
  insert into public.content_reports (reporter_id, setup_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          (select id from public.shared_setups limit 1), 'abusive');
  perform record('B: cannot report AS someone else', false, 'insert succeeded');
exception when others then
  perform record('B: cannot report AS someone else', true, 'refused');
end $$;

-- ── Billing ───────────────────────────────────────────────────────────────
-- The whole of phase 11 rests on a user being unable to write their own plan.
-- If any of the next four checks fails, the product is free to anyone who
-- opens the network tab.
select record('B: cannot see A''s subscription', count(*) = 0, 'saw ' || count(*))
  from public.subscriptions;

do $$
begin
  insert into public.subscriptions (user_id, plan, status)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'premium', 'active');
  perform record('B: cannot grant themselves a plan', false, 'insert succeeded');
exception when others then
  perform record('B: cannot grant themselves a plan', true, 'refused');
end $$;

do $$
declare n int;
begin
  update public.subscriptions set plan = 'premium';
  get diagnostics n = row_count;
  perform record('B: cannot upgrade any subscription', n = 0, n || ' row(s) updated');
exception when others then
  perform record('B: cannot upgrade any subscription', true, 'refused: ' || SQLERRM);
end $$;

do $$
declare n int;
begin
  delete from public.subscriptions;
  get diagnostics n = row_count;
  perform record('B: cannot delete a subscription', n = 0, n || ' row(s) deleted');
exception when others then
  perform record('B: cannot delete a subscription', true, 'refused: ' || SQLERRM);
end $$;

-- The idempotency ledger holds no user data, and nothing but the service role
-- has any business reading it.
select record('B: cannot read the Stripe event log', count(*) = 0, 'saw ' || count(*))
  from public.stripe_events;

-- A saved backtest is a strategy. Reading someone else's is reading their
-- edge, which is the one thing a trader would least like shared.
select record('B: sees only own backtests', count(*) = 1, 'saw ' || count(*))
  from public.backtest_sessions;

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
select record('anon: no backtests', count(*) = 0, 'saw ' || count(*))
  from public.backtest_sessions;
select record('anon: no subscriptions', count(*) = 0, 'saw ' || count(*))
  from public.subscriptions;
select record('anon: no community profiles', count(*) = 0, 'saw ' || count(*))
  from public.community_profiles;
select record('anon: no setups', count(*) = 0, 'saw ' || count(*))
  from public.shared_setups;

-- Participants opted into being seen by other traders, not by the internet.
--
-- EXECUTE is granted by database ROLE, not by JWT claim, so these have to
-- actually become `anon` — clearing the claim while still connected as
-- `authenticated` tests nothing about the grant. This is the one place in this
-- file where the distinction matters, and it cost two false failures to find.
set role anon;

do $$
begin
  perform public.leaderboard();
  perform record('anon: cannot read the leaderboard', false, 'the function ran');
exception when insufficient_privilege then
  perform record('anon: cannot read the leaderboard', true, 'refused');
when others then
  perform record('anon: cannot read the leaderboard', true, 'refused: ' || SQLERRM);
end $$;

do $$
begin
  perform public.browse_setups();
  perform record('anon: cannot browse setups', false, 'the function ran');
exception when insufficient_privilege then
  perform record('anon: cannot browse setups', true, 'refused');
when others then
  perform record('anon: cannot browse setups', true, 'refused: ' || SQLERRM);
end $$;

-- The share function is the deliberate exception: it is granted to anon
-- because a share link is meant to work without an account. Checked here so
-- the contrast is explicit rather than accidental.
do $$
begin
  perform public.shared_view('VIEW-LIVE');
  perform record('anon: CAN use a share link', true, 'as intended');
exception when others then
  perform record('anon: CAN use a share link', false, 'refused: ' || SQLERRM);
end $$;

set role authenticated;

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
-- Tags follow the journal section. A viewer denied the write-up must not be
-- handed the same admission as a one-word tag.
select record('share: tags present when journal enabled',
  exists (
    select 1 from jsonb_array_elements(public.shared_view('VIEW-LIVE')->'trades') t
    where t->'tags' ? 'revenge-trade'
  ), 'enabled but not returned');

select record('share: tags withheld without journal',
  not exists (
    select 1 from jsonb_array_elements(public.shared_view('VIEW-NOJOURNAL')->'trades') t
    where t->'tags' ? 'revenge-trade'
  ), 'a mistake tag leaked without the journal');

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
--
-- `stripe_events` is the deliberate exception: it is the webhook's idempotency
-- ledger, holds no user data, and nothing but the service role has any reason
-- to touch it. Deny-all is the intended state.
--
-- Listing it explicitly rather than relaxing the rule is the point. A blanket
-- "some tables may have no policies" turns a check that catches a real and
-- common mistake — enabling RLS and forgetting the policies — into one that
-- catches nothing, and the next table to arrive that way would pass silently.
select record(
  'every RLS table has at least one policy',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('audit_results', 'stripe_events')
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  ),
  'ok'
);

-- And the exception is itself checked, so it cannot quietly acquire a policy
-- that opens it up.
select record(
  'stripe_events is deny-all by design',
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'stripe_events')
  and not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'stripe_events'
  ),
  'RLS on, no policies'
);

\set QUIET off
select
  case when passed then 'PASS' else 'FAIL' end as result,
  check_name,
  detail
from audit_results
order by passed, check_name;

select count(*) filter (where not passed) as failures from audit_results;
