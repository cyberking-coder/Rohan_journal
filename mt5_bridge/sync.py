"""
Forex Greek Journal — MetaTrader 5 auto-sync bridge.

Runs on the same Windows machine as your MT5 terminal. While the terminal is
open and logged in, it reads your closed positions and upserts them into the
same Supabase database your journal reads from, so trades appear automatically.

Setup and usage: see mt5_bridge/README.md
"""

import os
import sys
import json
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

# Optional explicit login (otherwise attaches to the already-open terminal).
#
# Use the INVESTOR password here, not the master one. MT5 treats an investor
# login as read-only at the broker: it can read balance, positions and history
# but cannot place, modify or close an order. That makes the read-only-ness a
# property of the credential rather than a promise this script is making about
# its own behaviour — which is the only kind worth relying on.
MT5_LOGIN = os.environ.get("MT5_LOGIN")
MT5_PASSWORD = os.environ.get("MT5_PASSWORD")
MT5_SERVER = os.environ.get("MT5_SERVER")

# Whether to mirror still-open positions into the journal.
SYNC_OPEN = os.environ.get("SYNC_OPEN", "true").lower() not in ("0", "false", "no")

CURSOR_FILE = os.path.join(os.path.dirname(__file__), ".mt5_cursor")
MAP_FILE = os.path.join(os.path.dirname(__file__), "strategy_map.json")


def load_strategy_map():
    """Optional magic-number / comment -> strategy mapping."""
    for path in (MAP_FILE, MAP_FILE.replace(".json", ".example.json")):
        if os.path.exists(path):
            try:
                with open(path) as f:
                    m = json.load(f)
                return {
                    "magic": {str(k): v for k, v in (m.get("magic") or {}).items()},
                    "comment": m.get("comment") or {},
                }
            except Exception as e:
                print("Could not read strategy map:", e)
            break
    return {"magic": {}, "comment": {}}


STRATEGY_MAP = load_strategy_map()


def resolve_strategy(magic, comment):
    magic = str(magic or "")
    comment = (comment or "").strip()
    # 1) exact magic-number match
    if magic and magic in STRATEGY_MAP["magic"]:
        return STRATEGY_MAP["magic"][magic]
    # 2) comment substring match (case-insensitive)
    low = comment.lower()
    for key, strat in STRATEGY_MAP["comment"].items():
        if key.lower() in low:
            return strat
    # 3) fall back to the raw comment, else Unassigned
    return comment or "Unassigned"


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
        # trade_allowed is False on an investor login. Saying so out loud is
        # worth a line: it's the confirmation that the credential in .env is
        # the read-only one.
        mode = "investor (read-only)" if not acc.trade_allowed else "full trading access"
        print(f"Connected to MT5 account {acc.login} ({acc.server}) — {acc.currency}, {mode}")
        if acc.trade_allowed:
            print("  Tip: use your INVESTOR password instead. This bridge only ever reads.")


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


def build_trades(from_dt, to_dt, broker_account_id=None):
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
        order_magic = order_comment = None
        orders = mt5.history_orders_get(position=pid)
        if orders:
            o = orders[0]
            sl = o.sl or None
            tp = o.tp or None
            order_magic = getattr(o, "magic", None)
            order_comment = getattr(o, "comment", None)
            if sl and tp:
                risk = abs(entry_px - sl)
                if risk:
                    rr = round(abs(tp - entry_px) / risk, 2)

        # strategy from magic number / comment (order first, then opening deal)
        magic = order_magic if order_magic else getattr(first_in, "magic", None)
        comment = order_comment or getattr(first_in, "comment", None)
        strategy = resolve_strategy(magic, comment)

        close_dt = datetime.fromtimestamp(last_out.time, tz=timezone.utc)
        # 'fees' in the app is subtracted from pnl for net; commission/swap are
        # negative in MT5, so negate them to represent a positive cost.
        fees = round(-(p["commission"] + p["swap"]), 2)

        trades.append({
            "user_id": JOURNAL_USER_ID,
            "external_id": str(pid),
            "source": "mt5",
            "broker_account_id": broker_account_id,
            # Explicit, and load-bearing. The upsert lands on the same
            # (user_id, external_id) row the open-position sync wrote, and an
            # upsert only touches the columns it names — so omitting this
            # would leave a finished trade marked "open" forever, with its
            # P&L permanently excluded from every total.
            "status": "closed",
            "symbol": first_in.symbol,
            "side": side,
            "strategy": strategy,
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
            # Deliberately no rating: an auto-imported trade has not been
            # reviewed yet, and pre-filling one would make every synced trade
            # look journaled in the app.
            "notes": "",
            "opened_at": datetime.fromtimestamp(first_in.time, tz=timezone.utc).isoformat(),
            "closed_at": close_dt.isoformat(),
            "traded_at": close_dt.isoformat(),
        }, )
    return trades


