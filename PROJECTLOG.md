# Project Log

Running record of work on the TradeFXBook parity effort.
Newest entries at the top. See `docs/README.md` for the phase plan.

**Legend:** ✅ done · 🚧 in progress · ⛔ blocked · ⏸ not started

---

## Phase status at a glance

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: routing, shell/nav, top bar, schema superset, filterable stats core | ⏸ Not started |
| 1 | Analysis module to full spec (filters, 9 widgets, ~30-metric stats block) | ⏸ Not started |
| 2 | Tools: Position Size Calculator, Forex Market Hours, tool shell | ⏸ Not started |
| 3 | Journal split-pane + Trades page to spec | ⏸ Not started |
| 4 | Dashboard widgets + Settings tabs & preferences | ⏸ Not started |
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
