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

### Phase 0 — Foundation & housekeeping
*Goal: make the repo ready to grow from 3 pages to 10.*
- Introduce real routing (`?view=<section>` query-param routing, matching the spec's URL scheme).
- Extract a `Shell` sidebar with all 10 nav entries (unbuilt ones showing a "Coming soon" state).
- Add the global top bar: search (⌘K), theme toggle, quick-add (+), live clock, notifications bell, profile menu.
- Split `src/lib/stats.js` into a filterable analytics core that accepts `{ period, tradeType }`.
- Extend the `trades` schema with the spec's superset fields: `commission`, `swap`, `status`, `source`, `is_deletable`, `broker_account_id`.

### Phase 1 — Analysis module to full spec
*Goal: the single most detailed part of the PDF (§0–§12 of the Analysis dev spec).*
- Filter bar: 6 period tabs (Today / 7D / 30D / 3M / 1Y / All) × 3 trade-type pills (All / Winners / Losers).
- 4 stat cards: Total P&L, Win Rate, Profit Factor (+ qualitative label lookup), Expectancy.
- Equity Curve with **Equity / Drawdown** toggle + the 8-metric strip beneath it.
- Win/Loss Distribution, Long vs Short, Day-of-Week Performance, Top Symbols.
- Session Performance: live 24h timeline with a "NOW" marker + 3 session cards (Asian 22–08, London 08–13, NY 13–22 UTC).
- Trading Calendar heatmap with the 8th "Weekly" rollup column + clickable Day Detail panel.
- "Your Stats" block: monthly best/worst/average + the ~30-metric two-column grid.
- Fix the spec's noted bug: implement **Max Drawdown %** properly (`max_drawdown / peak_equity_before_drawdown × 100`), don't clone the live app's `0%`.

### Phase 2 — Tools module
*Goal: fully specified, stateless, fast wins.*
- `<ToolPageShell>` wrapper + config-driven tool grid with Popular/Live/New/Coming-Soon badges.
- **Position Size Calculator** — `position_size = (balance × risk%) / (sl_pips × pip_value_per_lot)`; risk slider 0.5–5% with presets; standard/mini/micro lot outputs; ~33-instrument dropdown (deduped — the live app lists BTCUSD/ETHUSD twice).
- **Forex Market Hours** — 12h/24h toggle, live "now" line, 4 city sessions (Sydney/Tokyo/London/NY), volume heuristic lookup, "Best Times to Trade" reference cards rendered in the user's timezone.
- Extend `src/lib/instruments.js` into a full `Instrument { symbol, category, pip_size, pip_value_per_lot, icon_url }` config.

### Phase 3 — Journal & Trades to spec
- Journal split-pane: left list (All / Journaled / Pending tabs with counts, search, date filter, sort, NEW badges) + right detail pane.
- The 5 structured journal fields: Pre-Trade Analysis, Post-Trade Review, Emotions, Lessons Learned, plus planned R:R (two inputs) and a 1–10 rating slider.
- Trades page: account switcher pill with privacy eye-toggle, Sync / Disconnect / Clear All / Add Trade actions, full history table, share-trade action, synced trades non-deletable.

### Phase 4 — Dashboard & Settings
- Dashboard: 4 stat cards (Total / Unrealized / Realized / Win Rate), period-tabbed performance chart, monthly P&L strip, bottom news ticker.
- Settings tab strip: Profile / MT5-MT4 / Settings / Billing / Security.
- Preferences: profile visibility, dark mode, **Streamer Mode** (blur $ values), notification toggles, currency display, ~70-zone timezone picker, dismissed-notifications restore, Danger Zone (clear all trading data).

### Phase 5 — Broker accounts & sync *(blocked on a vendor decision)*
- `broker_accounts` table; multi-account per user; connect / disconnect / sync / favourite / duplicate.
- Per-account summary strip (P&L, trades, win rate, open positions).
- Read-only investor-password credentials, encrypted at rest. **Never** store credentials that can place trades.
- Evaluate MetaApi.cloud vs. extending `mt5_bridge/` into a hosted service.

### Phase 6 — Economic Calendar (Market) *(blocked on a data feed decision)*
- Ingest a calendar feed on a schedule into Supabase.
- Day tabs, impact filters, country filter, search, event counts, countdown timers, timezone-aware rendering.
- Reuse the same data for the Dashboard news ticker.

### Phase 7 — AI Report
- Server-side generation function (keeps the API key off the client).
- Prompt over trade + journal history → punchy title + structured report.
- Weekly per-user quota with a visible reset timer; report archive with expandable history.

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
