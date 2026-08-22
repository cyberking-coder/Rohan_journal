# Master PRD — gap analysis

Mapping the Master PRD onto what this repo actually contains, so the remaining
work is a list rather than a re-read of 3,203 lines.

Status key: **built** = shipped and tested · **partial** = exists but narrower
than the PRD asks · **missing** = nothing in the repo.

## Already built

| PRD | Feature | Where |
|---|---|---|
| §16 | Trade data model | `supabase/schema.sql`, `phase0.sql` |
| §24 | CSV import fallback | `src/lib/backtest.js` `parseCandles` |
| §25–30 | Journal, analytics, calendar, filters | `src/pages/{Journal,Analysis,Market}.jsx` |
| §41 | OHLC validation | `parseCandles` rejects malformed bars |
| §42 | UTC internally | `analytics.js`, `mt5_bridge/export_candles.py` |
| §49–51 | Replay engine, controls, MVP order types | `src/lib/backtest.js`, `src/pages/Backtesting.jsx` |
| §60 | Look-ahead protection | `replay()` never reads beyond the cursor |
| §79 | Multi-account | `broker_accounts`, `src/lib/useBrokerAccounts.js` |
| §82 | Security / RLS | every `supabase/*.sql`, `docs/SECURITY.md` |
| §92 | Economic calendar | `phase6.sql`, `calendar_bridge/` |
| §93 | AI analytics | `phase7.sql`, `supabase/functions/generate-report/` |
| §106 | Security test suite | `supabase/security_test.sql` (61 checks) |

## Gaps, in the order they are worth building

1. **§31–32 Funded Account module** — *now built, see `supabase/funded.sql`.*
   Prop-firm rule tracking: profit target, daily loss limit, max loss, minimum
   trading days, consistency rule, ACTIVE/PASSED/FAILED.
2. **§27 Tags** — *now built, see `supabase/tags.sql` and `src/lib/tags.js`.*
   ICT/SMC concept tags plus mistake tags, filterable on Analysis, with
   per-tag performance and a standing figure for what mistakes have cost.
3. **§43 Configurable session engine** — *now built, see
   `src/lib/sessionConfig.js`.* Presets (classic, four-way, ICT kill zones)
   plus a full editor, in two modes: partitions that tile the day, and
   overlapping named windows.
4. **§53 Execution model** — *now built, see `src/lib/execution.js`.* Spread,
   commission, slippage and swap, with a breakdown showing where the money
   went and a flag when costs turn a winner into a loser.
5. **§67 Backtest-vs-live comparison** — *now built, see
   `src/lib/comparison.js`.* Saved replay sessions compared against live
   trades on the same symbol, with the divergence diagnosed rather than
   merely tabulated, and every claim carrying how much evidence it rests on.
6. **§55–59 ICT/SMC engines** — *now built, see `src/lib/ict.js`.* Swings,
   FVGs with fill/invalidation, equal highs/lows, PDH/PDL, sweeps vs breaks,
   BOS/CHOCH, premium/discount, and HTF bias from closed candles only. The
   §60 look-ahead rule is verified structurally by the test suite rather than
   asserted in a comment.
7. **§34–40 Market-data architecture** — 1-minute canonical bars, Parquet, R2,
   a provider abstraction, an `instruments` table and symbol mapping.
8. **§83 privacy (export + delete)** — *now built, see `src/lib/privacy.js`.*
   Full export, plus scoped deletions for trades, journal, backtests and the
   whole account.
9. **§84 billing** — *entitlements built, see `src/lib/plans.js`.* Tiers,
   limits, upgrade prompts and downgrade impact. Payment collection is NOT
   wired: that needs a Stripe account and a legal entity, and should be a
   deliberate step rather than a side effect.
10. **§71 Worker/queue system**, **§86 admin** — needed before selling, not
    needed to use the app.
9. **cTrader** — not started.

## Three decisions the PRD forces, which are yours and not mine

**§7 stack.** The PRD mandates Next.js + TypeScript + Tailwind. This app is
Vite + JavaScript + inline styles. My read: TypeScript is the part that would
genuinely pay for itself here — the trade and candle shapes are passed through
a lot of hands. Next.js and Tailwind would be a rewrite that buys a private
dashboard very little. Recommendation: adopt TypeScript incrementally, skip
the other two, and treat §7 as describing a greenfield build rather than this
one.

**§110 rule 10 — "never put massive candle datasets directly into Supabase."**
This contradicts the per-user `candles` table in `phase8.sql`, which is what
makes file-free backtesting work today. Both are right at different scales:
Postgres is fine for one trader's symbols and will not be fine for a thousand.
The migration path is item 7 above; until then the table stays, with a row cap.

**§13, §17–19 — cloud connector with encrypted credentials.** Still the open
hosted-sync decision (MetaApi vs a self-hosted connector fleet vs staying on
the local MT5 bridge). Nothing else in the list is blocked by it, so it should
not hold up the rest.

## Standing constraints from the PRD, restated

- Read-only for connected trading accounts. No order placement, ever.
- Credentials never reach the frontend, local storage, analytics, logs or error
  tracking, and are never written to this database.
- Never assume free market data may be commercially redistributed.