def ensure_broker_account(sb):
    """Register this MT5 account in broker_accounts, and return its id.

    Only ever writes the account NUMBER and server name — never the password.
    The bridge attaches to a terminal you already logged into, so it has no
    credential to store even if it wanted one.

    Returns None if phase5.sql hasn't been applied yet; syncing still works,
    the trades are simply unattributed.
    """
    acc = mt5.account_info()
    if not acc:
        return None

    number = str(acc.login)
    try:
        found = (sb.table("broker_accounts").select("id")
                 .eq("user_id", JOURNAL_USER_ID)
                 .eq("platform", "mt5")
                 .eq("account_number", number)
                 .limit(1).execute())
        if found.data:
            return found.data[0]["id"]

        created = sb.table("broker_accounts").insert({
            "user_id": JOURNAL_USER_ID,
            "label": f"{acc.server} {number}",
            "broker": acc.server,
            "account_number": number,
            "platform": "mt5",
            "currency": acc.currency,
        }).execute()
        if created.data:
            print(f"Registered broker account {number} ({acc.server})")
            return created.data[0]["id"]
    except Exception as e:
        print("Could not register broker account (has phase5.sql been applied?):", e)
    return None


def stamp_sync(sb, account_id, error=None):
    """Record the outcome so the app can show a live/stale status."""
    if not account_id:
        return
    try:
        patch = {"last_sync_error": error, "updated_at": datetime.now(timezone.utc).isoformat()}
        if error is None:
            patch["last_synced_at"] = datetime.now(timezone.utc).isoformat()
        sb.table("broker_accounts").update(patch).eq("id", account_id).execute()
    except Exception as e:
        print("Could not update sync status:", e)


