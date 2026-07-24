"""
Forex Greek Journal — MetaTrader 5 auto-sync bridge.

Runs on the same Windows machine as your MT5 terminal. While the terminal is
open and logged in, it reads your closed positions and upserts them into the
same Supabase database your journal reads from, so trades appear automatically.

Setup and usage: see mt5_bridge/README.md
"""

import os
import sys
import time
import argparse
from datetime import datetime, timedelta, timezone

try:
    import MetaTrader5 as mt5
except ImportError:
    print("MetaTrader5 package not found. Run: pip install -r requirements.txt")
    print("Note: the MetaTrader5 package is Windows-only.")
    sys.exit(1)

from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
JOURNAL_USER_ID = os.environ.get("JOURNAL_USER_ID")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "60"))
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "30"))

# Optional explicit login (otherwise attaches to the already-open terminal)
MT5_LOGIN = os.environ.get("MT5_LOGIN")
MT5_PASSWORD = os.environ.get("MT5_PASSWORD")
MT5_SERVER = os.environ.get("MT5_SERVER")

CURSOR_FILE = os.path.join(os.path.dirname(__file__), ".mt5_cursor")


def require_config():
    missing = [k for k, v in {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_SERVICE_KEY": SUPABASE_SERVICE_KEY,
        "JOURNAL_USER_ID": JOURNAL_USER_ID,
    }.items() if not v]
    if missing:
        print("Missing required env vars: " + ", ".join(missing))
        print("Copy .env.example to .env and fill it in.")
        sys.exit(1)


def init_mt5():
    kwargs = {}
    if MT5_LOGIN and MT5_PASSWORD and MT5_SERVER:
        kwargs = dict(login=int(MT5_LOGIN), password=MT5_PASSWORD, server=MT5_SERVER)
    if not mt5.initialize(**kwargs):
        print("MT5 initialize() failed:", mt5.last_error())
        print("Make sure the MetaTrader 5 terminal is installed, open and logged in.")
        sys.exit(1)
    acc = mt5.account_info()
    if acc:
        print(f"Connected to MT5 account {acc.login} ({acc.server}) — {acc.currency}")


def read_cursor():
    try:
        with open(CURSOR_FILE) as f:
            return datetime.fromisoformat(f.read().strip())
    except Exception:
        return datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)


def write_cursor(dt):
    try:
        with open(CURSOR_FILE, "w") as f:
            f.write(dt.isoformat())
    except Exception as e:
        print("Warning: could not write cursor:", e)


def session_for(hour_utc):
    # Rough FX session by UTC hour
    if 7 <= hour_utc < 12:
        return "London"
    if 12 <= hour_utc < 16:
        return "Overlap"
    if 16 <= hour_utc < 21:
        return "New York"
    return "Asia"


def build_trades(from_dt, to_dt):
    """Aggregate MT5 deals into round-trip trades keyed by position id."""
    deals = mt5.history_deals_get(from_dt, to_dt)
    if deals is None:
        print("history_deals_get returned None:", mt5.last_error())
        return []

    positions = {}
    for d in deals:
        # entry: 0 = IN (open), 1 = OUT (close), 2 = IN/OUT (reverse)
        pid = d.position_id
        p = positions.setdefault(pid, {"in": [], "out": [], "commission": 0.0, "swap": 0.0})
        p["commission"] += d.commission
        p["swap"] += d.swap
        if d.entry == mt5.DEAL_ENTRY_IN:
            p["in"].append(d)
        elif d.entry == mt5.DEAL_ENTRY_OUT:
            p["out"].append(d)

    trades = []
    for pid, p in positions.items():
        if not p["in"] or not p["out"]:
            continue  # position still open or incomplete in this window

        first_in = p["in"][0]
        last_out = p["out"][-1]
        in_vol = sum(d.volume for d in p["in"]) or 1
        out_vol = sum(d.volume for d in p["out"]) or in_vol
        entry_px = sum(d.price * d.volume for d in p["in"]) / in_vol
        exit_px = sum(d.price * d.volume for d in p["out"]) / out_vol
        gross = sum(d.profit for d in p["out"])
        side = "Long" if first_in.type == mt5.DEAL_TYPE_BUY else "Short"

        # planned SL/TP from the opening order, if available
        sl = tp = None
        rr = 0.0
        orders = mt5.history_orders_get(position=pid)
        if orders:
            o = orders[0]
            sl = o.sl or None
            tp = o.tp or None
            if sl and tp:
                risk = abs(entry_px - sl)
                if risk:
                    rr = round(abs(tp - entry_px) / risk, 2)

        close_dt = datetime.fromtimestamp(last_out.time, tz=timezone.utc)
        # 'fees' in the app is subtracted from pnl for net; commission/swap are
        # negative in MT5, so negate them to represent a positive cost.
        fees = round(-(p["commission"] + p["swap"]), 2)

        trades.append({
            "user_id": JOURNAL_USER_ID,
            "external_id": str(pid),
            "source": "mt5",
            "symbol": first_in.symbol,
            "side": side,
            "strategy": "Unassigned",
            "session": session_for(close_dt.hour),
            "entry": round(entry_px, 5),
            "exit": round(exit_px, 5),
            "qty": round(out_vol, 2),
            "pnl": round(gross, 2),
            "fees": fees,
            "swap": round(p["swap"], 2),
            "stop_loss": sl,
            "take_profit": tp,
            "rr": rr,
            "rating": 3,
            "notes": "",
            "traded_at": close_dt.isoformat(),
        }, )
    return trades


def sync_once(sb):
    from_dt = read_cursor()
    to_dt = datetime.now(timezone.utc)
    trades = build_trades(from_dt, to_dt)
    if trades:
        # Upsert on (user_id, external_id) so re-runs never duplicate.
        sb.table("trades").upsert(
            [t for t in trades],
            on_conflict="user_id,external_id",
        ).execute()
        print(f"[{to_dt:%H:%M:%S}] synced {len(trades)} closed trade(s)")
    else:
        print(f"[{to_dt:%H:%M:%S}] no new closed trades")
    # step the cursor back a little to catch late-settling deals
    write_cursor(to_dt - timedelta(hours=6))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="sync a single time and exit")
    args = parser.parse_args()

    require_config()
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    init_mt5()

    try:
        if args.once:
            sync_once(sb)
        else:
            print(f"Polling every {POLL_SECONDS}s. Press Ctrl+C to stop.")
            while True:
                try:
                    sync_once(sb)
                except Exception as e:
                    print("Sync error:", e)
                time.sleep(POLL_SECONDS)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
