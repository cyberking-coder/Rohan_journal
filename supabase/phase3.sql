-- Phase 3 — structured journal fields.
--
-- Adds the five structured fields the spec's Journal module uses, plus the
-- planned risk:reward and a 1-10 rating. Safe to re-run.
--
-- Run in the Supabase SQL editor after phase0.sql.

-- ---------------------------------------------------------------------------
-- The five structured journal fields
-- ---------------------------------------------------------------------------
-- These are separate columns rather than one blob so they can be searched,
-- and so "have you journaled this trade" is answerable in SQL.
alter table public.trades add column if not exists pre_trade_analysis text;
alter table public.trades add column if not exists post_trade_review  text;
alter table public.trades add column if not exists emotions           text;
alter table public.trades add column if not exists lessons_learned    text;

comment on column public.trades.pre_trade_analysis is
  'What you saw before entering: plan, thesis, levels, risk.';
comment on column public.trades.post_trade_review is
  'What actually happened: execution, slippage, improvements.';
comment on column public.trades.emotions is
  'How you felt: calm, anxious, FOMO, confident.';
comment on column public.trades.lessons_learned is
  'Key takeaways to repeat or avoid.';

-- ---------------------------------------------------------------------------
-- Planned risk:reward
-- ---------------------------------------------------------------------------
-- Distinct from the existing `rr`, which is the REALISED ratio. This is what
-- you planned before entering, so the two can be compared.
alter table public.trades add column if not exists planned_rr_risk   numeric default 1;
alter table public.trades add column if not exists planned_rr_reward numeric;

comment on column public.trades.rr is
  'Realised risk:reward, computed from entry/stop/exit.';
comment on column public.trades.planned_rr_reward is
  'Planned reward per planned_rr_risk units of risk, set when journaling.';

-- ---------------------------------------------------------------------------
-- Rating: 1-10
-- ---------------------------------------------------------------------------
-- The spec uses a 1-10 slider; this repo previously used a 1-5 star widget.
-- Rather than keep two competing ratings for the same idea, `journal_rating`
-- becomes the single field the app reads and writes, and the old `rating`
-- column is left untouched as historical data.
--
-- Nothing is destroyed here: existing 1-5 values are copied forward doubled
-- (3 stars -> 6/10), and the backfill only touches rows not already migrated,
-- so re-running is a no-op.
alter table public.trades
  add column if not exists journal_rating smallint
  check (journal_rating between 1 and 10);

update public.trades
   set journal_rating = rating * 2
 where journal_rating is null
   and rating is not null;

comment on column public.trades.rating is
  'Legacy 1-5 star rating. Superseded by journal_rating; no longer written.';
comment on column public.trades.journal_rating is
  'Trade quality, 1-10. Backfilled from the old 1-5 rating x 2.';

-- ---------------------------------------------------------------------------
-- Journaled vs. pending
-- ---------------------------------------------------------------------------
-- Generated rather than stored so it can never disagree with the fields it
-- describes. A trade counts as journaled once any structured field is filled.
alter table public.trades
  add column if not exists is_journaled boolean
  generated always as (
    nullif(btrim(coalesce(pre_trade_analysis, '')), '') is not null
    or nullif(btrim(coalesce(post_trade_review, '')), '') is not null
    or nullif(btrim(coalesce(emotions, '')), '') is not null
    or nullif(btrim(coalesce(lessons_learned, '')), '') is not null
    or journal_rating is not null
  ) stored;

create index if not exists trades_user_journaled_idx
  on public.trades (user_id, is_journaled);
