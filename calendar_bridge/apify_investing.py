"""
Adapter for the Apify actor `pintostudio/economic-calendar-data-investing-com`.

Registered as the `apify` provider in import_events.py:

    python import_events.py --provider apify --dry-run
    python import_events.py --provider apify

Needs `APIFY_TOKEN` in .env and `pip install apify-client`.

── On the field names ──────────────────────────────────────────────────────
This actor scrapes Investing.com, and scraped feeds rename their fields
without notice. Rather than assume one layout, the mapping below accepts the
several spellings this data is commonly published under, and *raises* when it
can't find a required one — a calendar that silently drops half its releases,
or worse gets their times wrong, is more dangerous than an empty one.

If the actor changes shape, run:

    python import_events.py --provider apify --dump

which prints the first raw record, and correct the key lists below. That is
the whole maintenance burden.

── On the timestamps ───────────────────────────────────────────────────────
The trap in every Investing.com scrape: the time is published as a wall clock
("10:00") in whatever timezone the scrape ran under, with the date carried
separately or only in a section header. A naive timestamp assumed to be UTC
shifts every release by hours, which is worse than useless on a page whose
entire purpose is countdowns.

So: if a record carries a full timestamp with an offset, it is used as-is. If
it carries a bare clock time, `APIFY_CALENDAR_TZ` (default UTC) says what zone
to read it in, and the result is converted to UTC. If neither can be resolved,
the record is rejected with its raw content printed, not guessed at.
"""

import os
import re
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python < 3.9
    ZoneInfo = None

ACTOR = "pintostudio/economic-calendar-data-investing-com"

# Investing.com labels rows by country, not currency, and the Market page keys
# its flags and filter off the currency. Only the majors are mapped; anything
# else falls through to whatever the record itself provides.
COUNTRY_TO_CURRENCY = {
    "united states": "USD", "usa": "USD", "us": "USD",
    "euro zone": "EUR", "eurozone": "EUR", "european union": "EUR",
    "germany": "EUR", "france": "EUR", "italy": "EUR", "spain": "EUR",
    "netherlands": "EUR", "ireland": "EUR", "portugal": "EUR", "greece": "EUR",
    "united kingdom": "GBP", "uk": "GBP", "great britain": "GBP",
    "japan": "JPY", "switzerland": "CHF",
    "canada": "CAD", "australia": "AUD", "new zealand": "NZD",
    "china": "CNY", "hong kong": "HKD", "singapore": "SGD",
    "india": "INR", "brazil": "BRL", "mexico": "MXN",
    "south africa": "ZAR", "russia": "RUB", "turkey": "TRY",
    "south korea": "KRW", "korea": "KRW", "norway": "NOK", "sweden": "SEK",
    # The rest of what a real run returns — mostly needed for holiday rows,
    # which carry a country but no currency.
    "belgium": "EUR", "austria": "EUR", "finland": "EUR", "slovakia": "EUR",
    "slovenia": "EUR", "estonia": "EUR", "latvia": "EUR", "lithuania": "EUR",
    "cyprus": "EUR", "malta": "EUR", "luxembourg": "EUR", "croatia": "EUR",
    "poland": "PLN", "czech republic": "CZK", "hungary": "HUF",
    "romania": "RON", "serbia": "RSD", "denmark": "DKK", "iceland": "ISK",
    "philippines": "PHP", "thailand": "THB", "indonesia": "IDR",
    "malaysia": "MYR", "vietnam": "VND", "taiwan": "TWD", "pakistan": "PKR",
    "bangladesh": "BDT", "sri lanka": "LKR",
    "saudi arabia": "SAR", "israel": "ILS", "oman": "OMR", "qatar": "QAR",
    "kuwait": "KWD", "bahrain": "BHD", "jordan": "JOD", "lebanon": "LBP",
    "united arab emirates": "AED", "egypt": "EGP", "tunisia": "TND",
    "morocco": "MAD", "nigeria": "NGN", "kenya": "KES", "uganda": "UGX",
    "namibia": "NAD", "ghana": "GHS", "zambia": "ZMW", "botswana": "BWP",
    "argentina": "ARS", "chile": "CLP", "colombia": "COP", "peru": "PEN",
    "venezuela": "VES", "ukraine": "UAH", "kazakhstan": "KZT",
    "türkiye": "TRY", "turkiye": "TRY",
}

# Investing.com's own importance vocabulary, in every spelling seen in the wild.
IMPACT_MAP = {
    "3": "high", "high": "high", "hig": "high",
    "2": "medium", "medium": "medium", "moderate": "medium", "med": "medium",
    "1": "low", "low": "low",
    "0": "low", "holiday": "low", "": "low",
}

