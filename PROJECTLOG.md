# Project Log

Running record of work on the TradeFXBook parity effort.
Newest entries at the top. See `docs/README.md` for the phase plan.

**Legend:** ✅ done · 🚧 in progress · ⛔ blocked · ⏸ not started

---

## Phase status at a glance

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: routing, shell/nav, top bar, schema superset, filterable stats core | ✅ Done |
| 1 | Analysis module to full spec (filters, 9 widgets, ~30-metric stats block) | ✅ Done |
| 2 | Tools: Position Size Calculator, Forex Market Hours, tool shell | ✅ Done |
| 3 | Journal split-pane + Trades page to spec | ✅ Done |
| 4 | Dashboard widgets + Settings tabs & preferences | ✅ Done |
| 5 | Broker accounts & auto-sync | 🟡 Done except sync while your machine is off (vendor-gated) |
| 6 | Economic Calendar (Market) | ✅ Done — feed chosen (Apify / Investing.com) |
| 7 | AI Report generation + weekly quota | ✅ Done — needs an Anthropic API key to run |
| 8 | Backtesting (candle replay) | ✅ Done |
| 9 | Trader POV / shared read-only dashboards | ⏸ Not started |
| 10 | Community (lounges, leaderboard, affiliate) | ⏸ Not started — scope not confirmed |
| 11 | Billing (Stripe tiers) & Security tab | ⏸ Not started — scope not confirmed |

---

## Open decisions

These block or shape later phases. None block Phases 0–4.

1. **Broker sync vendor** — narrowed further. The bridge now logs in with an MT5
   **investor** password (read-only at the broker) and syncs open positions and
   account balance as well as closed trades, so MetaApi buys nothing except
   *running while your machine is off*. That still needs a host: a Windows VPS
   (~$5–15/mo, since the MetaTrader5 Python package is Windows-only and needs the
   terminal) or a hosted bridge. Not blocking anything.
2. ~~**Economic calendar feed**~~ — **decided.** The Apify actor
   `pintostudio/economic-calendar-data-investing-com`, wired up as
   `--provider apify`. The provider seam is unchanged, so switching later is still
   one file.
3. **Auth provider** — the spec documents Clerk; this repo uses Supabase Auth with RLS.
   Recommendation: stay on Supabase Auth. Awaiting confirmation.
4. **Scope of Community and Billing** — both add permanent operational and moderation
   burden. Confirm whether this stays a personal journal or becomes a multi-tenant SaaS.
5. **Analysis account scoping** — still open. Phase 1 shipped showing **all accounts**,
   matching the live app's apparent behaviour. Scoping it to the active account is a
   one-line change (`filterByAccount` from phase 5) if you'd rather it followed the
   Trades page's switcher.

---

## Entries

### 2026-08-13 — Per-user auth, and a backtester that needs no file

Two changes that turned out to belong together: the bridge had to authenticate
as the user before it could sensibly write candles on their behalf.

**Per-user auth (`mt5_bridge/journal_auth.py`)**
The bridge connected with the SERVICE key, which bypasses row-level security.
Fine when one person owns the database; unacceptable the moment a second
person runs it, because that key can read and modify *every* user's trades.
It now signs in with the journal email and password using the public anon key,
so RLS confines it to that user's own rows — the same protection the web app
relies on. The user id comes from the login rather than being copied by hand.
The service-key path still works for a single-user setup and warns loudly.

**Candles in the journal**
`supabase/phase8.sql` now has a `candles` table, and `export_candles.py
--timeframes M5,M15,H1,H4 --upload` pushes several sets in one run. The
Backtesting page reads them directly: pick a symbol, pick a timeframe, replay.
No file at all.

This reverses the "candles are not stored" decision in that file's own header,
and the header now says why. One of its two reasons doesn't survive contact
with what this actually does: redistribution means serving price data to *other
people*, and these rows are per-user and RLS-scoped — your broker's candles,
readable only by you. The other reason (bulk data is slow) still stands and
shapes the design, so the uploader warns before writing M1-scale history.

**Switching timeframe keeps your place in TIME**
The same instant is a different index in a different series, so jumping by
index would silently move you weeks. Orders carry absolute timestamps, the
cursor maps through `indexAtOrBefore`, and the session continues at the new
resolution — where a finer timeframe genuinely resolves fills the coarser one
could only guess at.

**A bug this exposed and fixed**
Replay state is now derived from the *actions* the trader took plus the
candles, rather than accumulated incrementally. That fixed a live bug:
scrubbing rebuilt state from fills alone, so any trade the user had closed by
hand simply vanished on rewind.

**And one I introduced, found by measuring**
Switching to a symbol with fewer bars left the cursor past the end — 509 of
200 — because the reset effect early-returned once it had seen the series key,
and the key changes a render *before* the shorter candle array arrives. The
cursor is now clamped on every length change.

**Verified**
- 493 JS assertions, 62 Python ones, clean build.
- `phase8.sql` run three times against PostgreSQL 16; re-uploading a bar
  updates it in place rather than duplicating.
- Browser: manual close survives a scrub; H1 → M15 holds the same moment
  (Jun 6 07:00) while the cursor moves 128/400 → 509/1600 with the position
  intact; a symbol switch clamps and clears correctly.

---

### 2026-08-13 — MT5 candle exporter

