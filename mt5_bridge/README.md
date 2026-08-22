# MT5 → Forex Greek Journal auto-sync

Automatically logs your **closed MetaTrader 5 trades** into the journal. Runs on
the same Windows machine as your MT5 terminal; while the terminal is open and
logged in, it pushes new closed positions into the same Supabase database the
web app reads from — so trades appear in your journal automatically and stay
editable.

> **Windows only.** MetaTrader's `MetaTrader5` Python package requires the
> Windows terminal to be installed and running.

## What gets imported

**Closed trades** — symbol · side · entry & exit price · lots · gross P&L ·
commission + swap (as fees) · stop-loss / take-profit · **R:R** (auto from
SL/TP) · session (from close time) · open & close time · **strategy**
(auto-mapped from the order's magic number / comment — see below).

**Open positions** (unless `SYNC_OPEN=false`) — the same fields, plus the live
mark and floating P&L, stored with `status='open'`.

**Account state** — balance, equity and leverage, snapshotted onto the account
row each sync. Needs `../supabase/phase5.sql` (re-run it if you applied an
earlier version; the script is idempotent).

Everything is keyed on the MT5 **position ticket**, so re-running never creates
duplicates — and when a position closes, the closed-trade write lands on the
same row the open one created and flips it from open to closed.

> **On floating P&L.** An open position's profit hasn't landed and can still
> reverse, so every total in the app — P&L, win rate, profit factor, the equity
> curve, account balances — is computed from closed trades only. Floating P&L
> is shown separately, never mixed in.

## How the bridge signs in

Set `SUPABASE_ANON_KEY`, `JOURNAL_EMAIL` and `JOURNAL_PASSWORD` in `.env`. The
bridge logs into your journal account and Supabase's row-level security then
confines it to your own rows — the same protection the web app relies on. Your
user id comes from the login, so there's nothing to copy by hand.

The older `SUPABASE_SERVICE_KEY` + `JOURNAL_USER_ID` path still works for a
single-user setup, and the bridge warns when it's used. **Never hand a service
key to another person running this**: it bypasses row-level security, so its
holder can read and modify every user's trades, not just their own.

## Exporting candles for the Backtesting page

The same terminal connection can pull price history, so the replay runs on your
broker's real prices with no data vendor and no quota.

**Straight into the journal** (recommended) — no file, and the Backtesting page
can then switch timeframe mid-replay:

```bat
python export_candles.py --symbol XAUUSD --timeframes M5,M15,H1,H4 --days 365 --upload
```

Run `supabase/phase8.sql` first (re-run it if you applied an earlier version —
it's idempotent and now adds the `candles` table). Re-running the export for an
overlapping range updates those bars rather than duplicating them, so it's safe
on a schedule.

**Or to a file**, if you'd rather not store anything:

```bat
python export_candles.py --symbol XAUUSD --timeframe H1 --days 365
python export_candles.py --list gold        # what does this broker call it?
```

That writes `XAUUSD_H1.csv`; load it with **Choose a file** on the Backtesting
page. One timeframe per file — several at once needs `--upload`.

### How much to upload

A year of H1 is about 6,000 bars per symbol and costs nothing. A year of M1 is
about 375,000, which is slow to query and will eat a free-tier database; the
uploader says so before writing that much. M5 and up is the comfortable range
for anything you'd actually sit and replay.

**On timezones.** MT5 stamps every bar in *server* time, and most brokers run
theirs on UTC+2/+3. The exporter measures the offset from a live tick and
converts to real UTC. A replay would look identical either way, which is
exactly why this matters — the error would never show itself, but your candles
would sit a couple of hours away from your own trade times and from the
journal's session analysis.

If the market is closed the last tick is stale and the offset can't be read.
The script says so and writes server time unchanged; re-run during market
hours, or pass `--server-offset 3` if you know it.

**If you get no bars**, the terminal hasn't downloaded that history. Open the
chart for that symbol and timeframe, scroll back as far as you want, then
re-run. For very long spans also raise Tools → Options → Charts → *Max bars in
chart*.

Prop-firm and ECN accounts often suffix their symbols (`XAUUSD.s`,
`GBPJPY-ECN`); `--symbol XAUUSD` finds those automatically, and `--list` shows
everything available.

## Read-only access (recommended)

The bridge only ever reads. You can make that structural rather than a promise
by logging in with your **investor password**:

```
MT5_LOGIN=1234567
MT5_PASSWORD=your-investor-password
MT5_SERVER=FundingPips-Live
```

MT5 treats an investor login as view-only at the broker — it can read balance,
positions and history but cannot place, modify or close an order. Even if this
script were compromised or simply wrong, it could not trade your account.

On startup the bridge prints which kind of credential it's using, so you can
confirm it says `investor (read-only)`.

FundingPips and most prop firms list the investor password next to the master
one in the account dashboard.

## One-time setup

### 1. Database
In the Supabase SQL editor, run [`../supabase/mt5.sql`](../supabase/mt5.sql)
(adds `external_id`, `source`, `swap`, `stop_loss`, `take_profit` and a unique
index).

### 2. Install (on the Windows PC with MT5)
```bat
cd mt5_bridge
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure
Copy `.env.example` to `.env` and fill in:

| Variable                | Where to get it                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| `SUPABASE_URL`          | Supabase → Settings → API → Project URL                                |
| `SUPABASE_SERVICE_KEY`  | Supabase → Settings → API → **service_role** key (keep secret!)        |
| `JOURNAL_USER_ID`       | Your account id — see below                                            |

**Finding your `JOURNAL_USER_ID`:** log into the web app, and it's shown under
your name in the sidebar (click to copy). Or in Supabase → Authentication →
Users → your row → **User UID**.

> The **service_role** key bypasses Row Level Security so the script can write
> to your account. It must live **only** on your machine — never put it in the
> web app or commit it.

### 4. Run
```bat
python sync.py            # polls every 60s while the terminal is open
python sync.py --once     # one sync then exit
```

Leave it running while you trade. Each closed position shows up in the journal
within a minute. Adjust `POLL_SECONDS` / `LOOKBACK_DAYS` in `.env` if needed.

## Auto-assigning a strategy

Instead of leaving imports as `Unassigned`, the bridge can label each trade from
its MT5 **magic number** or **order comment**.

1. Copy `strategy_map.example.json` to `strategy_map.json`.
2. Edit the two maps:
   - `magic`: EA magic number (as a string) → strategy name.
   - `comment`: a case-insensitive substring of the order comment → strategy name.
3. Re-run the sync.

Resolution order per trade: **magic match → comment substring → raw comment →
`Unassigned`**. So if you type `QML` in the order comment when placing a trade,
it lands in the journal already tagged `Levels + M5 QML + Engulfing`. Any trade
that doesn't match still comes in and can be edited in the journal.

## Notes & limits

- **Closed trades only.** Open positions are logged once they close.
- **Same account:** it reads whatever account the terminal is logged into. To
  attach to a specific account non-interactively, set `MT5_LOGIN` /
  `MT5_PASSWORD` / `MT5_SERVER` in `.env`.
- **Costs:** MT5 commission and swap are stored so your *net* P&L matches the
  terminal. Gross P&L is stored in `pnl`, costs in `fees`/`swap`.
- **First run** imports the last `LOOKBACK_DAYS` (default 30) of history.
- Want it always-on? Run it via Windows Task Scheduler at logon, or keep the
  terminal + script running on a VPS.
