"""
Tests for the Apify/Investing.com adapter and the shared normalizer.

Plain asserts, no framework:

    cd calendar_bridge && python test_adapter.py

These exist because the adapter maps a *scraped* feed, where the cost of a
quiet mistake is high: a timestamp read in the wrong zone, or a clock silently
dropped, produces a calendar that looks fine and is hours wrong.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import apify_investing as A
from import_events import normalize

fails = 0


def eq(label, got, want):
    global fails
    ok = got == want
    if not ok:
        fails += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label:<52} {got!r}" + ("" if ok else f"   want {want!r}"))


def raises(label, fn):
    global fails
    try:
        fn()
    except (ValueError, TypeError) as e:
        print(f"PASS  {label:<52} rejected: {e}")
        return
    fails += 1
    print(f"FAIL  {label:<52} should have been rejected")


os.environ["APIFY_CALENDAR_TZ"] = "UTC"

print("— timestamps —")
eq("epoch seconds", A.resolve_event_at({"timestamp": 1786804200}), "2026-08-15T14:30:00+00:00")
eq("epoch millis", A.resolve_event_at({"timestamp": 1786804200000}), "2026-08-15T14:30:00+00:00")
eq("ISO with Z", A.resolve_event_at({"dateUtc": "2026-08-14T12:30:00Z"}), "2026-08-14T12:30:00+00:00")
eq("ISO with offset", A.resolve_event_at({"dateUtc": "2026-08-14T08:30:00-04:00"}), "2026-08-14T12:30:00+00:00")
eq("space separator", A.resolve_event_at({"date": "2026-08-14 12:30:00"}), "2026-08-14T12:30:00+00:00")

# The bug this file was written for. A record carrying BOTH `date` and `time`
# must combine them. Looking up `date` first parses as a valid midnight and
# throws the clock away — every release imported at 00:00, silently.
eq("date + clock combine", A.resolve_event_at({"date": "2026-08-14", "time": "12:30"}), "2026-08-14T12:30:00+00:00")
eq("clock with seconds", A.resolve_event_at({"date": "2026-08-14", "time": "12:30:45"}), "2026-08-14T12:30:45+00:00")
eq("single-digit hour", A.resolve_event_at({"date": "2026-08-14", "time": "9:05"}), "2026-08-14T09:05:00+00:00")
eq("US date layout", A.resolve_event_at({"date": "08/14/2026", "time": "12:30"}), "2026-08-14T12:30:00+00:00")
eq("written date", A.resolve_event_at({"date": "Aug 14, 2026", "time": "12:30"}), "2026-08-14T12:30:00+00:00")

# The whole reason APIFY_CALENDAR_TZ exists. 08:30 in New York in August is
# EDT (UTC-4), so this must move *forward* to 12:30 UTC. Moving it the other
# way is the classic error and would put every US release 8 hours out.
os.environ["APIFY_CALENDAR_TZ"] = "America/New_York"
eq("wall clock read in NY", A.resolve_event_at({"date": "2026-08-14", "time": "08:30"}), "2026-08-14T12:30:00+00:00")
# Winter is EST (UTC-5) — the zone has to carry DST, not a fixed offset.
eq("same clock in January", A.resolve_event_at({"date": "2026-01-14", "time": "08:30"}), "2026-01-14T13:30:00+00:00")
# An explicit offset in the data always wins over the configured zone.
eq("offset beats the config", A.resolve_event_at({"dateUtc": "2026-08-14T12:30:00+00:00"}), "2026-08-14T12:30:00+00:00")
os.environ["APIFY_CALENDAR_TZ"] = "UTC"

raises("no time at all", lambda: A.resolve_event_at({"event": "CPI"}))
raises("clock with no date", lambda: A.resolve_event_at({"time": "12:30"}))
raises("unreadable date", lambda: A.resolve_event_at({"date": "next tuesday", "time": "12:30"}))
raises("unreadable timestamp", lambda: A.resolve_event_at({"date": "sometime"}))
raises("bad configured zone", lambda: A.calendar_zone.__globals__["os"].environ.__setitem__("APIFY_CALENDAR_TZ", "Mars/Olympus") or A.calendar_zone())
os.environ["APIFY_CALENDAR_TZ"] = "UTC"

print("\n— currency —")
eq("explicit currency", A.to_currency({"currency": "eur"}), "EUR")
eq("country mapped", A.to_currency({"country": "United States"}), "USD")
eq("euro member maps to EUR", A.to_currency({"country": "Germany"}), "EUR")
eq("case insensitive", A.to_currency({"country": "UNITED KINGDOM"}), "GBP")
eq("explicit wins", A.to_currency({"currency": "JPY", "country": "United States"}), "JPY")
# A non-3-letter 'currency' is not a currency; fall through to the country.
eq("junk currency falls through", A.to_currency({"currency": "United States", "country": "United States"}), "USD")
raises("no currency or country", lambda: A.to_currency({"event": "CPI"}))

print("\n— impact —")
eq("numeric 3", A.to_impact({"importance": "3"}), "high")
eq("word", A.to_impact({"importance": "High"}), "high")
eq("moderate", A.to_impact({"importance": "moderate"}), "medium")
eq("bull count", A.to_impact({"importance": "bull2"}), "medium")
eq("holiday", A.to_impact({"importance": "holiday"}), "low")
eq("missing defaults low", A.to_impact({}), "low")
eq("unknown defaults low", A.to_impact({"importance": "???"}), "low")

print("\n— whole records, through to the DB row —")
row = normalize(A.to_row({
    "id": "441", "date": "2026-08-14", "time": "12:30", "country": "United States",
    "importance": "3", "event": "CPI YoY", "actual": "", "forecast": "3.2%", "previous": "3.0%",
}), "apify")
eq("event_at", row["event_at"], "2026-08-14T12:30:00+00:00")
eq("currency", row["currency"], "USD")
eq("impact", row["impact"], "high")
eq("title", row["title"], "CPI YoY")
# An empty actual is 'not released yet', not the string ''.
eq("empty actual is null", row["actual"], None)
eq("forecast kept as text", row["forecast"], "3.2%")
eq("external id", row["external_id"], "441")
eq("source", row["source"], "apify")

# No provider id — normalize() must still produce one, or the upsert's single
# conflict target can't dedupe re-imports.
no_id = normalize(A.to_row({
    "dateUtc": "2026-08-14T12:30:00Z", "currency": "EUR", "event": "ECB Rate Decision", "importance": "3",
}), "apify")
eq("natural key stands in", no_id["external_id"], "2026-08-14T12:30:00+00:00|EUR|ECB Rate Decision")
# Same release, imported twice → same key, so it updates rather than duplicates.
again = normalize(A.to_row({
    "dateUtc": "2026-08-14T12:30:00Z", "currency": "EUR", "event": "ECB Rate Decision",
    "importance": "3", "actual": "2.25%",
}), "apify")
eq("re-import is the same key", again["external_id"], no_id["external_id"])
eq("but carries the result", again["actual"], "2.25%")

raises("titleless record", lambda: A.to_row({"date": "2026-08-14", "time": "12:30", "country": "United States"}))

print("\n— against a real actor record —")
# Verbatim from an actual run, keys and all. This is the contract; if the
# actor changes shape these are the assertions that break.
REAL_HOLIDAY = {
    "id": "187", "date": "13/08/2026", "time": "All Day", "zone": "tunisia",
    "currency": None, "importance": None, "event": "Tunisia - Women's Day",
    "actual": None, "forecast": None, "previous": None,
    "retrieved_at": "2026-08-13T16:43:37.701777", "data_type": "economic_calendar_event",
}
holiday = normalize(A.to_row(REAL_HOLIDAY), "apify")
# "All Day" isn't a clock. Dropping these loses bank holidays, which are
# exactly what explains a dead session.
eq("all-day pins to midnight", holiday["event_at"], "2026-08-13T00:00:00+00:00")
eq("holiday currency from zone", holiday["currency"], "TND")
eq("holiday impact", holiday["impact"], "low")
eq("holiday title", holiday["title"], "Tunisia - Women's Day")
eq("tentative also all-day", A.resolve_event_at({"date": "13/08/2026", "time": "Tentative"}), "2026-08-13T00:00:00+00:00")

REAL_EVENT = {
    "id": "412", "date": "13/08/2026", "time": "06:00", "zone": "united kingdom",
    "currency": "GBP", "importance": "medium", "event": "Business Investment (QoQ)  (Q2)",
    "actual": None, "forecast": "0.5%", "previous": "-0.3%",
}
real = normalize(A.to_row(REAL_EVENT), "apify")
eq("real event time", real["event_at"], "2026-08-13T06:00:00+00:00")
eq("real event currency", real["currency"], "GBP")
eq("real event impact", real["impact"], "medium")
eq("real event id", real["external_id"], "412")

# The one that would fail silently. This feed publishes DD/MM/YYYY, and slash
# dates are ambiguous for the first twelve days of every month: read as MM/DD,
# 08/09/2026 is the 8th of September rather than the 9th of August, and nothing
# anywhere reports an error.
eq("DD/MM, not MM/DD", A.resolve_event_at({"date": "08/09/2026", "time": "06:00"}), "2026-09-08T06:00:00+00:00")
eq("unambiguous DD/MM agrees", A.resolve_event_at({"date": "13/08/2026", "time": "06:00"}), "2026-08-13T06:00:00+00:00")

# An unmapped country must not become a three-letter pseudo-currency.
raises("unmapped country isn't truncated", lambda: A.to_currency({"zone": "atlantis", "currency": None}))
eq("zone is read as the country", A.to_currency({"zone": "japan", "currency": None}), "JPY")
# Real releases carry their own currency; the zone is only the fallback.
eq("currency wins over zone", A.to_currency({"zone": "euro zone", "currency": "EUR"}), "EUR")

print("\n" + (f"{fails} FAILED" if fails else "All adapter assertions passed."))
sys.exit(1 if fails else 0)