Answers "where do I get real candles" with: the terminal you already have
connected. `mt5_bridge/export_candles.py` pulls OHLC history via
`copy_rates_range` and writes a CSV the Backtesting page reads directly — your
broker's own prices, no vendor, no quota, and it works under the read-only
investor login since price history is market data rather than account data.

**The trap it exists to handle**
MT5 stamps every bar in *server* time, and most brokers run theirs on UTC+2/+3.
Treating those numbers as UTC shifts the whole file by a couple of hours. A
replay looks identical either way — same shape, same fills — which is precisely
why it matters: the error never announces itself, but the candles end up hours
away from your own trade times and from the journal's session analysis.

The offset is measured from a live tick and removed. When the market is closed
the last tick is stale and the difference is the tick's age rather than a
timezone, so it **refuses to guess** and says so, rather than shifting an entire
history file by a wrong amount. `--server-offset` is there for that case.

Also handles prop-firm symbol suffixes (`XAUUSD.s`, `GBPJPY-ECN`) — an
exact-match lookup would fail on exactly the accounts most likely to use this.

**Verified**
- 30 assertions in `mt5_bridge/test_export.py` against a stubbed terminal,
  weighted toward the offset logic and the weekend-refusal case.
- Round trip: 300 synthetic bars on a UTC+3 server exported, then parsed by the
  app's own `parseCandles` — 300 in, 300 out, no skips, H1 detected, and the
  midnight-server bar correctly landing at 00:00 UTC.
- Loaded in the browser on the Backtesting page: 120/300 window, H1, no
  warnings.

---

### 2026-08-13 — Fix: the MT5 upsert key was a partial index

First real run of the bridge against a live FundingPips account failed on
every trade write with `42P10: there is no unique or exclusion constraint
matching the ON CONFLICT specification`.

`mt5.sql` created `trades_user_external_uniq` with `where external_id is not
null`. Postgres cannot infer a *partial* index for `ON CONFLICT`, so the
upsert had no key to conflict on. This is the identical mistake found in
`phase6.sql` during the calendar work — same reasoning, same failure, and it
had been sitting in `mt5.sql` since well before this project started. It only
surfaced now because nobody had actually run the bridge.

The WHERE clause bought nothing: Postgres treats NULLs as distinct, so
manually-entered trades (which have no `external_id`) coexist happily under a
plain unique index.

Verified against PostgreSQL 16, including the upgrade path — an install
carrying the old partial index is fixed by re-running `mt5.sql` — and the
transition the bridge depends on: an open position upserted, then closed,
lands on one row rather than two.

**Action required:** re-run `supabase/mt5.sql`.

---

### 2026-08-13 — Investor-login sync: open positions and account balance

Closes the last non-vendor gap in phase 5. Prompted by the observation that an
MT5 **investor** password is read-only at the broker, which makes "this only
reads" a property of the credential rather than a promise the script makes
about itself.

**Built**
- Investor login in `mt5_bridge/`. The bridge can now log itself in rather than
  attaching to a terminal someone left open — which is what makes unattended
  operation possible. It prints which credential type it's using on startup.
- `balance`, `equity`, `leverage` and `state_at` on `broker_accounts`, stamped
  each sync. Added to `phase5.sql`, which is idempotent — **re-run it**.
- Open-position sync via `positions_get()`, stored with `status='open'` and
  keyed on the position ticket, so the close lands on the same row.
- `reconcile_open()` — a position closed while the bridge was down, and outside
  the lookback window, is looked up by ticket and closed out. With no history
  at all it's left alone rather than given an invented exit price.
- `mt5_bridge/test_sync.py` — 32 assertions against a stubbed terminal. The
  MetaTrader5 package is Windows-only, so these paths could otherwise only be
  tested by trading real money and waiting.

**The bug this could easily have introduced**
Floating P&L is not realised money. Three separate places would have counted
it as such:
- `stats.js` — every aggregate the Dashboard uses had no concept of `status`.
  Nine of them now filter through `realised()`, inside the functions rather
  than at the call sites so a new caller can't forget.
- `brokerAccounts.js` — `addTrade` folded floating P&L into account totals and
  counted a merely-green open position as a win.
- `build_trades` in the bridge didn't set `status`. An upsert only writes the
  columns it names, so a closed trade would have landed on the open row and
  left it marked open forever, permanently excluded from every total.

Each would have shown a number that was simply too good, with nothing visibly
broken.

**Verified**
- 496 JS assertions and 32 Python ones passing; clean build.
- `phase5.sql` re-run three times against PostgreSQL 16 on top of an existing
  install; columns added, nothing else touched.
- Browser: an account with two closed trades and one open position reads
  $166.00 realised, 2 trades, 50% win rate, and `Open 1 ($480)` — the floating
  figure kept visibly apart.

---

### 2026-08-13 — Phase 8: backtesting

Listed as gated on "a historical OHLC source". It wasn't: MetaTrader,
TradingView and most brokers export candle history as CSV, so the whole phase
is buildable with no vendor at all.

**Built**
- `parseCandles` — CSV, TSV and JSON, including MetaTrader's tab-separated
  `<DATE>`+`<TIME>` split, TradingView's ISO export, headerless files and bare
  `[t,o,h,l,c,v]` arrays. Sorts, de-duplicates and rejects corrupt bars.
