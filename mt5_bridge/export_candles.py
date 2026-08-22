"""
Forex Greek Journal — MT5 candle exporter.

Pulls OHLC history out of the MetaTrader 5 terminal you're already connected to
and writes a CSV the Backtesting page reads directly. Your broker's own prices,
no data vendor, no quota.

    python export_candles.py --symbol XAUUSD --timeframe H1 --days 365
    python export_candles.py --list gold          # what's this broker calling it?
    python export_candles.py --symbol EURUSD --timeframe M5 --from 2026-01-01 --to 2026-06-30

Runs on the same Windows machine as the terminal, and works with the read-only
investor login — price history is market data, not account data.

── The trap this file exists to handle ────────────────────────────────────────
MT5 timestamps every bar in *server* time, not UTC. Most brokers run their
server on UTC+2/+3, so treating those numbers as UTC shifts every candle by a
couple of hours. For a replay in isolation that's invisible — the shape is
identical — but it silently misaligns the bars with your trade times and with
the journal's session analysis, which is exactly the kind of wrongness that
never announces itself. So the offset is detected and removed, and the file is
written in real UTC.
"""

import os
import sys
import time as _time
import argparse
from datetime import datetime, timedelta, timezone

try:
    import MetaTrader5 as mt5
except ImportError:
    print("MetaTrader5 package not found. Run: pip install -r requirements.txt")
    print("Note: the MetaTrader5 package is Windows-only.")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

MT5_LOGIN = os.environ.get("MT5_LOGIN")
MT5_PASSWORD = os.environ.get("MT5_PASSWORD")
MT5_SERVER = os.environ.get("MT5_SERVER")


def timeframes():
    """Name → MT5 constant. Built at call time so tests can stub the module."""
    return {
        "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
    }


def detect_server_offset(symbol, now_epoch=None):
    """Seconds the broker's server clock runs ahead of UTC.

    Measured from a live tick: the tick's timestamp is server time, and we know
    what time it actually is, so the difference is the offset.

    Returns None rather than a guess when the reading isn't trustworthy — over
    a weekend the last tick can be days old, and the difference is then the age
    of the tick rather than a timezone. Guessing there would shift an entire
    history file by a wrong amount, which is worse than asking.
    """
    tick = mt5.symbol_info_tick(symbol)
    if not tick or not getattr(tick, "time", None):
        return None

    now = now_epoch if now_epoch is not None else _time.time()
    diff = tick.time - now
    hours = round(diff / 3600)

    # A real timezone offset lands within a few minutes of a whole hour. A
    # stale tick does not.
    if abs(diff - hours * 3600) > 300:
        return None
    # Nothing on earth is more than 14 hours from UTC.
    if abs(hours) > 14:
        return None
    return hours * 3600


def resolve_symbol(name):
    """Find the broker's actual name for a symbol and make sure it's selected.

    Prop firms and ECN brokers suffix their symbols — XAUUSD.s, EURUSD-ECN,
    GBPJPY.raw — so an exact-match-only lookup fails on the very accounts this
    is most likely to be used with.
    """
    info = mt5.symbol_info(name)
    if info:
        if not info.visible:
            mt5.symbol_select(name, True)
        return name

    wanted = name.upper().replace(".", "").replace("-", "").replace("_", "")
    for s in (mt5.symbols_get() or []):
        plain = s.name.upper().replace(".", "").replace("-", "").replace("_", "")
        if plain == wanted or plain.startswith(wanted):
            mt5.symbol_select(s.name, True)
            print(f"Using broker symbol {s.name!r} for {name!r}")
            return s.name
    return None


def fetch(symbol, timeframe, start, end):
    tf = timeframes().get(timeframe.upper())
    if tf is None:
        raise SystemExit(f"Unknown timeframe {timeframe!r}. Pick one of: {', '.join(timeframes())}")

    rates = mt5.copy_rates_range(symbol, tf, start, end)
    if rates is None:
        raise SystemExit(f"copy_rates_range failed: {mt5.last_error()}")
    return rates


def write_csv(path, rates, offset_seconds):
    """Write bars as CSV in real UTC.

    The column names are the ones `parseCandles` in the app already reads, so
    the file loads with no further translation.
    """
    with open(path, "w", newline="") as f:
        f.write("time,open,high,low,close,volume\n")
        for r in rates:
            stamp = datetime.fromtimestamp(int(r["time"]) - offset_seconds, tz=timezone.utc)
            f.write("{},{},{},{},{},{}\n".format(
                stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
                r["open"], r["high"], r["low"], r["close"],
                int(r["tick_volume"]) if "tick_volume" in r.dtype.names else 0,
            ))
    return len(rates)


