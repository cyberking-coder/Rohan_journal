# jBlanked News API adapter — cleaner + cheaper alternative to the Apify
# Investing.com scraper. Pulls the ForexFactory calendar via jBlanked's
# hosted endpoints, which publish absolute UTC timestamps (no local-clock
# guessing needed) and don't charge per record.
#
# Docs: https://www.jblanked.com/news/api/
#
# Auth: Authorization: Api-Key <JBLANKED_API_KEY>
#
# We fetch the "week ahead" endpoint plus today (for events that started
# earlier in the current day) and hand each event to import_events.py's
# normaliser, so the same dedupe / write path applies as with any other
# adapter.

import os
from datetime import datetime, timedelta, timezone

import urllib.request
import urllib.error
import json

BASE = "https://www.jblanked.com/news/api/"

# How impact strengths in the feed map to our own three-tier scale.
IMPACT_MAP = {
    "High": "high",
    "Medium": "medium",
    "Low": "low",
    "Holiday": "low",   # holidays keep the row but sit at the lowest priority
    "Non-Economic": "low",
}


def _key():
    k = (os.environ.get("JBLANKED_API_KEY") or "").strip()
    if not k:
        raise SystemExit(
            "JBLANKED_API_KEY is not set. Get a key from "
            "https://www.jblanked.com/news/api/pricing/ (free tier available) "
            "and set it as an environment variable or GitHub Actions secret."
        )
    return k


def _get(path):
    req = urllib.request.Request(
        f"{BASE}{path.lstrip('/')}",
        headers={
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
        detail = e.read().decode("utf-8", errors="replace")[:300]
        raise SystemExit(f"jblanked {e.code} at {path}: {detail}")


def _parse_time(value):
    """Return an ISO 8601 UTC string for whatever the feed hands us."""
    if not value:
        return None
    s = str(value).strip()
    # Feed dates come as either "YYYY-MM-DDTHH:MM:SSZ" or "YYYY.MM.DD HH:MM:SS"
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")
        except ValueError:
            continue
    # Last resort: leave it alone and let the normaliser reject it loudly
    # rather than guessing a zone and silently placing every release at the
    # wrong instant.
    return s


def _normalise(item):
    """Map a jBlanked record to the shape import_events.py expects."""
    event_at = _parse_time(item.get("Date") or item.get("date"))
    strength = (item.get("Strength") or item.get("strength") or "").strip()
    return {
        "event_at": event_at,
        "currency": (item.get("Currency") or item.get("currency") or "").strip().upper(),
        "title": (item.get("Name") or item.get("name") or item.get("Event") or "").strip(),
        "impact": IMPACT_MAP.get(strength, "low"),
        "actual": item.get("Actual") or item.get("actual"),
        "forecast": item.get("Forecast") or item.get("forecast"),
        "previous": item.get("Previous") or item.get("previous"),
        "external_id": (
            str(item.get("EventID"))
            if item.get("EventID") is not None
            else f"{item.get('Currency','')}:{event_at}:{item.get('Name','')}"
        ),
        "source": "jblanked",
    }


def fetch(days=14, dump=False, dataset_id=None):
    """
    Pull a window of upcoming + recent events. `days` controls how far ahead
    we look; jBlanked publishes today, the current week, and the "next week"
    lists, so we walk those to cover any span up to ~2 weeks with one key.
    """
    _ = dataset_id  # not applicable

    items = []
    # jBlanked's public paths live under /list/. today + week covers the
    # window our Market page reads (±14 days). The last-N endpoint fills in
    # any releases that already happened earlier this week.
    items.extend(_get("/list/today/") or [])
    items.extend(_get("/list/week/") or [])
    try:
        items.extend(_get("/list/last/100/") or [])
    except SystemExit:
        # Optional endpoint; free tier may not include it.
        pass

    if dump and items:
        print("[jblanked] first record verbatim:")
        print(json.dumps(items[0], indent=2, default=str))

    # De-dupe by (currency, timestamp, title) — jBlanked's own week and today
    # endpoints overlap during the current calendar day.
    seen = set()
    out = []
    for raw in items:
        row = _normalise(raw)
        key = (row["currency"], row["event_at"], row["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(row)

    print(f"[jblanked] fetched {len(items)} raw item(s), {len(out)} unique after dedupe")
    return out