- The simulation engine: order validation, fills, gaps, floating P&L.
- `CandleChart` — hand-drawn SVG. Recharts has no candlestick primitive and
  faking one from stacked bars fights the library the whole way.
- Replay UI: play/pause, five speeds, single-step, scrub.
- `backtest_sessions` table. Candles are **not** stored — bulk price data is
  slow through Postgres, and redistributing licensed market data is the one
  thing those agreements exist to prevent.

**The decision the whole thing rests on**
When a candle contains both the stop and the target, OHLC data cannot say
which was touched first — that lives in ticks the file doesn't carry.
Assuming the target is how a backtester flatters itself: every ambiguous bar
becomes a win and a losing strategy reads as profitable. So ambiguity resolves
to the **stop**, and the results panel says how many fills were decided that
way and what the optimistic reading would have changed the result by. A
strategy that only works if you assume the good outcome isn't a strategy.

Gaps are the exception and are not ambiguous: if a candle opens beyond a
level, that level filled at the open, because price was never at the level.

**Bugs found by testing, not by reading**
- The dot-to-dash rewrite for MetaTrader dates (`2026.08.13`) also ate the
  decimal point in ISO milliseconds (`09:00:00.000Z` → `09:00:00-000Z`),
  silently discarding every candle from an ordinary ISO export. Now only the
  date portion is rewritten.
- `date` and `time` both mapped to one key, so MetaTrader's second column
  overwrote the first and every candle in a day collapsed onto midnight.
- The chart's geometry memo didn't list the measured width as a dependency, so
  after the ResizeObserver fired the candles were still drawn to the
  pre-measurement 1000px — running to x=925 inside a 306-wide viewBox on a
  phone. Found by measuring the DOM rather than looking at the screenshot.

**Verified**
- 464 assertions passing; clean build.
- End-to-end browser run on a generated 400-candle MetaTrader file: parsed,
  H1 detected, order placed, stepped, filled at the stop for exactly -$15.00
  (0.1 lots x 100,000 x 0.0015).
- The ambiguity path exercised with a purpose-built file: resolved to the stop
  and reported the $400 swing.
- Both themes, 1400px and 390px, no horizontal overflow.

---

### 2026-08-13 — Phase 1: the Analysis module

The largest remaining piece, and the one the whole app points at. Most of the
risk was already retired: `analytics.js` has been computing and testing these
figures since phase 0, so this was widgets over tested maths rather than new
logic.

**Built**
- Filter bar: 6 periods × 3 trade-type pills, driving every widget from one
  place.
- Equity Curve with an Equity/Drawdown toggle and the 8-figure strip beneath.
- Win/Loss distribution, Long vs Short, Day of Week, Top Symbols.
- Session Performance: a 24h UTC timeline with a live NOW marker and three
  session cards.
- Trading Calendar: month heatmap, the spec's eighth Weekly rollup column, and
  a click-through day detail panel listing that day's trades.
- "Your Stats": best/worst/average month plus the ~35-metric two-column grid.
- New breakdowns in `analytics.js` (sessions, direction, day-of-week, symbols,
  distribution, calendar) with 60 assertions in `test/breakdowns.test.mjs`.

**Decisions worth recording**
- **The equity curve ignores the winners/losers pill.** A curve drawn from
  winners alone rises forever and a drawdown chart of losers only falls — both
  are meaningless shapes. The panel says so when the pill is set.
- **The calendar's month navigation is independent of the period filter.**
  They mean different things; tying them together makes "Last 7 days" render
  an almost empty grid.
- **Streamer Mode masks money only.** Win rates, trade counts and Max DD % stay
  readable — they give away nothing about account size, and blurring them while
  identical figures sat unmasked in the breakdowns just looked broken.
- **Padding days in the calendar show no P&L.** The weekly rollup deliberately
  counts only the current month's days, so showing the neighbours' figures made
  boundary weeks visibly fail to add up.
- **Max Drawdown % shows a dash, not 0%**, when equity never rose above its
  start. That's the spec's noted bug, and this is the fix.

**Found in the browser, not in review**
- Bar labels laid over the bars became unreadable exactly on the longest bars —
  the rows that matter most. Each figure now has its own column.
- Eight full distribution ranges ("-$393…-$294") collided into a smear; the
  axis carries the lower edge and the tooltip carries the range.
- Square calendar cells across eight columns were ~130px tall on a wide screen.
- On mobile the card silently **cropped** the Weekly column rather than
  overflowing, so the page reported no overflow while the column was simply
  unreachable. The grid now scrolls inside its own container.

**Verified**
- 390 assertions passing; clean build.
- Browser passes at 1400px and 390px, in both themes, with Streamer Mode on and
  off. No `$` survives in any SVG text with Streamer Mode enabled.

---

### 2026-08-13 — Calendar feed: Apify / Investing.com adapter

Closes the last open decision from phase 6.

**Built**
- `calendar_bridge/apify_investing.py` — adapter for the Apify actor, wired in
  as `--provider apify`.
- `--dump` on the importer, printing the provider's first raw record. This is a
  scraped feed; its field names will drift, and this is what turns that from a
  mystery into a one-line fix.
- `test_adapter.py` — 45 assertions, no framework.

