-- Phase 10 — MetaApi.cloud connections.
--
-- Lets users connect a broker account through MetaApi.cloud so trades sync
-- into `public.trades` from the cloud instead of from a Windows script the
-- user runs at home.
--
-- Design:
--   * `broker_accounts` already models a connected account (label, platform,
--     sync timestamps). Those rows stay authoritative for the UI.
--   * `broker_connections` is the *server-only* companion table that carries
--     the MetaApi account id and the AES-GCM encrypted credentials. The
--     browser never reads it — only the Edge Functions and the sync worker
--     touch it, both using the service role.
--
-- Nothing in `phase10` is readable from the app's anon key. The encrypted
-- blob is opaque even if RLS were somehow bypassed: the AES-GCM key lives in
-- the sync worker's environment, not in Postgres.

create extension if not exists "pgcrypto";

create table if not exists public.broker_connections (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  broker_account_id     uuid references public.broker_accounts (id) on delete cascade,
  provider              text not null default 'metaapi',
  meta_api_account_id   text,
  mt5_login             text not null,
  mt5_server            text not null,
  platform              text not null default 'mt5' check (platform in ('mt4','mt5')),
  credentials_ciphertext text not null,
  credentials_nonce      text not null,
  status                text not null default 'provisioning'
                         check (status in ('provisioning','deploying','connected','error','disconnected')),
  last_error             text,
  last_synced_at         timestamptz,
  last_deal_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists broker_connections_user_login_uniq
  on public.broker_connections (user_id, provider, mt5_login);

create index if not exists broker_connections_status_idx
  on public.broker_connections (status);

-- RLS: the anon key gets nothing. Only the service role (Edge Functions +
-- sync worker) may read or write. The user-facing view below exposes just the
-- non-secret columns so the app can render the connection card.
alter table public.broker_connections enable row level security;

drop policy if exists "broker_connections - service only" on public.broker_connections;
-- No policies for authenticated/anon: RLS on with no policy means zero rows.
-- The service role bypasses RLS as normal.

create or replace view public.broker_connections_public as
  select
    id,
    user_id,
    broker_account_id,
    provider,
    meta_api_account_id,
    mt5_login,
    mt5_server,
    platform,
    status,
    last_error,
    last_synced_at,
    last_deal_at,
    created_at,
    updated_at
  from public.broker_connections;

-- View permissions: authenticated users read their own rows through the
-- view's underlying select against the base table's RLS — since the base
-- table has no user policy, we implement the read via a security definer
-- function instead. Simpler: expose a stable function.
revoke all on public.broker_connections_public from public, anon, authenticated;

create or replace function public.list_broker_connections()
returns table (
  id uuid,
  broker_account_id uuid,
  provider text,
  meta_api_account_id text,
  mt5_login text,
  mt5_server text,
  platform text,
  status text,
  last_error text,
  last_synced_at timestamptz,
  last_deal_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, broker_account_id, provider, meta_api_account_id, mt5_login,
         mt5_server, platform, status, last_error, last_synced_at, last_deal_at,
         created_at, updated_at
  from public.broker_connections
  where user_id = auth.uid();
$$;

revoke all on function public.list_broker_connections() from public;
grant execute on function public.list_broker_connections() to authenticated;

-- Bump `updated_at` on every row change so sync errors surface quickly in the UI.
create or replace function public.broker_connections_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists broker_connections_touch on public.broker_connections;
create trigger broker_connections_touch
  before update on public.broker_connections
  for each row execute function public.broker_connections_touch();
