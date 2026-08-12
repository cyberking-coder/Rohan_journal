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

## A note on credentials

There is deliberately no table here that stores broker passwords or investor
credentials. The reasoning is in the header of `phase5.sql` — in short, this is
a browser app talking straight to Postgres, so anything the client can read is
readable by anyone who compromises the browser. Sync runs from
`mt5_bridge/` on your own machine instead, and transmits no password at all.