**Two bugs the tests caught before this ever ran**
- A record carrying both `date` and `time` had its clock silently discarded:
  the key lookup found `date` first, parsed it as a valid midnight, and
  imported every release at 00:00. Nothing would have looked broken. Bare
  clocks are now searched for across the time-ish keys *before* the general
  lookup.
- `parse_date_only` used a length-slicing trick to strip trailing times that
  worked by accident on some layouts and not others. Replaced with explicit
  epoch / ISO / strptime branches.

**The setting that matters**
`APIFY_CALENDAR_TZ`. The actor publishes wall-clock times, so the zone has to
be supplied. Nothing is guessed — a real offset in the data wins, a bare clock
is read in the configured zone, and a record with neither is rejected and
reported rather than assumed. It carries DST properly (the same 08:30 New York
clock lands on 12:30 UTC in August and 13:30 in January), which a fixed offset
would get wrong for half the year.

**Not verified here**
The actor's exact output shape. `apify.com` is blocked by this environment's
egress proxy, so the field mapping is written against the layouts this data is
commonly published under rather than against a real response. The adapter
reports what it couldn't map instead of dropping it, so the first real run will
say plainly whether the mapping is right.

---

### 2026-08-13 — Phase 7: AI report

**Built**
- `ai_reports` table. The RLS is the design: select and delete for the owner,
  and **no insert policy at all**. A client that could insert here could mint
  itself unlimited reports, so the only writer is the edge function.
- `supabase/functions/generate-report/` — Deno edge function. Holds the
  Anthropic key, takes identity from the caller's verified JWT (never from the
  request body), counts the week's reports before spending anything, calls
  `claude-opus-5` with adaptive thinking and a strict JSON schema, and inserts
  the result with the service role.
- Weekly quota of 3, bucketed to Monday 00:00 UTC. The reset timer in the UI
  and the count in the function run the same rule; the client copy is
  explicitly advisory, and the comment in both files says so.
- AI Report page: featured latest report, expandable archive, per-section tone
  (strength / watch / fix), delete-with-confirm, and a setup panel that tells
  you exactly what's missing instead of showing a button that can't work.
- `summariseTrades` condenses history — including journal notes, clipped — into
  what the prompt is built from. A report written from P&L alone would just be
  the dashboard in prose.
- 53 new assertions in `test/aireport.test.mjs`, mostly on the week boundary:
  Sunday belonging to the week *before*, month and year rollovers, and quota
  never going negative and turning into extra credit.

**Verified**
- `npm test` — 333 assertions, all passing. `npm run build` clean.
- `phase7.sql` run against PostgreSQL 16 three times: idempotent, policies are
  select+delete only, `on delete cascade` from `auth.users` confirmed.
- Browser pass on the page in both the not-set-up state and with reports
  present.

**Not done**
- No API key is bundled, obviously. Generation costs money, and whose money it
  is is the operator's decision. The page is explicit about the two steps.
- The function is written but not deployed from here — deploying needs the
  Supabase CLI logged into the project.

---

### 2026-08-13 — Phase 6: economic calendar (feed choice excluded)

The second phase marked blocked. As with phase 5, most of it did not actually
depend on the blocked decision.

**Built**
- `economic_events` table. Read-only from the browser by design: this is shared
  reference data, and a client that could write here could feed every user of
  the app false economic figures. Only the importer's service role writes.
- Market page — day tabs, impact filters, country filter, search, event counts,
  live countdowns, a NEXT UP badge, and expandable rows showing whether the
  release beat or missed its forecast.
- Dashboard ticker now shows real high and medium impact releases, filtered to
  upcoming, and says plainly when the calendar isn't populated.
- `calendar_bridge/import_events.py` — takes a JSON file or a registered
  provider adapter, normalizes the common field-name variations, and upserts
  idempotently.

**Not built, deliberately: a bundled feed.**
Calendar providers differ in licensing — some forbid redisplaying their data in
another app, some require attribution, some are scraped and break without
warning. Picking one is a decision for whoever runs this app, and one worth
reading the terms on, so the importer takes whatever you give it instead.
Adding a provider is about five lines in `ADAPTERS`.

**Decisions worth recording**
- *Day boundaries are computed in the user's timezone*, not the browser's and
  not UTC. Otherwise "Today" shows yesterday's releases for anyone far enough
  east or west. Tests pin this: an event at 23:00 UTC is today in London,
  tomorrow in Tokyo, and still today in New York.
- *Released values stay text.* `3.2%` and `250K` carry units a numeric column
  would destroy, and parsing them into floats would invent precision the source
  never gave.
- *Beat/miss refuses to compare mismatched units.* Comparing `250K` against
  `3.2%` would produce a confident, meaningless verdict, so it returns nothing.
- *A naive timestamp is rejected, not guessed at.* Assuming a zone would
  silently shift every release in the import.
- *Past events with no published figure read "due now", not "released"* — the
  actual often lands a minute or two after the scheduled time.

**Two bugs found by testing, not by reading**
- The unique indexes were **partial** (`where external_id is not null`).
  PostgREST's upsert cannot infer a partial index, so every import would have
  failed at runtime with "no unique or exclusion constraint matching the ON
  CONFLICT specification". Replaced with one non-partial key; the importer now
  always sets `external_id`, falling back to the release's natural key.
  Caught by running the SQL against a real PostgreSQL 16 instance.
