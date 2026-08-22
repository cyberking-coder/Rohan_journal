"""
Tests for the bridge's open-position handling, against a stubbed terminal.

    cd mt5_bridge && python test_sync.py

The MetaTrader5 package is Windows-only and needs a running terminal, so the
parts of this bridge that matter most — the open→closed transition and the
reconciliation of positions that vanished while the bridge was down — could
otherwise only be tested by trading real money and waiting. Stubbing the
terminal makes them ordinary assertions.
"""

import os
import sys
import types
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── Stub the terminal and the database before importing sync ────────────────
mt5 = types.ModuleType("MetaTrader5")
mt5.POSITION_TYPE_BUY = 0
mt5.POSITION_TYPE_SELL = 1
mt5.DEAL_ENTRY_IN = 0
mt5.DEAL_ENTRY_OUT = 1
mt5.DEAL_TYPE_BUY = 0
mt5.last_error = lambda: "stub"
mt5.initialize = lambda **kw: True
mt5.shutdown = lambda: None
mt5.positions_get = lambda: []
mt5.history_deals_get = lambda *a, **k: []
mt5.history_orders_get = lambda **k: []
mt5.account_info = lambda: None
sys.modules["MetaTrader5"] = mt5

supabase_mod = types.ModuleType("supabase")
supabase_mod.create_client = lambda *a, **k: None
sys.modules["supabase"] = supabase_mod

dotenv = types.ModuleType("dotenv")
dotenv.load_dotenv = lambda *a, **k: None
sys.modules["dotenv"] = dotenv

