"""
Forex Greek Journal — economic calendar importer.

Populates `public.economic_events`, which the Market page reads.

This is deliberately provider-agnostic. Calendar feeds differ in licensing —
some forbid redisplay, some require attribution, some are scraped and break
without warning — so choosing one is a decision for whoever runs this app, not
something baked into the code.

Two ways to use it:

  1. From a JSON file you produced however you like:
         python import_events.py --file events.json

  2. From a provider, by writing a small adapter (see ADAPTERS below):
         python import_events.py --provider myfeed --days 14

Setup and the normalized event shape: see calendar_bridge/README.md
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone

# `supabase` is imported lazily inside main() so `--dry-run` can validate a
# file before anything is installed or configured.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

VALID_IMPACTS = {"high", "medium", "low"}


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize(raw, source):
    """Coerce one provider record into the shape the table expects.

    Raises ValueError with a specific reason rather than writing a half-valid
    row — a calendar with silently wrong times is worse than an empty one.
    """
    event_at = raw.get("event_at") or raw.get("date") or raw.get("time")
    if not event_at:
        raise ValueError("missing event_at")

    # Accept epoch seconds, epoch ms, or an ISO string.
    if isinstance(event_at, (int, float)):
        seconds = event_at / 1000 if event_at > 1e11 else event_at
        dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
    else:
        text = str(event_at).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            # A naive timestamp is ambiguous. Assuming a zone would quietly
            # shift every release, so require the provider to be explicit.
            raise ValueError(f"timestamp {event_at!r} has no timezone")
        dt = dt.astimezone(timezone.utc)

    currency = str(raw.get("currency") or raw.get("country") or "").strip().upper()
    if not currency:
        raise ValueError("missing currency")

    title = str(raw.get("title") or raw.get("event") or "").strip()
    if not title:
        raise ValueError("missing title")

    impact = str(raw.get("impact") or "low").strip().lower()
    impact = {"1": "low", "2": "medium", "3": "high",
              "med": "medium", "moderate": "medium"}.get(impact, impact)
    if impact not in VALID_IMPACTS:
        impact = "low"

    def text_or_none(key):
        v = raw.get(key)
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    return {
        "event_at": dt.isoformat(),
        "currency": currency[:3] if len(currency) >= 3 else currency,
        "country": text_or_none("country_name") or raw.get("country"),
        "title": title,
        "impact": impact,
        # Kept as text on purpose: releases carry units ("3.2%", "250K") that a
        # numeric column would destroy.
        "actual": text_or_none("actual"),
        "forecast": text_or_none("forecast") or text_or_none("estimate"),
        "previous": text_or_none("previous"),
        "source": source,
        # Always set, so the single unique index can dedupe re-imports. When
        # the provider offers no id, the release itself is the natural key.
        "external_id": (text_or_none("external_id") or text_or_none("id")
                        or f"{dt.isoformat()}|{currency}|{title}"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
#
# To add a feed, write a function taking `days` and returning a list of raw
# dicts, then register it here. `normalize` handles the common field-name
# variations, so most adapters are a request and a return.
#
#     def fetch_myfeed(days):
#         r = requests.get("https://example.com/calendar", timeout=20)
#         r.raise_for_status()
#         return r.json()["events"]
#
#     ADAPTERS = {"myfeed": fetch_myfeed}
#
# Before adding one, check its terms actually permit redisplaying the data in
# your app.

def _apify(days, dump=False, dataset=None):
    # Imported lazily so `--file` and `--dry-run` never need apify-client.
    from apify_investing import fetch
    return fetch(days, dump=dump, dataset_id=dataset)


def _jblanked(days, dump=False, dataset=None):
    # jBlanked News API — hosted ForexFactory calendar, UTC timestamps,
    # free tier covers the today / week endpoints. Needs JBLANKED_API_KEY.
    _ = dataset  # not applicable
    from jblanked import fetch
    return fetch(days, dump=dump)


ADAPTERS = {"apify": _apify, "jblanked": _jblanked}


def load_from_file(path):
    with open(path) as f:
        data = json.load(f)
    # Accept either a bare list or {"events": [...]}.
    return data["events"] if isinstance(data, dict) and "events" in data else data


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def identity(row):
    """What actually makes a release distinct, regardless of provider ids."""
    return (row["event_at"], row["currency"], row["title"])


def dedupe(rows):
    """Collapse rows sharing a conflict key, because Postgres won't.

    A single `ON CONFLICT DO UPDATE` cannot affect the same row twice — it
    raises 21000 and the entire import fails. Feeds duplicate rows routinely,
    and this one reuses its `id` across different releases, so this has to be
    handled here rather than hoped away.

    Two distinct cases, treated differently on purpose:

      * Same key, same release — the feed listed it twice, or an earlier row
        lacks a figure the later one has. The later row wins.
      * Same key, *different* releases — the provider's id is not unique.
        Dropping one would silently lose an event, so the natural key is
        appended to tell them apart. It's deterministic, so re-imports still
        land on the same row.
    """
    # Which keys cover more than one distinct release is worked out up front,
    # over the whole batch. Deciding it as rows arrive would make the result
    # depend on their order: whichever release turned up first would keep the
    # bare id and the other would get suffixed, so a feed that returned them
    # the other way round next time would write a second copy of both. This
    # way a key's fate is the same regardless of order, which is what makes
    # re-imports land on the same rows.
    ambiguous = {}
    for row in rows:
        ambiguous.setdefault((row["source"], row["external_id"]), set()).add(identity(row))
    ambiguous = {k for k, ids in ambiguous.items() if len(ids) > 1}

    kept, collisions = {}, 0
    for row in rows:
        key = (row["source"], row["external_id"])
        if key in ambiguous:
            # Every member of a colliding group is suffixed, not just the
            # later arrivals — see above.
            row = {**row, "external_id": f"{row['external_id']}|{'|'.join(identity(row))}"}
            key = (row["source"], row["external_id"])
            collisions += 1
        kept[key] = row

    dropped = len(rows) - len(kept)
    if dropped:
        print(f"  collapsed {dropped} duplicate row(s)")
    if collisions:
        print(f"  {collisions} row(s) shared a provider id with a different "
              f"release — kept both, keyed on the release itself")
    return list(kept.values())


def upsert(sb, rows):
    """Write every row through the one unique key, (source, external_id).

    `normalize` guarantees external_id is set — falling back to the release's
    natural key — so a single conflict target covers providers that give ids
    and those that don't.
    """
    rows = dedupe(rows)
    if rows:
        sb.table("economic_events").upsert(
            rows, on_conflict="source,external_id").execute()
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", help="JSON file of events to import")
    parser.add_argument("--provider", help=f"registered adapter: {', '.join(ADAPTERS) or 'none yet'}")
    parser.add_argument("--days", type=int, default=14, help="how far ahead to fetch")
    parser.add_argument("--source", help="label stored on each row (defaults to the provider or filename)")
    parser.add_argument("--dry-run", action="store_true", help="normalize and report without writing")
    parser.add_argument("--dataset",
                        help="re-read an existing Apify dataset by id instead of starting a new "
                             "actor run — costs no compute, and works when a run succeeded but "
                             "the write afterwards didn't")
    parser.add_argument("--dump", action="store_true",
                        help="print the provider's first raw record — use when a feed changes shape")
    args = parser.parse_args()

    if not args.file and not args.provider:
        parser.error("give either --file or --provider")

    if args.provider:
        if args.provider not in ADAPTERS:
            print(f"No adapter named {args.provider!r}. Registered: {', '.join(ADAPTERS) or 'none'}")
            print("Add one in ADAPTERS — see the comment above it.")
            sys.exit(1)
        raw_events = ADAPTERS[args.provider](args.days, dump=args.dump, dataset=args.dataset)
        source = args.source or args.provider
    else:
        raw_events = load_from_file(args.file)
        source = args.source or os.path.basename(args.file).rsplit(".", 1)[0]

    rows, skipped = [], []
    for raw in raw_events:
        try:
            rows.append(normalize(raw, source))
        except (ValueError, TypeError) as e:
            skipped.append((raw.get("title") or raw.get("event") or "?", str(e)))

    print(f"Normalized {len(rows)} event(s) from {source}")
    # Done here as well as in upsert() so `--dry-run` reports duplicates
    # instead of letting the real run be the first to mention them. The second
    # pass has nothing left to collapse and stays quiet.
    rows = dedupe(rows)
    for title, reason in skipped:
        print(f"  skipped {title!r}: {reason}")

    if args.dry_run:
        print("Dry run — nothing written.")
        for r in rows[:5]:
            print(f"  {r['event_at']}  {r['currency']:<4} {r['impact']:<6} {r['title']}")
        if len(rows) > 5:
            print(f"  … and {len(rows) - 5} more")
        return

    if not rows:
        print("Nothing to write.")
        return

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    missing = [k for k, v in {"SUPABASE_URL": url, "SUPABASE_SERVICE_KEY": key}.items() if not v]
    if missing:
        print("Missing required env vars: " + ", ".join(missing))
        print("Copy .env.example to .env and fill it in.")
        sys.exit(1)

    from supabase import create_client

    sb = create_client(url, key)
    written = upsert(sb, rows)
    print(f"Wrote {written} event(s)")


if __name__ == "__main__":
    main()