- `test/analytics.test.mjs` had a date-dependent assertion that broke when the
  clock rolled past midnight into Aug 13. Rewritten to construct "today"
  relative to now rather than relying on fixed sample dates.

**Verification**
- `npm test` now runs 280 assertions across six files. The new
  `test/calendar.test.mjs` covers timezone day boundaries in three zones, all
  five day tabs, impact/country/search filters and their combinations, grouping,
  next-up selection, every countdown branch, unit-aware release parsing, and the
  beat/miss logic including its refusal on mismatched units.
- SQL verified against real PostgreSQL 16: full chain applies, phase 6 is
  idempotent, both upsert paths update in place rather than duplicating, a
  different source with the same id stays a separate row, and the impact check
  constraint rejects an invalid value.
- Importer verified end-to-end on a fixture covering epoch seconds, a `+01:00`
  offset, alternate field names and numeric impact codes — plus three malformed
  records that were each rejected with a specific reason.
- Browser pass with injected fixture data (reverted before commit): rows,
  grouping, NEXT UP, countdowns, filters, expansion and the ticker all correct.
  Empty state verified separately as honest. No console errors.

**To apply:** run `supabase/phase6.sql`, then populate via `calendar_bridge/`.
Until then the page and ticker say they aren't set up rather than showing
invented events.

---

### 2026-08-12 — Phase 5: broker accounts (vendor-gated part excluded)

This was the phase marked blocked. Most of it turned out not to depend on the
vendor decision at all, so that part is built; the part that genuinely does is
called out below rather than faked.

**Built**
- `broker_accounts` table with RLS, plus the real foreign key from `trades`
  that phase 0 could only stub. It is ON DELETE SET NULL, not CASCADE: removing
  an account must never silently delete the trade history behind it.
- Account management in Settings → MT5/MT4: add, edit, favourite, disconnect
  (keeps history, stops treating it as live), and remove. Per-account P&L,
  trades, win rate, open positions and last sync.
- Sync status derived from real timestamps — connected / idle / stale / never
  synced / error / disconnected — so a bridge that quietly died is visible
  rather than letting the journal drift without the user noticing.
- `mt5_bridge/sync.py` now registers its own account on startup, stamps
  `broker_account_id` on every imported trade, and writes back success or the
  error text.
- Trades page switcher reads real accounts, with sync dots.
- Trades logged before this phase still appear, grouped by `source` and marked
  "not registered", so nothing vanishes from the switcher during the transition.

**Not built, deliberately: credential storage.**
The spec describes storing read-only investor passwords. This app is a browser
SPA talking straight to Supabase, so any column the client can read is one that
XSS, a malicious extension, or whoever picks up the laptop can read too.
Storing live broker credentials there turns a journal into a way to lose an
account. Doing it safely needs a server the browser cannot read from — an Edge
Function or hosted bridge holding the secret, written once and never returned —
which is the vendor decision still open. The schema has no credential column
and the SQL says why, so nobody adds one later without meeting the argument.
Meanwhile `mt5_bridge/` attaches to a terminal the user already logged into and
transmits no password at all.

**Other decisions**
- *Two kinds of account coexist.* Registered rows and source-derived groups are
  both shown. A test asserts attributed trades are never double-counted into a
  derived bucket.
- *A reported sync error outranks a fresh timestamp*, or a broken bridge would
  display as healthy.
- *The account-number field rejects anything that isn't a plain identifier.*
  It's a cheap guard against someone pasting a password into it.
- *The bridge no longer writes `rating: 3`.* Since phase 3 that fed the rating
  fallback, so every auto-imported trade showed 6/10 without the user ever
  rating it. Imported trades now arrive genuinely unrated.

**Verification**
- `npm test` now runs 221 assertions across five files. The new
  `test/accounts.test.mjs` covers every sync-status transition and its
  boundaries, error precedence, malformed timestamps, combining registered with
  derived accounts, no double counting, filtering by both id kinds, the privacy
  mask, and validation.
- `npm run build` passes; `mt5_bridge/sync.py` parses.
- Browser pass: derived groups shown, account created and persisted, number
  masked and revealed on request, never-synced and disconnected states,
  favourite and disconnect actions, validation rejecting a pasted secret, the
  Trades switcher picking up the registered account, and mobile layout.
  No console errors.

**To apply:** run `supabase/phase5.sql`. Without it the app falls back to
source-derived accounts and says so rather than erroring.

---

### 2026-08-12 — Phase 4 complete: Dashboard and Settings

**Dashboard** (`src/pages/Dashboard.jsx`)
- The spec's four headline cards: Total P&L, Unrealized, Realized, Win Rate
  (with a progress bar). Unrealized reads a genuine zero until broker sync
  reports open positions rather than being conjured from closed trades.
- Period tabs 1D / 1W / 1M / 3M / ALL driving a performance chart whose fill
  follows the direction of the period, so a losing stretch reads as one.
- Monthly P&L strip across all time, and the existing coaching and detail
  widgets kept below.

**Settings** (`src/pages/Settings.jsx`)
- Five tabs — Profile, MT5/MT4, Settings, Billing, Security — deep-linkable at
  `?view=settings&tab=<key>`.
