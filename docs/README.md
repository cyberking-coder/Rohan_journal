# TradeFXBook Parity — Build Plan

This document turns `TradeFXBook_Product_Specification_v2.pdf` into a phased,
buildable plan for **this repository** (Rohan_journal / Forex Greek Journal).

- **Spec source:** TradeFXBook Product Specification v2 (24 pages) — full-app
  overview + exhaustive dev specs for the **Analysis** and **Tools** modules.
- **Target repo today:** React 18 + Vite SPA, Supabase (auth + Postgres + storage),
  Recharts, Framer Motion, deployed on Vercel, with a Python `mt5_bridge/` sync script.
- **Status:** planning only. No feature code has been written for this plan yet.

---

## 1. Is it possible?

**Yes — the full spec is implementable in this repo, but it is not a small job.**
The honest breakdown:

| Spec area | Feasible here? | Notes |
| --- | --- | --- |
| Dashboard, Trades, Journal, Analysis | **Yes, mostly extension** | We already have Dashboard/Journal/Analysis pages, a stats engine (`src/lib/stats.js`), equity curve, heatmap calendar and session performance. The spec mainly adds *more* widgets and *more* metrics on top of what exists. |
| Tools (Position Size Calculator, Forex Market Hours) | **Yes, easy** | Both are stateless. Formulas are fully specified in the PDF and verified against the live app. `src/lib/instruments.js` already holds instrument config we can extend with `pip_size` / `pip_value_per_lot`. |
| Settings (profile, prefs, timezone, streamer mode) | **Yes, easy–medium** | Pure app state + a `profiles` table in Supabase. |
| Economic Calendar (Market) | **Yes, with a caveat** | Needs a third-party calendar data feed. Free feeds are scrapey/rate-limited; a paid feed or a scheduled scraper into Supabase is required. |
| AI Report | **Yes** | Serialize trades+journal → Claude/OpenAI → store report. Needs a server-side function (Supabase Edge Function or a small API route) to keep the API key secret, plus a weekly quota table. |
| Backtesting (candle replay) | **Yes, but the biggest build** | Needs a historical OHLC data source and a replay engine. Effectively its own sub-project. |
| Community (lounges, chat, leaderboard, affiliate) | **Yes** | Supabase Realtime covers chat. Moderation and abuse handling are real, ongoing costs — worth deciding if this is actually wanted. |
| Trader POV (shared read-only dashboards) | **Yes** | Share-code table + read-only rendering of existing components. Depends on the other modules existing first. |
| Broker / prop-firm auto-sync (MT4/MT5, FundingPips, FortressFX) | **Yes, hardest and riskiest** | We already have `mt5_bridge/sync.py`, but it requires a Windows machine running MetaTrader5. Cloud-native parity means MetaApi.cloud (paid) or a hosted EA+webhook bridge. **This is the one item that cannot be fully solved with code in this repo alone** — it needs an infrastructure/vendor decision. |
| Billing (Free/Pro/Elite via Stripe) | **Yes** | Standard Stripe subscriptions + feature flags. Requires a real Stripe account and business setup. |
| Auth (Clerk in the spec) | **Yes — but recommend NOT switching** | We already use Supabase Auth with Google OAuth and Row Level Security. Migrating to Clerk buys passkeys and little else, and would break RLS. Recommendation: **keep Supabase Auth**, add passkeys/2FA later if needed. |

### The three things to decide before Phase 5+
1. **Broker sync vendor** — MetaApi.cloud vs. self-hosted EA bridge vs. keeping the
   current manual Windows script. Costs money either way.
2. **Economic calendar data feed** — which provider, and its licensing.
3. **Whether Community and Billing are actually in scope**, or whether this stays a
   single-user personal journal. Both add permanent operational burden.

Everything else can proceed without blocking on those answers.

---

## 2. Phase plan

Phases are ordered so each one ships something usable on its own, and so the
cheap high-value work lands before the expensive infrastructure work.