def init():
    kwargs = {}
    if MT5_LOGIN and MT5_PASSWORD and MT5_SERVER:
        kwargs = dict(login=int(MT5_LOGIN), password=MT5_PASSWORD, server=MT5_SERVER)
    if not mt5.initialize(**kwargs):
        print("MT5 initialize() failed:", mt5.last_error())
        print("Make sure the MetaTrader 5 terminal is installed and running.")
        sys.exit(1)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--symbol", help="e.g. EURUSD, XAUUSD")
    p.add_argument("--timeframe", default="H1",
                   help="M1, M5, M15, M30, H1, H4, D1 or W1 (default H1)")
    p.add_argument("--days", type=int, help="how far back to fetch (default 365)")
    p.add_argument("--from", dest="start", help="start date, YYYY-MM-DD")
    p.add_argument("--to", dest="end", help="end date, YYYY-MM-DD")
    p.add_argument("--out", help="output file (default <SYMBOL>_<TF>.csv)")
    p.add_argument("--list", dest="pattern", nargs="?", const="", help="list matching symbols and exit")
    p.add_argument("--server-offset", type=float,
                   help="hours the broker's server is ahead of UTC, if detection can't tell "
                        "(markets closed). Most are +2 in winter, +3 in summer.")
    args = p.parse_args()

    init()
    try:
        if args.pattern is not None:
            needle = args.pattern.upper()
            names = sorted(s.name for s in (mt5.symbols_get() or []) if needle in s.name.upper())
            print(f"{len(names)} symbol(s) matching {args.pattern!r}:" if needle
                  else f"{len(names)} symbol(s):")
            for n in names[:120]:
                print("  " + n)
            if len(names) > 120:
                print(f"  … and {len(names) - 120} more")
            return

        if not args.symbol:
            p.error("--symbol is required (or use --list to see what's available)")

        symbol = resolve_symbol(args.symbol)
        if not symbol:
            print(f"No symbol matching {args.symbol!r}. Try: python export_candles.py --list")
            sys.exit(1)

        # Range. `--from/--to` win; otherwise `--days` back from now.
        end = datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=timezone.utc) if args.end \
            else datetime.now(timezone.utc)
        if args.start:
            start = datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        else:
            start = end - timedelta(days=args.days or 365)
        if start >= end:
            print("The start date is not before the end date.")
            sys.exit(1)

        offset = int(args.server_offset * 3600) if args.server_offset is not None \
            else detect_server_offset(symbol)

        if offset is None:
            print("Could not read the server's clock offset — the market is probably closed.")
            print("Bars will be written as-is, in SERVER time, which is usually UTC+2 or +3.")
            print("Re-run during market hours, or pass --server-offset 3 to correct it.")
            offset = 0
        else:
            print(f"Server clock is UTC{offset / 3600:+.0f}; converting bars to UTC.")

        # The range is asked for in server time, since that's what MT5 matches
        # against — so the offset goes back on for the query.
        rates = fetch(symbol,
                      args.timeframe,
                      start + timedelta(seconds=offset),
                      end + timedelta(seconds=offset))

        if len(rates) == 0:
            print("No bars returned. The terminal may not have this history downloaded —")
            print("open the chart for this symbol and timeframe, scroll back, then retry.")
            sys.exit(1)

        out = args.out or f"{symbol.replace('.', '_')}_{args.timeframe.upper()}.csv"
        count = write_csv(out, rates, offset)

        first = datetime.fromtimestamp(int(rates[0]["time"]) - offset, tz=timezone.utc)
        last = datetime.fromtimestamp(int(rates[-1]["time"]) - offset, tz=timezone.utc)
        print(f"Wrote {count} bars to {out}")
        print(f"  {first:%Y-%m-%d %H:%M} → {last:%Y-%m-%d %H:%M} UTC")

        # The terminal caps how much history it holds in memory ("Max bars in
        # chart"). Silently returning a truncated range would look like the
        # broker simply has no older data.
        if count >= 99000:
            print("  Note: that's near the terminal's bar limit — the range may be truncated.")
            print("  Raise Tools → Options → Charts → Max bars in chart, or fetch a shorter span.")

        print(f"\nLoad it on the Backtesting page: Choose a file → {out}")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