- Preferences: dark mode, Streamer Mode, display currency, a 76-zone timezone
  picker, dismissed-notification restore, and a Danger Zone that requires
  typing DELETE.
- Preferences persist to localStorage immediately and mirror to a `profiles`
  row when Supabase is configured, so they follow the user across devices.

**Streamer Mode is real, not decorative.** Money is rendered through a `Money`
component that blurs under the setting and reveals on hover, so the trader can
still read their own screen. Chart axes and tooltips are masked separately —
blurring the whole chart would hide the shape, which is the useful part, but
leaving the axis visible would give away the account size. A browser check
confirms no `$` figure survives in any SVG text while the mode is on, and that
they all return when it is off.

**Decisions worth recording**
- *Currency changes the symbol only.* The spec is explicit about this and it is
  the right call: brokers report in the account's currency, and applying a
  conversion without an FX rate feed would silently misstate every figure. The
  setting is labelled to say so, and a test asserts the number never scales.
- *The news ticker ships as chrome with an honest empty state.* Its events need
  the phase 6 calendar feed. Scrolling invented headlines on a trading app
  would be worse than useless — a trader might act on them.
- *Notification toggles are disabled, not merely off.* Nothing can deliver a
  push or a trade alert until phases 5 and 7, and a switch that silently does
  nothing is worse than a greyed-out one that explains itself.
- *Billing says there is nothing to bill.* No fake plan badge, no invented
  "Elite" tier — the app has no paid tiers and takes no payment.
- *Security is honest about Google.* Google is the only sign-in method
  configured, so there is no password here to change; the tab offers
  "sign out everywhere" (a real global token revocation) and says plainly that
  account deletion needs a server-side admin call this app does not have.
- *Compact money keeps decimals under $10.* Rounding a real -$0.20 month to
  "-$0" reads as flat when it is not.

**Verification**
- `npm test` now runs 175 assertions across four files. The new
  `test/prefs.test.mjs` covers currency symbols and the no-conversion
  guarantee, compact formatting, timezone resolution and rendering (including
  that every one of the 76 offered zones is a valid IANA name — a bad entry
  would break every timestamp), monthly aggregation, and the realised/
  unrealised split.
- `npm run build` passes.
- Browser pass: four headline cards, period tabs, monthly strip, honest ticker,
  all five settings tabs with URL routing, streamer mode blurring money and
  masking chart axes, currency switching to EUR, timezone shifting 13:20 UTC to
  06:50 PM in Kolkata, preferences surviving a reload, and no horizontal scroll
  on mobile. No console errors.
- Two issues found and fixed during the pass: the monthly strip rendered
  -$0.20 as "-$0", and Streamer Mode left chart axis labels and tooltips
  readable.

**To apply:** run `supabase/phase4.sql` in the Supabase SQL editor. Preferences
work from localStorage without it; the table is what makes them follow you
across devices.

---

### 2026-08-12 — Phase 3 complete: Journal split-pane and Trades page

**Journal** (`src/pages/Journal.jsx`, `src/lib/journal.js`)
- Split-pane: left list with All / Journaled / Pending tabs and live counts,
  symbol-and-notes search, date filter, four sort orders, and NEW badges on
  un-journaled trades; right pane is the entry form for the selected trade.
- The five structured fields from the spec, plus planned risk:reward as two
  inputs and a 1-10 rating slider with a red-to-green track.
- A completeness meter, and a Save button that only enables when the draft
  actually differs from what is stored.
- Selection survives filter changes: if the selected trade is still in the
  list it stays selected, otherwise it falls back to the first row.

**Trades** (`src/pages/Trades.jsx`, `src/lib/accounts.js`)
- Account switcher with per-account trade counts and a privacy eye-toggle that
  masks identifiers, plus a summary strip (P&L, trades, win rate, open
  positions, last activity).
- History table per the spec: stacked open/close timestamps, direction badge,
  entry/exit/size, colour-coded P&L, source badge, row actions.
- Filters with an active-filter dot and an "N of M trades" count.
- Copy-trade-summary action, and delete disabled on synced trades with the
  spec's tooltip.
- Clear All requires typing DELETE — it wipes every trade and journal entry
  and cannot be undone.

**Decisions worth recording**
- *One rating, not two.* The repo had a 1-5 star rating; the spec uses 1-10.
  Rather than keep two competing fields for the same idea, `journal_rating`
  (1-10) is now the single field the app reads and writes. The migration is
  non-destructive: the old `rating` column is left untouched and its values are
  copied forward doubled (3 stars -> 6/10), and the backfill only touches rows
  not already migrated, so re-running is a no-op. The trade form's star widget
  and the Analysis rating distribution were moved onto the new scale, and the
  now-orphaned `TradeTable`/`StarRating` were deleted rather than left as a
  trap holding the obsolete scale.
- *`is_journaled` is a generated column* so it can never disagree with the
  fields it describes. The same rule is mirrored in JS for optimistic updates
  and for demo mode, which has no database.
- *Sync and Disconnect are disabled, not fake.* They need the phase 5 broker
  bridge; buttons that look live but do nothing are worse than honest ones.
- *Share copies a summary rather than publishing a link.* Public share URLs
  are the Trader POV feature in phase 9.
- *Clear All is scoped by `user_id` explicitly*, not left to RLS alone — a
  missing policy would otherwise turn it into a much larger delete.

