"""
Tests for the candle exporter, against a stubbed terminal.

    cd mt5_bridge && python test_export.py

The timezone handling is the reason this file exists. A wrong server offset
produces a file that looks completely normal and is a couple of hours wrong —
the replay's shape is identical, so nothing on screen ever hints at it.
"""

import os
import sys
import types
import tempfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

mt5 = types.ModuleType("MetaTrader5")
for i, name in enumerate(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"]):
    setattr(mt5, f"TIMEFRAME_{name}", i + 1)
mt5.last_error = lambda: "stub"
mt5.initialize = lambda **kw: True
mt5.shutdown = lambda: None
mt5.symbol_info_tick = lambda s: None
mt5.symbol_info = lambda s: None
mt5.symbol_select = lambda s, v: True
mt5.symbols_get = lambda: []
mt5.copy_rates_range = lambda *a: []
sys.modules["MetaTrader5"] = mt5

dotenv = types.ModuleType("dotenv")
dotenv.load_dotenv = lambda *a, **k: None
sys.modules["dotenv"] = dotenv

import export_candles as ex  # noqa: E402

fails = 0


def eq(label, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label:<52} {got!r}" + ("" if ok else f"   want {want!r}"))


def obj(**kw):
    return types.SimpleNamespace(**kw)


NOW = 1786700000  # a fixed "real" UTC epoch

print("— server clock offset —")
# A broker on UTC+3 stamps ticks three hours ahead of the true time.
mt5.symbol_info_tick = lambda s: obj(time=NOW + 3 * 3600)
eq("UTC+3 detected", ex.detect_server_offset("EURUSD", NOW), 3 * 3600)

mt5.symbol_info_tick = lambda s: obj(time=NOW + 2 * 3600)
eq("UTC+2 detected", ex.detect_server_offset("EURUSD", NOW), 2 * 3600)

mt5.symbol_info_tick = lambda s: obj(time=NOW)
eq("UTC server is zero", ex.detect_server_offset("EURUSD", NOW), 0)

mt5.symbol_info_tick = lambda s: obj(time=NOW - 5 * 3600)
eq("negative offset", ex.detect_server_offset("EURUSD", NOW), -5 * 3600)

# A tick a minute or two old is still a usable reading — quotes don't arrive
# on the second.
mt5.symbol_info_tick = lambda s: obj(time=NOW + 3 * 3600 - 120)
eq("slightly stale tick still reads", ex.detect_server_offset("EURUSD", NOW), 3 * 3600)

# The weekend case. The last tick is two days old, so the difference is the
# tick's age, not a timezone. Returning a number here would shift an entire
# history file by a wrong amount — refusing is the only honest answer.
mt5.symbol_info_tick = lambda s: obj(time=NOW - 2 * 86400)
eq("stale weekend tick refuses", ex.detect_server_offset("EURUSD", NOW), None)
mt5.symbol_info_tick = lambda s: obj(time=NOW + 3 * 3600 - 900)
eq("15 minutes off is not a timezone", ex.detect_server_offset("EURUSD", NOW), None)
# Nowhere on earth is 20 hours from UTC; that's a broken clock.
mt5.symbol_info_tick = lambda s: obj(time=NOW + 20 * 3600)
eq("implausible offset refused", ex.detect_server_offset("EURUSD", NOW), None)

mt5.symbol_info_tick = lambda s: None
eq("no tick at all", ex.detect_server_offset("EURUSD", NOW), None)
mt5.symbol_info_tick = lambda s: obj(time=0)
eq("zero tick time", ex.detect_server_offset("EURUSD", NOW), None)

print("\n— broker symbol names —")
# Prop firms and ECN accounts suffix their symbols; an exact-match lookup fails
# on exactly the accounts this is most likely used with.
mt5.symbol_info = lambda s: None
mt5.symbols_get = lambda: [obj(name="EURUSD.s"), obj(name="XAUUSD.s"), obj(name="GBPJPY-ECN")]
eq("suffixed symbol found", ex.resolve_symbol("XAUUSD"), "XAUUSD.s")
eq("dashed suffix found", ex.resolve_symbol("GBPJPY"), "GBPJPY-ECN")
eq("case insensitive", ex.resolve_symbol("eurusd"), "EURUSD.s")
eq("genuinely absent", ex.resolve_symbol("NOTHING"), None)

# An exact match must win without scanning, and must be selected if hidden.
selected = []
mt5.symbol_info = lambda s: obj(visible=False) if s == "EURUSD" else None
mt5.symbol_select = lambda s, v: selected.append(s) or True
eq("exact match preferred", ex.resolve_symbol("EURUSD"), "EURUSD")
eq("hidden symbol selected", selected, ["EURUSD"])

print("\n— writing the file —")


class FakeRates(list):
    """Stands in for the numpy structured array copy_rates_range returns."""


def rate(t, o, h, l, c, v):
    r = {"time": t, "open": o, "high": h, "low": l, "close": c, "tick_volume": v}
    r_obj = dict(r)
    r_obj["dtype"] = types.SimpleNamespace(names=("time", "open", "high", "low", "close", "tick_volume"))
    return _Row(r_obj)


class _Row(dict):
    @property
    def dtype(self):
        return self["dtype"]


# 12:00 on a UTC+3 server is 09:00 UTC. Writing 12:00 would be the silent bug.
SERVER_NOON = int(datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc).timestamp())
rows = FakeRates([
    rate(SERVER_NOON, 1.1000, 1.1050, 1.0980, 1.1020, 500),
    rate(SERVER_NOON + 3600, 1.1020, 1.1080, 1.1010, 1.1070, 600),
])

path = os.path.join(tempfile.gettempdir(), "test_export.csv")
eq("row count returned", ex.write_csv(path, rows, 3 * 3600), 2)

lines = open(path).read().strip().split("\n")
eq("header matches what the app parses", lines[0], "time,open,high,low,close,volume")
eq("server noon written as 09:00 UTC", lines[1].split(",")[0], "2026-08-13T09:00:00Z")
eq("next bar an hour later", lines[2].split(",")[0], "2026-08-13T10:00:00Z")
eq("prices intact", lines[1].split(",")[1:5], ["1.1", "1.105", "1.098", "1.102"])
eq("volume carried", lines[1].split(",")[5], "500")

# With no offset the same bar keeps the server's clock — which is what the
# --server-offset flag exists to let you correct by hand.
ex.write_csv(path, rows, 0)
eq("zero offset leaves server time", open(path).read().split("\n")[1].split(",")[0], "2026-08-13T12:00:00Z")
os.remove(path)

print("\n— timeframes —")
eq("H1 maps", ex.timeframes()["H1"], mt5.TIMEFRAME_H1)
eq("all eight present", len(ex.timeframes()), 8)
try:
    ex.fetch("EURUSD", "H7", None, None)
    fails += 1
    print("FAIL  unknown timeframe should have been rejected")
except SystemExit as e:
    print(f"PASS  {'unknown timeframe rejected':<52} {str(e)[:44]}…")

print("\n" + (f"{fails} FAILED" if fails else "All exporter assertions passed."))
sys.exit(1 if fails else 0)