TIME_KEYS = ("timestamp", "dateUtc", "date_utc", "datetime", "eventTime", "date", "time")
TITLE_KEYS = ("event", "title", "name", "eventName", "indicator")
COUNTRY_KEYS = ("country", "countryName", "zone", "region")
CURRENCY_KEYS = ("currency", "currencyCode", "curr")
IMPACT_KEYS = ("importance", "impact", "volatility", "importanceLevel", "sentiment")
ID_KEYS = ("id", "eventId", "event_id", "_id", "rowId")

CLOCK = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")

# What this feed puts in the time column when there is no clock time.
ALL_DAY_LABELS = {"all day", "allday", "tentative", "holiday", "-", ""}


def first(raw, keys):
    """First non-empty value among `keys`. Scraped records carry empty strings
    as often as missing keys, so both count as absent."""
    for k in keys:
        v = raw.get(k)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        return v
    return None


def calendar_zone():
    name = os.environ.get("APIFY_CALENDAR_TZ", "UTC")
    if name.upper() == "UTC" or ZoneInfo is None:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except Exception as e:
        raise ValueError(f"APIFY_CALENDAR_TZ={name!r} is not a known timezone: {e}")


def resolve_event_at(raw):
    """Return an ISO 8601 UTC string, or raise ValueError explaining why not.

    Never guesses. Every branch below either knows the offset or is told it by
    APIFY_CALENDAR_TZ.
    """
    # A bare clock is checked for FIRST, across every time-ish key. Reaching
    # for `first(raw, TIME_KEYS)` up front is wrong when a record carries both
    # `date` and `time`: 'date' wins the lookup, parses as a valid midnight
    # timestamp, and the clock is silently discarded — every release imported
    # at 00:00, with nothing to show anything went wrong.
    clock = None
    for key in ("time", "timeOnly", "hour", "eventTime"):
        v = raw.get(key)
        if isinstance(v, str) and CLOCK.match(v.strip()):
            clock = CLOCK.match(v.strip())
            break
    if clock:
        return from_clock(raw, clock)

    # Holidays and undated releases carry a label where the clock goes:
    # "All Day", "Tentative", "Holiday". These matter on a forex calendar —
    # an all-day bank holiday is exactly the kind of thing that explains a
    # dead session — so they're kept, pinned to midnight in the configured
    # zone rather than dropped.
    label = raw.get("time")
    if isinstance(label, str) and label.strip().lower() in ALL_DAY_LABELS:
        return from_clock(raw, CLOCK.match("00:00"))

    value = first(raw, TIME_KEYS)
    if value is None:
        raise ValueError("no recognisable time field")

    # Epoch, seconds or milliseconds.
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.strip().isdigit() and len(value.strip()) >= 10):
        n = float(value)
        return datetime.fromtimestamp(n / 1000 if n > 1e11 else n, tz=timezone.utc).isoformat()

    text = str(value).strip()

    m = CLOCK.match(text)
    if m:
        return from_clock(raw, m)

    # A full timestamp. Trailing 'Z' is not accepted by fromisoformat before
    # 3.11, and a space separator is common in scraped output.
    iso = text.replace("Z", "+00:00").replace(" ", "T", 1)
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        raise ValueError(f"unparseable timestamp {text!r}")

    if dt.tzinfo is None:
        # Naive but complete: the actor's own timezone applies.
        dt = dt.replace(tzinfo=calendar_zone())
    return dt.astimezone(timezone.utc).isoformat()


def from_clock(raw, m):
    """A wall clock plus a sibling date field, read in APIFY_CALENDAR_TZ.

    The date has to come from somewhere; without one there is nothing honest
    to do but reject the record.
    """
    day = first(raw, ("date", "day", "eventDate", "dateOnly", "dateUtc", "timestamp"))
    if day is None:
        raise ValueError(f"time {m.group(0)!r} has no date alongside it")
    parsed_day = parse_date_only(str(day).strip())
    if parsed_day is None:
        raise ValueError(f"couldn't read a date out of {str(day).strip()!r}")
    hh, mm, ss = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    naive = datetime(parsed_day.year, parsed_day.month, parsed_day.day, hh, mm, ss)
    return naive.replace(tzinfo=calendar_zone()).astimezone(timezone.utc).isoformat()