### Phase 0 — Foundation & housekeeping ✅ **Done**
*Goal: make the repo ready to grow from 3 pages to 10.*
- ✅ Real routing (`?view=<section>` query params, matching the spec's URL scheme) — `src/lib/router.js`, `src/lib/views.js`.
- ✅ `Shell` sidebar with all 10 nav entries; unbuilt ones route to a "coming soon" screen naming their phase.
- ✅ Global top bar: search (⌘K), theme toggle, quick-add (+), live clock, notifications bell, profile menu.
- ✅ Light/dark theming with a full light palette; all previously hardcoded colours tokenised.
- ✅ Filterable analytics core accepting `{ period, tradeType }` — `src/lib/analytics.js`, covered by `npm test`.
- ✅ `trades` schema superset — `supabase/phase0.sql`. Note: `fees` remains the commission column rather than adding a duplicate `commission` field, since every existing writer already uses it.

### Phase 1 — Analysis module to full spec ✅ **Done**
*Goal: the single most detailed part of the PDF (§0–§12 of the Analysis dev spec).*
- ✅ Filter bar: 6 period tabs (Today / 7D / 30D / 3M / 1Y / All) × 3 trade-type pills (All / Winners / Losers).
- ✅ 4 stat cards: Total P&L, Win Rate, Profit Factor (+ qualitative label lookup), Expectancy.
- ✅ Equity Curve with **Equity / Drawdown** toggle + the 8-metric strip beneath it.
- ✅ Win/Loss Distribution, Long vs Short, Day-of-Week Performance, Top Symbols.
- ✅ Session Performance: live 24h timeline with a "NOW" marker + 3 session cards (Asian 22–08, London 08–13, NY 13–22 UTC).
- ✅ Trading Calendar heatmap with the 8th "Weekly" rollup column + clickable Day Detail panel.
- ✅ "Your Stats" block: monthly best/worst/average + the ~30-metric two-column grid.
- ✅ Fixed the spec's noted bug: implement **Max Drawdown %** properly (`max_drawdown / peak_equity_before_drawdown × 100`), don't clone the live app's `0%`. Shows a dash, not 0%, when equity never rose above its starting point — there is no peak to divide by.

### Phase 2 — Tools module ✅ **Done**
*Goal: fully specified, stateless, fast wins.*
- ✅ `<ToolPageShell>` wrapper + config-driven tool grid with Popular/Live/Coming-Soon badges — `src/lib/tools.js`, `src/pages/Tools.jsx`. Tools open at `?view=tools&tool=<id>`, so each is linkable and the back button returns to the grid.
- ✅ **Position Size Calculator** — `position_size = (balance × risk%) / (sl_pips × pip_value_per_lot)`; risk slider 0.5–5% with presets and Conservative/Moderate/Aggressive zones; standard/mini/micro lot outputs; 32-instrument dropdown (deduped — the live app lists BTCUSD/ETHUSD twice); custom pip-value override.
- ✅ **Forex Market Hours** — 12h/24h toggle, live "now" line, 4 city sessions (Sydney/Tokyo/London/NY), weekend handling, volume heuristic, "Best Times to Trade" cards rendered in the viewer's timezone.
- ✅ Instrument pip config — `src/lib/pips.js`, kept separate from `instruments.js` (contract sizes for P&L) since it answers a different question. Rate-dependent pairs are marked approximate rather than presenting a stale number as fact.

### Phase 3 — Journal & Trades to spec ✅ **Done**
- ✅ Journal split-pane: left list (All / Journaled / Pending tabs with counts, search, date filter, sort, NEW badges) + right detail pane with a completeness meter.
- ✅ The 5 structured journal fields: Pre-Trade Analysis, Post-Trade Review, Emotions, Lessons Learned, plus planned R:R (two inputs) and a 1–10 rating slider — `supabase/phase3.sql`, `src/lib/journal.js`.
- ✅ Trades page: account switcher with privacy eye-toggle, Clear All (typed confirmation), full history table, copy-trade-summary action, synced trades non-deletable — `src/pages/Trades.jsx`, `src/lib/accounts.js`.
- ⏸ Sync / Disconnect are shown disabled: they need the broker bridge from phase 5. Sharing to a public URL is phase 9 (Trader POV); copying a trade summary is the part that can be built honestly today.

### Phase 4 — Dashboard & Settings ✅ **Done**
- ✅ Dashboard: 4 headline cards (Total P&L / Unrealized / Realized / Win Rate), period tabs (1D/1W/1M/3M/ALL), direction-coloured performance chart, monthly P&L strip.
- ✅ Settings tab strip: Profile / MT5-MT4 / Settings / Billing / Security, deep-linkable at `?view=settings&tab=<key>`.
- ✅ Preferences: profile visibility, dark mode, **Streamer Mode**, currency display, 76-zone timezone picker, dismissed-notifications restore, Danger Zone — `src/lib/theme.jsx`, `src/lib/format.js`, `supabase/phase4.sql`.
- ⏸ The news ticker renders its chrome with an honest empty state: the events need the phase 6 calendar feed, and inventing headlines on a trading app would be actively dangerous. Notification toggles are disabled because nothing can deliver them until phases 5/7. Billing is empty because there are no paid tiers (phase 11).

### Phase 5 — Broker accounts & sync 🟡 **Done except the vendor-gated part**
- ✅ `broker_accounts` table with RLS, and a real foreign key from `trades` (ON DELETE SET NULL, so removing an account never deletes its history) — `supabase/phase5.sql`.
- ✅ Multi-account per user: add / edit / favourite / disconnect / remove, per-account P&L, trades, win rate, open positions and last-sync — `src/components/BrokerAccounts.jsx`, `src/lib/brokerAccounts.js`.
- ✅ Live sync status derived from real timestamps: connected / idle / stale / never synced / error / disconnected. A stale bridge is visible instead of silently letting the journal drift.
- ✅ `mt5_bridge/sync.py` registers its own account, stamps `broker_account_id` on every imported trade, and records success or failure so the app can show it.
- ✅ Trades logged before this phase still appear, grouped by `source` as "not registered" accounts, so nothing goes missing from the switcher.
- ⛔ **Not built, deliberately:** credential storage and cloud-side sync. See the security note below.

**Why credentials are not stored.** The spec describes storing read-only investor
passwords. This app is a browser SPA talking straight to Supabase: any column the
client can read is one that XSS, a malicious extension, or whoever picks up the
laptop can read too. Storing live broker credentials there turns a journal into a
way to lose an account. Doing it safely needs a server the browser cannot read
from — an Edge Function or hosted bridge holding the secret, written once and
never returned — which is exactly the vendor decision still open. Until then,
sync runs from `mt5_bridge/` on the user's own machine, attached to a terminal
they already logged into, and no password is transmitted or stored anywhere.

### Phase 6 — Economic Calendar (Market) ✅ **Done**
- ✅ `economic_events` table, read-only from the browser by design — a client that could write here could feed every user false economic data. `supabase/phase6.sql`.
- ✅ Market page: day tabs (Upcoming / Today / Tomorrow / This Week / All), impact filters, country filter, search, event counts, live countdowns, NEXT UP badge, expandable rows with beat/miss against forecast.
- ✅ Day boundaries computed in the user's timezone, not the browser's — otherwise "Today" shows the wrong day for anyone far enough east or west.
- ✅ Dashboard ticker shows real high and medium impact releases once populated.
- ✅ `calendar_bridge/import_events.py` — provider-agnostic importer taking a JSON file or a small adapter, with idempotent upserts.
- ✅ Feed chosen: the Apify actor `pintostudio/economic-calendar-data-investing-com`. `calendar_bridge/apify_investing.py`, registered as `--provider apify`. The file-based and adapter seams are unchanged, so swapping providers later is still one small file.
- ⚠️ `APIFY_CALENDAR_TZ` must match the zone the actor publishes its clock times in. Nothing is guessed — records with a real offset use it, bare clocks are read in that zone, and records with neither are rejected and reported. Check one known release after the first import.

### Phase 7 — AI Report ✅ **Done** (needs a key to run)
- ✅ `ai_reports` table with RLS that allows **select and delete only** — no client insert. `supabase/phase7.sql`.
- ✅ `supabase/functions/generate-report/` — Supabase Edge Function holding the Anthropic key, verifying the caller's JWT, counting the week's usage against the database, calling `claude-opus-5` with adaptive thinking and a strict JSON schema, and writing the row.
- ✅ Weekly quota of 3, bucketed to Monday 00:00 UTC, with the reset timer drawn from the same week-boundary rule the function enforces.
- ✅ AI Report page: featured latest report, expandable archive of earlier ones, per-section tone (strength / watch / fix), delete with confirm, and honest empty/setup states.
- ✅ The prompt is given the journal notes, not just P&L — a review written from numbers alone just restates the dashboard.
- ⚠️ **Requires an Anthropic API key** set as a function secret. Without it the page explains the two setup steps rather than offering a button that can't work. This is a cost decision for whoever runs the app, not a code gap.

### Phase 8 — Backtesting
- Session CRUD + empty state.
- Historical OHLC source, candle-replay UI, simulated orders with SL/TP.
- Reuse the Phase 1 analytics engine to score results.

### Phase 9 — Trader POV & sharing
- `shared_dashboards` table: `{ id, owner_user_id, code, account_scope, sections_enabled[], created_at, expires_at, revoked }`.
- `VIEW-XXXXXX` code generation and redemption; View/Share toggle.
- Read-only rendering of Overview / Trades / Performance / Trade Analysis / Journal / AI Reports.

### Phase 10 — Community *(optional — confirm scope first)*
- Realtime lounges, member counts, affiliate code redemption, leaderboard, share cards.

### Phase 11 — Billing & Security *(optional — confirm scope first)*
- Stripe Free/Pro/Elite tiers, tier-gated feature flags, password/2FA management, active session list, account deletion.

---

## 3. Recommended sequencing

Phases **0 → 1 → 2 → 3 → 4** are self-contained, need no vendors, and take the app
from "personal journal" to "most of TradeFXBook's day-to-day surface". Do those first.

Phases **5 and 6** are gated on paid external services. Start the vendor evaluation
in parallel with Phase 1 so it isn't the thing that stalls the project.

Phases **7 → 11** are best treated as separate projects, each scoped when the ones
before it are actually in use.

---

## 4. Files in this plan

- `docs/README.md` — this plan.
- `PROJECTLOG.md` — running log of what has actually been done, updated as work lands.