def stamp_account_state(sb, account_id):
    """Snapshot balance, equity and leverage onto the account row.

    A snapshot, not a history: the equity curve is already derived from the
    trades, and a balance row per poll would be a second source of truth for
    the same number that could disagree with the first.
    """
    if not account_id:
        return
    acc = mt5.account_info()
    if not acc:
        return
    try:
        sb.table("broker_accounts").update({
            "balance": round(acc.balance, 2),
            # Balance plus floating P&L — what the account is worth right now.
            "equity": round(acc.equity, 2),
            "leverage": int(acc.leverage or 0) or None,
            "currency": acc.currency,
            "state_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", account_id).execute()
    except Exception as e:
        # A missing column means phase5.sql predates this feature. Closed-trade
        # sync still works, so this is a note rather than a failure.
        print("Could not store account state (re-run supabase/phase5.sql?):", e)


def build_open_positions(broker_account_id=None):
    """Currently-open positions, in the journal's trade shape.

    Keyed on the position ticket — the same id `build_trades` uses for the
    closed round trip — so when the position closes, the closed-trade upsert
    lands on this very row and flips it from open to closed rather than
    leaving a duplicate behind.
    """
    positions = mt5.positions_get()
    if positions is None:
        print("positions_get returned None:", mt5.last_error())
        return []

    rows = []
    for p in positions:
        open_dt = datetime.fromtimestamp(p.time, tz=timezone.utc)
        side = "Long" if p.type == mt5.POSITION_TYPE_BUY else "Short"
        rows.append({
            "user_id": JOURNAL_USER_ID,
            "external_id": str(p.ticket),
            "source": "mt5",
            "broker_account_id": broker_account_id,
            "status": "open",
            "symbol": p.symbol,
            "side": side,
            "strategy": resolve_strategy(p.magic, p.comment),
            "session": session_for(open_dt.hour),
            "entry": round(p.price_open, 5),
            # The live mark, not an exit — nothing has been realised yet.
            "exit": round(p.price_current, 5),
            "qty": round(p.volume, 2),
            # Floating P&L. Every aggregate in the app filters on status, so
            # this is never counted as realised profit.
            "pnl": round(p.profit, 2),
            "fees": round(-p.swap, 2),
            "swap": round(p.swap, 2),
            "stop_loss": round(p.sl, 5) if p.sl else None,
            "take_profit": round(p.tp, 5) if p.tp else None,
            "notes": "",
            "opened_at": open_dt.isoformat(),
            "traded_at": open_dt.isoformat(),
        })
    return rows


def reconcile_open(sb, account_id, live_tickets):
    """Close out rows the journal still thinks are open but the broker doesn't.

    A position closed while the bridge was down usually gets picked up by the
    closed-trade sync. If it closed outside the lookback window that sync
    never sees it, and the row would sit there forever showing a position that
    no longer exists. So anything missing from the live list is looked up
    directly by ticket.
    """
    try:
        stale = (sb.table("trades").select("id,external_id")
                 .eq("user_id", JOURNAL_USER_ID)
                 .eq("source", "mt5")
                 .eq("status", "open")
                 .execute())
    except Exception as e:
        print("Could not check open positions:", e)
        return 0

    orphans = [r for r in (stale.data or []) if r["external_id"] not in live_tickets]
    if not orphans:
        return 0

    fixed = 0
    for row in orphans:
        ticket = row["external_id"]
        # history_deals_get accepts a position filter, which finds the close
        # regardless of how long ago it happened.
        deals = mt5.history_deals_get(position=int(ticket)) if ticket.isdigit() else None
        if not deals:
            print(f"  position {ticket} is gone from MT5 but has no history — leaving it alone")
            continue

        out = [d for d in deals if d.entry != mt5.DEAL_ENTRY_IN]
        if not out:
            continue
        last = max(out, key=lambda d: d.time)
        gross = sum(d.profit for d in out)
        costs = sum(d.commission + d.swap for d in deals)
        sb.table("trades").update({
            "status": "closed",
            "exit": round(last.price, 5),
            "pnl": round(gross, 2),
            "fees": round(-costs, 2),
            "traded_at": datetime.fromtimestamp(last.time, tz=timezone.utc).isoformat(),
            "closed_at": datetime.fromtimestamp(last.time, tz=timezone.utc).isoformat(),
        }).eq("id", row["id"]).execute()
        fixed += 1

    return fixed


def sync_once(sb, account_id=None):
    from_dt = read_cursor()
    to_dt = datetime.now(timezone.utc)
    try:
        trades = build_trades(from_dt, to_dt, account_id)
        if trades:
            # Upsert on (user_id, external_id) so re-runs never duplicate.
            sb.table("trades").upsert(
                [t for t in trades],
                on_conflict="user_id,external_id",
            ).execute()
            print(f"[{to_dt:%H:%M:%S}] synced {len(trades)} closed trade(s)")
        else:
            print(f"[{to_dt:%H:%M:%S}] no new closed trades")
    except Exception as e:
        # Surface the failure in the app rather than only in this console.
        stamp_sync(sb, account_id, str(e))
        raise

    if SYNC_OPEN:
        try:
            live = build_open_positions(account_id)
            if live:
                sb.table("trades").upsert(live, on_conflict="user_id,external_id").execute()
            tickets = {r["external_id"] for r in live}
            # Reconcile before reporting, so the count reflects reality.
            closed_late = reconcile_open(sb, account_id, tickets)
            note = f", {closed_late} closed late" if closed_late else ""
            print(f"[{to_dt:%H:%M:%S}] {len(live)} open position(s){note}")
        except Exception as e:
            print("Open position sync failed:", e)

    stamp_account_state(sb, account_id)
    stamp_sync(sb, account_id)
    # step the cursor back a little to catch late-settling deals
    write_cursor(to_dt - timedelta(hours=6))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="sync a single time and exit")
    args = parser.parse_args()

    require_config()
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    init_mt5()
    account_id = ensure_broker_account(sb)

    try:
        if args.once:
            sync_once(sb, account_id)
        else:
            print(f"Polling every {POLL_SECONDS}s. Press Ctrl+C to stop.")
            while True:
                try:
                    sync_once(sb, account_id)
                except Exception as e:
                    print("Sync error:", e)
                time.sleep(POLL_SECONDS)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