**Verification**
- `npm test` now runs 134 assertions across three files. The new
  `test/journal.test.mjs` covers journaled-vs-pending (including
  whitespace-only fields, and a rating of 0 not being mistaken for unrated),
  the legacy 1-5 to 1-10 fallback, completion percentages, tab counts, search
  and all four sorts, non-mutation of the caller's array, planned-ratio
  formatting, account grouping and summaries, the privacy mask, and the share
  summary text.
- `npm run build` passes.
- Browser pass: tab counts, NEW badges (3 on 4 cards, matching the one
  journaled trade), save enabling only when dirty, counts updating after save,
  tab and search filtering, the account switcher and its mask, reveal toggle,
  account filtering, disabled sync, disabled delete on synced rows, the typed
  DELETE confirmation, and no horizontal scroll on mobile for either page.
  No console errors.
- One bug found and fixed during the pass: the rating slider's gradient was
  hidden behind the native range track, and "Last Activity" showed a dash when
  "All accounts" was selected because it read from a single account.

**To apply:** run `supabase/phase3.sql` in the Supabase SQL editor. The app
reads the new columns with fallbacks, so it works before and after — but
ratings and journal entries will not persist until it is applied.

---

### 2026-08-12 — Phase 2 complete: Tools module

Built out of order — Phase 2 is stateless and depends on nothing in Phase 1.

**Tool framework**
- `src/lib/tools.js` — config-driven registry; adding a tool is a data change.
- `src/pages/Tools.jsx` — grid with Popular/Live/Coming-Soon badges and
  Available/Coming-Soon counters. Unbuilt tools name the phase that delivers them.
- `src/components/ToolPageShell.jsx` — shared back-link/title/actions chrome.
- Tools open at `?view=tools&tool=<id>` via a new `useQueryParam` hook, so each
  tool is linkable and the back button steps out to the grid. The live app
  doesn't change its URL here; this is deliberately better.

**Position Size Calculator**
- `position_size = (balance × risk%) / (sl_pips × pip_value_per_lot)`, with
  standard/mini/micro lot outputs, risk amount and loss-at-stop.
- Risk slider 0.5–5% with 5 presets and Conservative/Moderate/Aggressive zones;
  live risk-amount readout as the slider moves.
- 32-instrument dropdown grouped by category. The live app lists BTCUSD and
  ETHUSD twice — a test asserts we have no duplicates.
- Custom pip-value override for traders using their broker's exact figure.

**Forex Market Hours**
- 12h/24h toggle, live clock, "N sessions open" banner with flags.
- Shared 24h UTC timeline with a live "now" line and per-city session bars.
  Sydney wraps past midnight and is drawn as two segments — a single bar would
  render as negative width.
- Weekend handling: forex is shut from Fri 22:00 UTC to Sun 22:00 UTC, so a
  session whose clock says "open" on a Saturday is correctly reported closed.
- Volume heuristic (London+NY overlap = High), and "Best Times to Trade" cards
  stored in UTC and converted to the viewer's local time.

**Decisions worth recording**
- *Two session models kept separate.* This tool uses four cities with real,
  overlapping hours; the Analysis module (phase 1) uses three non-overlapping
  sessions covering all 24h, because every trade must fall in exactly one
  bucket. The spec flags the difference; merging them would break one or the other.
- *Gold pip size shown as 0.10, not 0.01.* The live app displays pip size 0.01
  **and** pip value $10/lot, which are mutually inconsistent on a 100oz contract
  (0.01 there is $1/lot). The $10 pip value is what drives the maths and is
  verified, so that is preserved exactly — the displayed pip size is corrected
  to 0.10 so the two figures agree. Worth confirming against your broker.
- *Rate-dependent pip values are marked approximate.* Pip value in USD is only
  constant for USD-quoted pairs. JPY/CHF/CAD/AUD crosses, indices and crypto
  carry an `approx` note stating the rate assumed, and the UI shows a warning
  pointing at the custom-override field. Exact values need a live rate feed,
  which arrives in phase 6.
- *The two unnamed "coming soon" slots in the live app were left out.* A card
  with no title tells the user nothing.

**Verification**
- `npm test` now runs 82 assertions across two files. The new
  `test/tools.test.mjs` covers the calculator (including the spec's verified
  example: $10,000 / 1% / 20 pips / XAUUSD → **0.50 lots**, 5 mini, 50 micro,
  $100 risk), the invariant that loss-at-stop always equals intended risk,
  null-not-NaN handling for bad input, no duplicate instruments, session
  wrap-around, weekend closure and the volume heuristic.
- `npm run build` passes.
- Browser pass: grid renders 5 cards, tool opens and updates the URL, the
  calculator produces 0.50 lots for the spec's inputs, custom pip toggle works,
  back button returns to the grid, Market Hours shows the right open/closed
  state and live now-line, 12h/24h toggles, deep links work, light theme is
  clean, and mobile has no horizontal scroll on any of the three screens.
  No console errors.

---

### 2026-08-12 — Phase 0 complete: foundation

Everything below is code, verified in a browser and by a test run.

**Routing (`?view=<key>`)**
- `src/lib/views.js` — one list defining all 10 sections, which are built, and
  which phase owns the rest. The sidebar, mobile nav, command palette and
  router all read from it.
