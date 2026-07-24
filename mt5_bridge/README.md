# MT5 → Forex Greek Journal auto-sync

Automatically logs your **closed MetaTrader 5 trades** into the journal. Runs on
the same Windows machine as your MT5 terminal; while the terminal is open and
logged in, it pushes new closed positions into the same Supabase database the
web app reads from — so trades appear in your journal automatically and stay
editable.

> **Windows only.** MetaTrader's `MetaTrader5` Python package requires the
> Windows terminal to be installed and running.

## What gets imported per trade

symbol · side (long/short) · entry & exit price · lots · gross P&L ·
commission + swap (as fees) · stop-loss / take-profit · **R:R** (auto from
SL/TP) · session (from close time) · close time. Strategy is set to
`Unassigned` so you can categorise it later with the journal's edit button.

Trades are de-duplicated by MT5 **position ticket**, so re-running never creates
duplicates.

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
