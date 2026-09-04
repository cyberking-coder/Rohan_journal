# jBlanked News API adapter for the ForexFactory calendar.
#
# Docs: https://www.jblanked.com/news/api/docs/calendar/
#
# Auth: Authorization: Api-Key <JBLANKED_API_KEY>
#
# Free tier is capped at 1 request per day, so we pull the whole ±window
# in ONE call via /forex-factory/calendar/range/ rather than walking the
# per-day endpoints. Set JBLANKED_SOURCE=mql5 or =fxstreet to swap
# providers; forex-factory is a good default because its impact scale
# lines up with what most traders already read.

import os
import json
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

BASE = "https://www.jblanked.com/news/api/"

# Feed impact strings → our own three-tier scale. "None" (holidays and
# non-economic entries) collapses to low so the row stays but doesn't
# dominate the filter.
IMPACT_MAP = {
    "High": "high", "high": "high",
    "Medium": "medium", "medium": "medium",
    "Low": "low", "low": "low",
    "None": "low", "none": "low",
    "Holiday": "low",
}

SOURCES = {"forex-factory", "mql5", "fxstreet"}


def _key():
    k = (os.environ.get("JBLANKED_API_KEY") or "").strip()
    if not k:
        raise SystemExit(
            "JBLANKED_API_KEY is not set. Get a key from "
            "https://www.jblanked.com/api/key/ and add it as a repo secret."
        )
    return k


def _get(path):
    req = urllib.request.Request(
        f"{BASE}{path.lstrip('/')}",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Api-Key {_key()}",
            "Accept": "application/json",
            "User-Agent": "forexgreek-journal/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else []
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:400]
        raise SystemExit(f"jblanked {e.code} at {path}: {detail}")


def _resolve_tz(name):
    """Accept either an IANA zone (America/New_York) or a fixed offset
    written as 'UTC+3' / 'UTC-5' / 'GMT+2'. The latter is the safest choice
    for broker-time feeds because MT4/MT5 server clocks don't observe DST
    the way an IANA zone would."""
    s = (name or "").strip()
    m = None
    for prefix in ("UTC", "GMT"):
        if s.upper().startswith(prefix):
            rest = s[len(prefix):]
            if not rest:
                return timezone.utc
            try:
                hours = int(rest)
                return timezone(timedelta(hours=hours))
            except ValueError:
                pass
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(s)
    except Exception:
        return timezone.utc


def _parse_time(value):
    """Return an ISO 8601 UTC string for whatever the feed hands us.

    The feed's Date field looks like '2024.02.08 15:30:00' and doesn't
    include a timezone. jBlanked's default is broker server time — the
    MQL library docs call this "offset 0 = GMT-3", meaning raw stamps
    read as UTC+3 (a typical MT4/MT5 server clock). Override with
    JBLANKED_CALENDAR_TZ ('UTC+2', 'UTC-5', 'America/New_York', …) if
    your account is configured differently.
    """
    if not value:
        return None
    s = str(value).strip()
    dt = None
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt)
            break
        except ValueError:
            continue
    if dt is None:
        return s

    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    tz = _resolve_tz(os.environ.get("JBLANKED_CALENDAR_TZ", "UTC+3"))
    dt = dt.replace(tzinfo=tz)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalise(item):
    """Map a jBlanked record to the shape import_events.py expects."""
    event_at = _parse_time(item.get("Date") or item.get("date"))
    impact = (item.get("Impact") or item.get("impact") or "").strip()
    return {
        "event_at": event_at,
        "currency": (item.get("Currency") or item.get("currency") or "").strip().upper(),
        "title": (item.get("Name") or item.get("name") or item.get("Event") or "").strip(),
        "impact": IMPACT_MAP.get(impact, "low"),
        "actual": item.get("Actual") or item.get("actual"),
        "forecast": item.get("Forecast") or item.get("forecast"),
        "previous": item.get("Previous") or item.get("previous"),
        # Key on currency + calendar day + title rather than the full
        # timestamp, so a re-import with a corrected time updates the same
        # row instead of creating a duplicate.
        "external_id": f"{item.get('Currency','')}:{(event_at or '')[:10]}:{item.get('Name','')}",
        "source": "jblanked",
    }


def fetch(days=14, dump=False, dataset_id=None):
    """
    One request pulls the whole window (free tier is 1 req/day). Uses the
    /calendar/range/?from=&to= endpoint of the chosen source.
    """
    _ = dataset_id

    source = (os.environ.get("JBLANKED_SOURCE") or "forex-factory").strip().lower()
    if source not in SOURCES:
        raise SystemExit(f"JBLANKED_SOURCE must be one of {sorted(SOURCES)}; got {source!r}")

    # Give a couple of days of history so already-released figures update
    # once the actual value lands, and 'days' ahead for scheduled ones.
    today = datetime.now(timezone.utc).date()
    date_from = today - timedelta(days=2)
    date_to = today + timedelta(days=max(1, days))

    path = f"/{source}/calendar/range/?from={date_from.isoformat()}&to={date_to.isoformat()}"
    items = _get(path) or []

    if dump and items:
        print(f"[jblanked] first record from {source}:")
        print(json.dumps(items[0], indent=2, default=str))

    seen = set()
    out = []
    for raw in items:
        row = _normalise(raw)
        key = (row["currency"], row["event_at"], row["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(row)

    print(f"[jblanked] {source}: {len(items)} raw / {len(out)} unique "
          f"between {date_from} and {date_to}")
    return out
