# Project Log

Running record of work on the TradeFXBook parity effort.
Newest entries at the top. See `docs/README.md` for the phase plan.

**Legend:** ✅ done · 🚧 in progress · ⛔ blocked · ⏸ not started

---

## Phase status at a glance

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: routing, shell/nav, top bar, schema superset, filterable stats core | ✅ Done |
| 1 | Analysis module to full spec (filters, 9 widgets, ~30-metric stats block) | ⏸ Not started |
| 2 | Tools: Position Size Calculator, Forex Market Hours, tool shell | ✅ Done |
| 3 | Journal split-pane + Trades page to spec | ✅ Done |
| 4 | Dashboard widgets + Settings tabs & preferences | ✅ Done |
| 5 | Broker accounts & auto-sync | ⛔ Blocked — needs a broker-bridge vendor decision |
| 6 | Economic Calendar (Market) | ⛔ Blocked — needs a calendar data-feed decision |
| 7 | AI Report generation + weekly quota | ⏸ Not started |
| 8 | Backtesting (candle replay) | ⏸ Not started |
| 9 | Trader POV / shared read-only dashboards | ⏸ Not started |
| 10 | Community (lounges, leaderboard, affiliate) | ⏸ Not started — scope not confirmed |
| 11 | Billing (Stripe tiers) & Security tab | ⏸ Not started — scope not confirmed |

---

## Open decisions

These block or shape later phases. None block Phases 0–4.

1. **Broker sync vendor** — MetaApi.cloud (paid, cloud-native) vs. hosting the existing
   `mt5_bridge/sync.py` on a Windows box vs. a custom EA + webhook bridge. Affects Phase 5.
2. **Economic calendar feed** — which provider, and whether its licence permits
   redisplay. Affects Phase 6 and the Dashboard news ticker.
3. **Auth provider** — the spec documents Clerk; this repo uses Supabase Auth with RLS.
   Recommendation: stay on Supabase Auth. Awaiting confirmation.
4. **Scope of Community and Billing** — both add permanent operational and moderation
   burden. Confirm whether this stays a personal journal or becomes a multi-tenant SaaS.
5. **Analysis account scoping** — the live app appears to show all accounts' trades on the
   Analysis page regardless of the active account. Decide: all-accounts or active-account.

---

## Entries

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
