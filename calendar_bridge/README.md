# Economic calendar importer

Populates `public.economic_events`, which the **Market** page reads.

Apply `supabase/phase6.sql` first.

## Feeds

The importer takes whatever you give it: a JSON file, or a registered adapter.
One adapter ships — `apify`, below. Calendar providers differ in licensing
(some forbid redisplaying their data, some require attribution) so if you point
this at a new source, that's worth a look before you do.

## The `apify` provider

Runs the Apify actor `pintostudio/economic-calendar-data-investing-com`, which
scrapes Investing.com.

```bash
pip install -r requirements.txt          # includes apify-client
# .env: APIFY_TOKEN, and APIFY_CALENDAR_TZ — see below
python import_events.py --provider apify --dry-run
python import_events.py --provider apify
```

### Set `APIFY_CALENDAR_TZ` before you trust the times

This is the one setting that will quietly ruin the calendar. The actor
publishes wall-clock times ("12:30") rather than absolute ones, so the adapter
has to be told which zone to read them in before converting to UTC. Get it
wrong and every release is hours out — on a page whose whole purpose is
countdowns, that is worse than having no calendar at all.

Nothing is guessed: a record with a real offset is used as-is, a bare clock is
read in `APIFY_CALENDAR_TZ` (default `UTC`), and a record with neither is
rejected and reported rather than assumed.

**Confirmed against a real run: this actor publishes UTC.** UK releases land
at 06:00 UTC (the ONS's 07:00 London slot) and NZ ones at 03:00 UTC (RBNZ's
15:00 NZST), so the default `UTC` is correct. If you ever see everything off by
a whole number of hours, this is the setting.

### When the actor changes shape

It scrapes a website, so its field names can change without notice. The
adapter accepts the several spellings this data is commonly published under
and *reports* what it couldn't map instead of dropping it silently. To see what
the actor is actually returning:

```bash
python import_events.py --provider apify --dump --dry-run
```

That prints the first raw record verbatim; correct the `*_KEYS` lists at the
top of `apify_investing.py` to match. That's the whole maintenance burden.

Optional filters pass straight through to the actor via `APIFY_TIME_FILTER`,
`APIFY_IMPORTANCES`, `APIFY_CATEGORIES` and `APIFY_COUNTRY` in `.env`. Note
that `--days` does **not** drive the actor's window — the actor selects its own
via `timeFilter`; `--days` only exists for adapters that accept a range.

### Tests

```bash
python test_adapter.py
```

67 assertions, weighted heavily toward the timestamp handling — a scraped feed
read in the wrong timezone, or with its dates read in the wrong order, looks
completely fine and is completely wrong. Several run against a verbatim record
from a real actor run, so they break if the feed changes shape.

Two things worth knowing about this feed:

- **Dates are `DD/MM/YYYY`.** Slash dates are ambiguous for the first twelve
  days of every month, and a wrong reading doesn't error — it files releases in
  the wrong month. Pinned and asserted.
- **Holidays arrive with `time: "All Day"` and no currency.** They're kept
  (pinned to midnight, currency derived from the country) rather than dropped —
  a bank holiday is exactly what explains a dead session. That's why
  `COUNTRY_TO_CURRENCY` is long. A country not in it is skipped and named in
  the output, rather than becoming a three-letter pseudo-currency.

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

Write a function returning raw dicts and register it in `ADAPTERS` (see
`apify_investing.py` for a real one):

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