- `src/lib/router.js` — query-param router replacing the old `useState` page
  switch. Every section is now linkable and bookmarkable, and browser
  back/forward work. Unknown `?view=` values fall back to Dashboard.

**Shell and navigation**
- Sidebar lists all 10 spec sections; the 7 unbuilt ones carry a "soon" badge
  and route to `src/pages/ComingSoon.jsx`, which names the phase that delivers
  them rather than dead-ending.
- Mobile keeps a 4-slot tab bar (the built pages + quick-add); "More" opens the
  palette, which lists everything.

**Global top bar** (`src/components/TopBar.jsx`)
- Section title, ⌘K/Ctrl-K search, theme toggle, live clock with timezone,
  notifications bell, quick-add, and a profile menu (copy account ID, sign out).
- The bell deliberately shows an empty state — there is no notification source
  until trade alerts (phase 4) and broker sync (phase 5) exist.

**Command palette** (`src/components/CommandPalette.jsx`)
- ⌘K/Ctrl-K, fuzzy filter over sections and actions, arrow-key navigation,
  Enter to run, Escape to close.

**Light/dark theming**
- `src/lib/theme.jsx` — dark by default, persisted to localStorage, applied as
  `data-theme` on `<html>`. Streamer Mode state is plumbed here too, ready for
  the phase 4 Settings UI to write to.
- Full light palette added to `global.css`. This surfaced ~20 hardcoded dark
  colours across charts, inputs, the win-rate donut and the R:R hexagons that
  were invisible or unreadable in light mode; all are now tokens. Recharts
  writes to SVG presentation attributes where `var()` is not legal, so
  `charts.jsx` resolves its palette in JS from the active theme.

**Filterable analytics core** (`src/lib/analytics.js`)
- `filterTrades({ period, tradeType })` over the spec's 6 periods × 3 trade
  types, plus `computeAnalytics` returning the full metric set phase 1 needs
  (streaks, drawdown, session/day aggregates, hold times, profit-factor bands).
- `stats.js` is untouched, so the existing pages keep working; phase 1 migrates
  them onto this core.

**Schema superset** (`supabase/phase0.sql`, safe to re-run)
- Added `status` (open/closed), `opened_at` / `closed_at`, `broker_account_id`,
  and indexes for the period filters. Existing rows are backfilled from
  `traded_at`.
- `is_deletable` is a **generated** column derived from `source`, so a synced
  trade can never be marked deletable by accident.
- `swap` made non-null with a 0 default.
- Decision: `fees` stays the commission column rather than adding a second
  `commission` field. Every existing UI and the MT5 bridge already write to it,
  and two columns for one concept would drift apart. Documented via a SQL
  `comment on column`.

**Verification**
- `npm run build` passes.
- `npm test` (`test/analytics.test.mjs`) — 38 assertions reproducing the exact
  figures the spec verified against the live app: total P&L -$170.69, win rate
  10%, profit factor 0.23, expectancy -$17.07, avg winner $49.85, avg loser
  -$24.50, R:R 1:2.03, win streak 1, loss streak 8, 3 trading days, avg daily
  P&L -$56.90, avg losing day -$85.97, and the rest. All pass.
- Browser smoke test across 10 behaviours: default route, 10-item sidebar,
  navigation updating the URL, back button, deep-linking `?view=analysis`,
  palette open/filter/Enter, theme toggle, theme persisting across reload,
  invalid-view fallback, and the mobile layout. All pass, no console errors.
- Two bugs found and fixed during verification: the top-bar clock rendered its
  timezone as a superscript (the shared `.hide-mobile` class forces
  `inline-flex`, which overrode the intended column layout), and the light
  theme's chart/widget colours described above.

**Deliberately not done in this phase:** no new widgets, no page redesigns. The
existing Dashboard, Journal and Analysis pages render exactly as before — this
phase only built the foundation they grow on.

**To apply:** run `supabase/phase0.sql` in the Supabase SQL editor. No frontend
change depends on it yet, so the app works before and after.

---

### 2026-08-12 — Spec reviewed, plan drafted
- Read the full 24-page `TradeFXBook_Product_Specification_v2.pdf`: full-app overview
  (§1–§7), the exhaustive **Analysis** module dev spec, and the exhaustive **Tools**
  module dev spec.
- Surveyed the current repo: React 18 + Vite SPA, Supabase (auth + Postgres + storage),
  Recharts, Framer Motion, Vercel deploy, plus a Python `mt5_bridge/` MT5 sync script.
  ~2,100 lines across `src/`; three pages today (Dashboard, Journal, Analysis); one
  Supabase table (`public.trades`).
- **Conclusion: the spec is implementable in this repo.** The analytics, journal and
  tools work is extension of what already exists. The genuinely hard/costly items are
  broker auto-sync (needs a vendor), the economic calendar (needs a data feed), and
  backtesting (needs historical OHLC + a replay engine).
- Wrote `docs/README.md` with a 12-phase breakdown and a feasibility table per spec area.
- Created this log.
- **No feature code written.** Planning only, as requested.

---

## How to update this log

When a piece of work lands, add a dated entry at the top of **Entries** with what
changed and why, flip the relevant row in the phase table, and move any decision that
got answered out of **Open decisions** into the entry that recorded it.
