-- Trade tags — Master PRD §27.
--
-- Safe to re-run. Run in the Supabase SQL editor after funded.sql.
--
-- ── Why an array and not a join table ──────────────────────────────────────
-- The textbook answer is `tags` + `trade_tags`, and it would be the right one
-- if tags were entities with their own lifecycle — renamed, merged, owned,
-- described. They are not. They are a handful of short strings per trade, read
-- on every page, written only alongside the trade itself, and never queried
-- independently of it.
--
-- An array with a GIN index answers "trades tagged X" in one index scan with
-- no join, keeps a trade's tags in the row the trade already loads, and means
-- the share function in phase9.sql needs no extra table permission. The cost
-- is that renaming a tag is an UPDATE across rows rather than one row, which
-- is a rare operation on a per-user table of a few thousand rows.

alter table public.trades
  add column if not exists tags text[] not null default '{}';

comment on column public.trades.tags is
  'Normalised tag slugs (see src/lib/tags.js). Concepts and mistakes share one array.';

-- GIN is what makes `tags && array['fvg']` and `tags @> array['fvg','bos']`
-- index scans rather than sequential ones. Without it the tag filter degrades
-- quietly as the journal grows — it keeps working, just slower every month,
-- which is the kind of problem nobody notices until it is large.
create index if not exists trades_tags_idx on public.trades using gin (tags);

-- Guard rails matching src/lib/tags.js, enforced here as well because the
-- client is not the only writer — the MT5 bridge and any future importer
-- write to this table too.
do $$ begin
  alter table public.trades add constraint trades_tags_sane check (
    array_length(tags, 1) is null or array_length(tags, 1) <= 12
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Sharing
-- ---------------------------------------------------------------------------
-- Tags say what a trader saw and what they did wrong, which is exactly the
-- interesting part of a shared dashboard — and also, in the case of mistake
-- tags, the part somebody might not mean to publish.
--
-- So they follow the journal section: enabled with it, withheld without it.
-- A viewer who is not shown the written review is not shown "revenge-trade"
-- either, since the tag is the same admission in one word.
create or replace function public.shared_view(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  share      public.shared_dashboards%rowtype;
  wants_journal boolean;
  r_unit     numeric;
  payload    jsonb;
begin
  select * into share from public.shared_dashboards
  where code = p_code and not revoked
    and (expires_at is null or expires_at > now());

  if not found then
    return null;
  end if;

  wants_journal := 'journal' = any(share.sections);

  if share.hide_amounts then
    select abs(avg(pnl - coalesce(fees,0))) into r_unit
    from public.trades
    where user_id = share.owner_user_id
      and (share.account_scope is null or broker_account_id = share.account_scope)
      and coalesce(status,'closed') <> 'open'
      and (pnl - coalesce(fees,0)) < 0;
    if r_unit is null or r_unit = 0 then r_unit := 1; end if;
  end if;

  select jsonb_build_object(
    'label', share.label,
    'sections', to_jsonb(share.sections),
    'hideAmounts', share.hide_amounts,
    'unit', case when share.hide_amounts then 'R' else 'money' end,
    'createdAt', share.created_at,
    'expiresAt', share.expires_at,
    'trades', coalesce((
      select jsonb_agg(t order by t.traded_at)
      from (
        select
          md5(tr.id::text || share.code) as id,
          tr.symbol, tr.side, tr.strategy, tr.session, tr.status,
          tr.traded_at, tr.opened_at, tr.closed_at,
          case when share.hide_amounts
               then round((tr.pnl - coalesce(tr.fees,0)) / r_unit, 3)
               else tr.pnl end as pnl,
          case when share.hide_amounts then 0 else tr.fees end as fees,
          case when share.hide_amounts then 0 else tr.swap end as swap,
          tr.entry, tr.exit, tr.stop_loss, tr.take_profit, tr.rr,
          case when share.hide_amounts then null else tr.qty end as qty,
          -- Gated with the journal, for the reason above.
          case when wants_journal then tr.tags else null end as tags,
          case when wants_journal then tr.pre_trade_analysis else null end as pre_trade_analysis,
          case when wants_journal then tr.post_trade_review else null end as post_trade_review,
          case when wants_journal then tr.lessons_learned else null end as lessons_learned,
          case when wants_journal then tr.emotions else null end as emotions,
          case when wants_journal then tr.notes else null end as notes,
          case when wants_journal then tr.journal_rating else null end as journal_rating
        from public.trades tr
        where tr.user_id = share.owner_user_id
          and (share.account_scope is null or tr.broker_account_id = share.account_scope)
      ) t
    ), '[]'::jsonb),
    'reports', case when 'reports' = any(share.sections) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', md5(ar.id::text || share.code),
        'title', ar.title, 'summary', ar.summary, 'sections', ar.sections,
        'createdAt', ar.created_at, 'tradeCount', ar.trade_count
      ) order by ar.created_at desc)
      from public.ai_reports ar where ar.user_id = share.owner_user_id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into payload;

  update public.shared_dashboards
  set view_count = view_count + 1, last_viewed_at = now()
  where id = share.id;

  return payload;
end $$;

revoke all on function public.shared_view(text) from public;
grant execute on function public.shared_view(text) to anon, authenticated;