def parse_date_only(text):
    """Read a date out of the layouts this feed publishes. Returns None rather
    than raising, so the caller can report the raw value."""
    text = text.strip()

    # An epoch used as the date field.
    if text.isdigit() and len(text) >= 10:
        n = float(text)
        return datetime.fromtimestamp(n / 1000 if n > 1e11 else n, tz=timezone.utc)

    # A full ISO timestamp used as the date field — the date half is all that's
    # wanted, since the caller has the clock.
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        pass

    # Only the date part is fed to strptime; several of these layouts appear
    # with a time trailing them.
    head = text.split("T")[0].split(" ")[0] if "-" in text or "/" in text else text

    # DD/MM/YYYY comes first, and that ordering is load-bearing rather than
    # arbitrary: this actor publishes "13/08/2026". Slash dates are ambiguous
    # for the first twelve days of every month — 08/09/2026 is a valid date
    # under both readings — so a wrong guess doesn't fail, it silently files
    # releases in the wrong month. Confirmed DD/MM against a real run; if you
    # point this at a US-formatted feed, this is the line to change, and
    # `test_adapter.py` has the assertion that will tell you.
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(head, fmt)
        except ValueError:
            continue
    for fmt in ("%b %d, %Y", "%d %b %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def to_currency(raw):
    explicit = first(raw, CURRENCY_KEYS)
    if explicit:
        code = str(explicit).strip().upper()
        if len(code) == 3 and code.isalpha():
            return code
    country = first(raw, COUNTRY_KEYS)
    if country:
        mapped = COUNTRY_TO_CURRENCY.get(str(country).strip().lower())
        if mapped:
            return mapped
        # Deliberately raises rather than falling back to the country name.
        # `normalize()` truncates to three characters, so "tunisia" would have
        # become the currency "TUN" — a plausible-looking value that is not a
        # currency at all, sitting in the page's filter forever. Better to skip
        # the row and print it; the message names the country to add above.
        raise ValueError(f"country {str(country).strip()!r} isn't in COUNTRY_TO_CURRENCY")
    raise ValueError("no currency or recognisable country")


def to_impact(raw):
    value = first(raw, IMPACT_KEYS)
    if value is None:
        return "low"
    key = str(value).strip().lower()
    if key in IMPACT_MAP:
        return IMPACT_MAP[key]
    # Some scrapes publish importance as a bull count ("bull3") or stars.
    digits = re.search(r"[0-3]", key)
    return IMPACT_MAP.get(digits.group(0), "low") if digits else "low"


def to_row(raw):
    """One Apify dataset item → the loose dict `normalize()` accepts."""
    title = first(raw, TITLE_KEYS)
    if not title:
        raise ValueError("no event title")

    return {
        "event_at": resolve_event_at(raw),
        "currency": to_currency(raw),
        "country": first(raw, COUNTRY_KEYS),
        "title": str(title).strip(),
        "impact": to_impact(raw),
        "actual": raw.get("actual"),
        "forecast": first(raw, ("forecast", "estimate", "consensus")),
        "previous": raw.get("previous"),
        # The actor's own id when it has one. Falling back to None lets
        # normalize() build the natural key, which keeps re-imports idempotent
        # either way.
        "external_id": first(raw, ID_KEYS),
    }


def fetch(days=14, dump=False):
    """Run the actor and return raw dicts for import_events.normalize().

    `days` is accepted for interface compatibility but the actor windows its
    own results — see the note in the README about `timeFilter`.
    """
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise SystemExit(
            "APIFY_TOKEN is not set. Copy .env.example to .env and add your "
            "Apify token (https://console.apify.com/account/integrations)."
        )

    try:
        from apify_client import ApifyClient
    except ImportError:
        raise SystemExit("pip install apify-client")

    client = ApifyClient(token)
    run_input = {
        # The actor's own window selector. 'time_only' returns the current
        # calendar view; see the README for why `days` doesn't drive this.
        "timeFilter": os.environ.get("APIFY_TIME_FILTER", "time_only"),
        "importances": os.environ.get("APIFY_IMPORTANCES", ""),
        "categories": os.environ.get("APIFY_CATEGORIES", ""),
        "country": os.environ.get("APIFY_COUNTRY", ""),
    }

    run = client.actor(ACTOR).call(run_input=run_input)

    # apify-client 3.x returns a `Run` object with snake_case attributes;
    # 1.x returned a plain dict with the camelCase wire names. Both are
    # accepted so an older pinned client doesn't break this.
    dataset_id = run.default_dataset_id if hasattr(run, "default_dataset_id") else run["defaultDatasetId"]
    run_id = getattr(run, "id", None) or (run.get("id") if isinstance(run, dict) else None)

    items = list(client.dataset(dataset_id).iterate_items())
    print(f"Apify run {run_id} returned {len(items)} item(s)")

    if dump:
        import json
        print("\n--- first raw item, verbatim ---")
        print(json.dumps(items[0] if items else {}, indent=2, default=str))
        print("--- end ---\n")

    rows, failed = [], []
    for item in items:
        try:
            rows.append(to_row(item))
        except (ValueError, TypeError, KeyError) as e:
            failed.append((str(e), item))

    if failed:
        # Printed, not swallowed. If the actor's shape drifts this is the
        # message that says exactly which key to fix.
        print(f"{len(failed)} item(s) couldn't be mapped:")
        for reason, item in failed[:3]:
            print(f"  {reason} — keys present: {sorted(item.keys())}")
        if len(failed) > 3:
            print(f"  … and {len(failed) - 3} more")
        if not rows:
            raise SystemExit(
                "Nothing mapped. The actor's field names have probably changed — "
                "run with --dump and update the *_KEYS lists in apify_investing.py."
            )

    return rows
