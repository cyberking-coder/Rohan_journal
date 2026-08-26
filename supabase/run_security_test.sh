#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL, applies every migration in order, and runs
# the multi-tenancy isolation test against it.
#
#     ./supabase/run_security_test.sh
#
# Nothing touches your real database. Requires a local postgres installation
# (initdb / pg_ctl / psql on PATH, or under /usr/lib/postgresql/*/bin).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)"
[ -n "$PGBIN" ] && export PATH="$PATH:$PGBIN"

DATA="${TMPDIR:-/var/tmp}/fgj_sec_$$"
PORT="${PORT:-5460}"
# The socket lives inside the throwaway data directory. Put it in a shared
# temp dir and a killed run leaves a stale socket behind that blocks the next
# one from starting.
SOCK="$DATA"

cleanup() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

# initdb refuses to run as root, so drop to the postgres user when we are.
RUNAS=""
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  RUNAS="postgres"
  mkdir -p "$DATA"; chown postgres "$DATA"
fi

run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "PATH=$PATH $*"; else eval "$*"; fi; }

echo "Starting a scratch PostgreSQL on port $PORT…"
run "initdb -U postgres -D $DATA" >/dev/null
run "pg_ctl -D $DATA -o \"-k $SOCK -p $PORT -h ''\" -l $DATA/log start" >/dev/null
sleep 2

PSQL="psql -h $SOCK -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

# Supabase provides these; a bare Postgres does not.
$PSQL <<'SQL' >/dev/null
-- Supabase ships these roles; a bare Postgres does not, and the storage
-- policies reference `authenticated` by name at creation time.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create function auth.role() returns text language sql as $$ select 'anon'::text $$;

-- Minimal stand-ins for what Supabase's storage extension provides, so the
-- bucket policies can be exercised rather than only read.
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;
SQL

echo "Applying migrations…"
for f in schema.sql storage.sql mt5.sql phase0.sql phase3.sql phase4.sql phase5.sql phase6.sql phase7.sql phase8.sql phase9.sql funded.sql tags.sql comparison.sql billing.sql community.sql; do
  printf '  %-14s' "$f"
  if $PSQL -f "$HERE/$f" >/dev/null 2>&1; then echo "ok"; else echo "FAILED"; $PSQL -f "$HERE/$f"; exit 1; fi
done

echo
echo "Running isolation test…"
echo
$PSQL -f "$HERE/security_test.sql" 2>&1 | grep -v "^SET$\|^$"

FAILURES=$(psql -h "$SOCK" -p "$PORT" -U postgres -tAc "select count(*) from audit_results where not passed")
echo
if [ "$FAILURES" = "0" ]; then
  echo "All isolation checks passed."
else
  echo "$FAILURES CHECK(S) FAILED — do not put another person's data in this database."
  exit 1
fi
