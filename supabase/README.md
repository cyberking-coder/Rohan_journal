# Database migrations

Run these in the Supabase SQL editor, **in this order**. Every script is
idempotent — re-running one is a no-op, so if you're unsure whether a script
was applied, just run it again.

| # | File | What it does | Required? |
| --- | --- | --- | --- |
| 1 | `schema.sql` | Creates `public.trades` with Row Level Security. | Yes — everything else builds on it. |
| 2 | `storage.sql` | Storage bucket + policies for trade screenshots. | Only if you attach chart images. |
| 3 | `mt5.sql` | Columns the MT5 bridge writes (`external_id`, `source`, `swap`, `stop_loss`, `take_profit`). | Only if you use `mt5_bridge/`. |
| 4 | `phase0.sql` | Trade schema superset: `status`, `opened_at`/`closed_at`, `broker_account_id`, generated `is_deletable`, indexes. | Yes |
| 5 | `phase3.sql` | Structured journal fields, planned R:R, 1–10 `journal_rating`, generated `is_journaled`. | Yes, for the Journal |
| 6 | `phase4.sql` | `profiles` table — preferences that follow you across devices. | Optional; preferences work from localStorage without it. |
| 7 | `phase5.sql` | `broker_accounts` table and the foreign key from `trades`. | Optional; the app falls back to source-derived accounts. |
| 8 | `phase6.sql` | `economic_events` — the shared economic calendar, read-only from the browser. | Optional; the Market page says so if it's absent. |
| 9 | `phase7.sql` | `ai_reports` — the AI report archive and its weekly quota bucket. | Optional; the AI Report page says so if it's absent. |
| 10 | `phase8.sql` | `backtest_sessions` — saved candle-replay sessions. Candles themselves are never stored. | Optional; replay works without saving. |

`enable-auth.sql` and `migrate-numeric.sql` are one-off fixes from earlier in
the project's life. Only run them if the file's own comments describe a problem
you actually have.

## If a script errors

Each phase script declares the columns it depends on, so a missing earlier
script should no longer stop it. If one does fail:

- **`column "X" ... does not exist`** — an earlier script in the table above was
  skipped. Run them from the top; the idempotent ones will simply do nothing.
- **`relation "trades" does not exist`** — start with `schema.sql`.
- **`must be owner of table`** — you're running as the wrong role. Use the SQL
  editor in the Supabase dashboard rather than a client connected as `anon`.

## What the app does without them

The app degrades rather than breaking:

- No `phase4.sql` → preferences live only in this browser.
- No `phase5.sql` → the Trades switcher groups by each trade's `source` instead
  of by registered accounts, and says so.
- No `phase3.sql` → journal entries and ratings won't save.
- No `phase6.sql` → the Market page shows how to populate the calendar.
- No `phase7.sql` (or no deployed function) → AI Report explains the two setup
  steps instead of offering a button that can't work.

## Edge function: `generate-report`

AI reports are generated server-side, in `functions/generate-report/`. Two
reasons, both of which stop working the moment it moves into React:

1. The Anthropic API key never reaches the browser.
2. The weekly quota is counted against the database before any tokens are
   spent. `ai_reports` has no client insert policy, so the function is the only
   thing that can write a report.

```
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy generate-report
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by the platform — you don't set those yourself.

## A note on credentials

There is deliberately no table here that stores broker passwords or investor
credentials. The reasoning is in the header of `phase5.sql` — in short, this is
a browser app talking straight to Postgres, so anything the client can read is
readable by anyone who compromises the browser. Sync runs from
`mt5_bridge/` on your own machine instead, and transmits no password at all.
