# Economic calendar importer

Populates `public.economic_events`, which the **Market** page reads.

Apply `supabase/phase6.sql` first.

## Why there is no feed built in

Calendar providers differ in licensing. Some forbid redisplaying their data in
another app, some require attribution, and the free scraped ones break without
warning. Picking one is a decision for whoever runs this app — and one worth
checking the terms on — so this importer takes whatever you give it instead.

## Setup

```bash
cd calendar_bridge
pip install -r requirements.txt
cp .env.example .env      # fill in your Supabase URL + SERVICE key
```

The service key bypasses Row Level Security, which is required: the table is
deliberately read-only from the browser, so nothing can feed every user of the
app false economic data.

## Importing from a file

```bash
python import_events.py --file events.json --dry-run   # check first
python import_events.py --file events.json
```

The file is either a bare list or `{"events": [...]}`. Per event:

| Field | Required | Notes |
| --- | --- | --- |
| `event_at` | yes | ISO 8601 **with a timezone**, or epoch seconds/ms. A naive timestamp is rejected rather than guessed at — assuming a zone would shift every release. |
| `currency` | yes | `USD`, `EUR`, … Drives the flag and the country filter. |
| `title` | yes | e.g. `CPI YoY`. |
| `impact` | no | `high` / `medium` / `low` (also accepts `1`/`2`/`3`). Defaults to `low`. |
| `actual`, `forecast`, `previous` | no | Kept as text — `3.2%` and `250K` carry units a number would lose. |
| `external_id` | no | The provider's stable id, if it has one. Makes re-imports idempotent. |

```json
[
  {
    "event_at": "2026-08-14T12:30:00Z",
    "currency": "USD",
    "title": "CPI YoY",
    "impact": "high",
    "forecast": "3.2%",
    "previous": "3.0%"
  }
]
```

Re-importing the same window updates rather than duplicates: rows with an
`external_id` key on `(source, external_id)`, and rows without key on
`(event_at, currency, title)`.

## Importing from a provider

Write a function returning raw dicts and register it in `ADAPTERS`:

```python
def fetch_myfeed(days):
    r = requests.get("https://example.com/calendar", timeout=20)
    r.raise_for_status()
    return r.json()["events"]

ADAPTERS = {"myfeed": fetch_myfeed}
```

Then `python import_events.py --provider myfeed --days 14`.

`normalize()` already handles the common field-name variations (`date`/`time`
for the timestamp, `event` for the title, `estimate` for the forecast), so most
adapters are a request and a return.

## Keeping it current

Run it on a schedule — Task Scheduler, cron, or a GitHub Action:

```
0 */6 * * *  cd /path/to/calendar_bridge && python import_events.py --provider myfeed
```

Events with no `actual` yet are re-imported with the published figure once the
release lands, so a few runs a day keeps results fresh.