os.environ.setdefault("SUPABASE_URL", "https://stub.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "stub")
os.environ.setdefault("JOURNAL_USER_ID", "user-1")

import sync  # noqa: E402

fails = 0


def eq(label, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label:<52} {got!r}" + ("" if ok else f"   want {want!r}"))


def obj(**kw):
    return types.SimpleNamespace(**kw)


OPEN_TS = int(datetime(2026, 8, 12, 9, 0, tzinfo=timezone.utc).timestamp())
CLOSE_TS = int(datetime(2026, 8, 12, 14, 0, tzinfo=timezone.utc).timestamp())


# ── A fake Supabase table that records what it was asked to do ──────────────
class FakeTable:
    def __init__(self, store, name):
        self.store, self.name = store, name
        self._filters = {}

    def select(self, *a, **k):
        self._op = "select"
        return self

    def update(self, patch):
        self._op = ("update", patch)
        return self

    def upsert(self, rows, on_conflict=None):
        self.store.setdefault("upserts", []).extend(rows)
        self.store.setdefault("conflict", on_conflict)
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def limit(self, n):
        return self

    def execute(self):
        if getattr(self, "_op", None) == "select":
            return obj(data=self.store.get("open_rows", []))
        if isinstance(getattr(self, "_op", None), tuple):
            self.store.setdefault("updates", []).append((dict(self._filters), self._op[1]))
        return obj(data=[])


class FakeDB:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return FakeTable(self.store, name)


print("— open positions —")
mt5.positions_get = lambda: [
    obj(ticket=555001, time=OPEN_TS, type=mt5.POSITION_TYPE_BUY, symbol="EURUSD",
        volume=0.10, price_open=1.10000, price_current=1.10250, sl=1.09500, tp=1.11000,
        profit=25.0, swap=-0.40, magic=0, comment="TRC"),
    obj(ticket=555002, time=OPEN_TS, type=mt5.POSITION_TYPE_SELL, symbol="XAUUSD",
        volume=0.01, price_open=2400.0, price_current=2405.0, sl=0.0, tp=0.0,
        profit=-5.0, swap=0.0, magic=0, comment=""),
]

rows = sync.build_open_positions("acct-1")
eq("both positions read", len(rows), 2)
eq("marked open", rows[0]["status"], "open")
# Keyed on the position ticket — the same key build_trades uses — so the close
# lands on this row instead of creating a second one.
eq("keyed on the ticket", rows[0]["external_id"], "555001")
eq("side from position type", rows[0]["side"], "Long")
eq("short detected", rows[1]["side"], "Short")
eq("floating P&L carried", rows[0]["pnl"], 25.0)
eq("live mark in exit", rows[0]["exit"], 1.1025)
eq("stop kept", rows[0]["stop_loss"], 1.095)
# MT5 writes 0.0 for "no level set"; storing that would draw a stop at zero.
eq("zero stop becomes null", rows[1]["stop_loss"], None)
eq("zero target becomes null", rows[1]["take_profit"], None)
eq("opened_at set", rows[0]["opened_at"], datetime.fromtimestamp(OPEN_TS, tz=timezone.utc).isoformat())

mt5.positions_get = lambda: None
eq("terminal error is not a crash", sync.build_open_positions("acct-1"), [])

print("\n— the closed trade flips the same row —")
deals = [
    obj(position_id=555001, ticket=1, entry=mt5.DEAL_ENTRY_IN, type=mt5.DEAL_TYPE_BUY,
        symbol="EURUSD", volume=0.10, price=1.10000, profit=0.0, commission=-0.7, swap=0.0,
        time=OPEN_TS, magic=0, comment="TRC"),
    obj(position_id=555001, ticket=2, entry=mt5.DEAL_ENTRY_OUT, type=mt5.DEAL_TYPE_BUY,
        symbol="EURUSD", volume=0.10, price=1.10500, profit=50.0, commission=-0.7, swap=-0.4,
        time=CLOSE_TS, magic=0, comment=""),
]
mt5.history_deals_get = lambda *a, **k: deals
mt5.history_orders_get = lambda **k: []

closed = sync.build_trades(datetime(2026, 8, 1, tzinfo=timezone.utc), datetime(2026, 8, 20, tzinfo=timezone.utc), "acct-1")
eq("one round trip", len(closed), 1)
# The bug this guards: an upsert only writes the columns it names, so omitting
# status would leave a finished trade marked open forever and permanently
# excluded from every total.
eq("status is explicitly closed", closed[0]["status"], "closed")
eq("same key as the open row", closed[0]["external_id"], "555001")
eq("realised P&L", closed[0]["pnl"], 50.0)
eq("exit price", closed[0]["exit"], 1.105)
eq("opened_at preserved", closed[0]["opened_at"], datetime.fromtimestamp(OPEN_TS, tz=timezone.utc).isoformat())
eq("closed_at set", closed[0]["closed_at"], datetime.fromtimestamp(CLOSE_TS, tz=timezone.utc).isoformat())

print("\n— reconciling positions that vanished —")
# The journal thinks 555003 is open; the broker no longer lists it, and it
# closed outside the lookback window so the normal sync never sees it.
store = {"open_rows": [{"id": "row-3", "external_id": "555003"}]}
gone = [
    obj(position_id=555003, entry=mt5.DEAL_ENTRY_IN, price=1.2, profit=0.0, commission=-0.5, swap=0.0, time=OPEN_TS),
    obj(position_id=555003, entry=mt5.DEAL_ENTRY_OUT, price=1.19, profit=-100.0, commission=-0.5, swap=-1.0, time=CLOSE_TS),
]
mt5.history_deals_get = lambda *a, **k: gone
fixed = sync.reconcile_open(FakeDB(store), "acct-1", live_tickets=set())
eq("orphan closed out", fixed, 1)
eq("targeted the right row", store["updates"][0][0]["id"], "row-3")
eq("status corrected", store["updates"][0][1]["status"], "closed")
eq("P&L recovered from history", store["updates"][0][1]["pnl"], -100.0)
eq("exit recovered", store["updates"][0][1]["exit"], 1.19)

# A position still open at the broker must be left completely alone.
store2 = {"open_rows": [{"id": "row-1", "external_id": "555001"}]}
eq("live position untouched", sync.reconcile_open(FakeDB(store2), "acct-1", {"555001"}), 0)
eq("and no writes at all", store2.get("updates"), None)

# No history at all — refuse to guess rather than invent an exit price.
store3 = {"open_rows": [{"id": "row-9", "external_id": "555009"}]}
mt5.history_deals_get = lambda *a, **k: []
eq("unknown orphan left alone", sync.reconcile_open(FakeDB(store3), "acct-1", set()), 0)
eq("nothing fabricated", store3.get("updates"), None)

print("\n— account snapshot —")
mt5.account_info = lambda: obj(login=123, server="FundingPips-Live", currency="USD",
                               balance=10000.456, equity=10025.0, leverage=100, trade_allowed=False)
store4 = {}
sync.stamp_account_state(FakeDB(store4), "acct-1")
patch = store4["updates"][0][1]
eq("balance rounded", patch["balance"], 10000.46)
eq("equity stored", patch["equity"], 10025.0)
eq("leverage stored", patch["leverage"], 100)
eq("currency stored", patch["currency"], "USD")
eq("snapshot is stamped", "state_at" in patch, True)
# No account id means phase5.sql was never run; that must be a no-op, not a
# crash that stops the closed-trade sync.
store5 = {}
sync.stamp_account_state(FakeDB(store5), None)
eq("no account id is a no-op", store5, {})

print("\n" + (f"{fails} FAILED" if fails else "All bridge assertions passed."))
sys.exit(1 if fails else 0)
