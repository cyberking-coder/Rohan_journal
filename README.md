# Forex Greek Journal — Premium Trading Journal

A dark, premium trading journal for forex, metals, indices and crypto traders.
Log trades manually, review your edge on an animated dashboard, and get
data-driven coaching on where you're winning and where you're leaking money.

Built with **React + Vite**, **Supabase** (auth + database + storage),
**Framer Motion** animations, and **Recharts**. Deployed on **Vercel**.

- **Live:** https://rohan-journal.vercel.app
- **Sections:** Dashboard · Journal · Analysis
- **Login:** Google (Supabase Auth) — every trader sees only their own data

---

## Table of contents

1. [What the app does](#what-the-app-does)
2. [How the numbers are calculated](#how-the-numbers-are-calculated)
3. [The three sections in detail](#the-three-sections-in-detail)
4. [Tech & architecture](#tech--architecture)
5. [Project structure](#project-structure)
6. [Local development](#local-development)
7. [Supabase setup (database, auth, storage)](#supabase-setup)
8. [Deploying on Vercel](#deploying-on-vercel)
9. [Design system](#design-system)

---

## What the app does

- **Manual trade logging** through a rich modal: asset, side, strategy, session,
  entry, stop loss, take profit, exit, lots, contract size, R:R, P&L, commission,
  1–5★ rating, notes, and a **chart screenshot**.
- **Automatic P&L** from price × lots × contract size (proper Gold/FX lot math).
- **Automatic R:R** from entry / stop loss / take profit.
- **Dashboard** with equity curve, heatmap calendar, session performance, and a
  one-glance "top insight" banner.
- **Analysis** with per-timeframe, per-strategy deep dives and plain-language
  **coaching insights** (what to keep doing, do more of, and where to improve),
  plus your biggest win and biggest loss.
- **Secure per-user data** — Google login; Row Level Security means each account
  only ever reads/writes its own trades.
- **Demo mode** — with no Supabase configured, the app runs on generated demo
  data stored in the browser, so the whole UI is explorable instantly.

---

## How the numbers are calculated

### Net P&L (auto)
```
move  = side === 'Long' ? (exit − entry) : (entry − exit)
P&L   = move × lots × contractSize
Net   = P&L − commission
```
**Contract size** is auto-detected from the asset (editable for anything custom):

| Instrument            | Contract size | 1.0 lot, $1 move |
| --------------------- | ------------- | ---------------- |
| Gold (XAUUSD)         | 100           | $100             |
| Silver (XAGUSD)       | 5,000         | $5,000           |
| FX majors/crosses     | 100,000       | $10 / pip        |
| Indices / Crypto      | 1             | $1               |

Example — Gold, 0.10 lot, 2000 → 2006: `6 × 0.10 × 100 = $60`.
The form shows the live breakdown: `0.10 lot × +6.00 move × 100 = $60.00`.

### Risk : Reward (auto)
```
risk   = |entry − stopLoss|
reward = |takeProfit − entry|
R:R    = reward ÷ risk        → displayed as 1:X   (e.g. 1:2, 1:3)
```
You can type R:R manually (`1:2.5`) or let it auto-fill from SL/TP. Stop loss and
take profit are entry aids that drive R:R; the resulting ratio is what's stored.

### Portfolio stats
Win rate, profit factor (gross win ÷ gross loss), expectancy (net ÷ trades),
average win/loss, average R:R, and average rating — all computed client-side and
re-sliced by the active timeframe (This Week / 1 Month / 3 Months / All Time).

---

## The three sections in detail

### 📊 Dashboard
- **Stat row:** Total Gross, Total Net, Expectancy/trade, Commissions.
- **Top Insight banner:** your single strongest edge ($ badge) and biggest leak
  (! badge) for the selected range.
- **Win-rate gauge**, **Risk/Reward + Profit-Factor** hexes, and a Wins×Losses
  panel (avg win/loss, best/worst, rating).
- **Equity curve** (net vs gross) and a **30-day P&L** histogram.
- **Performance heatmap calendar** (green/red per-day P&L) and **session
  performance** bars.

### 📒 Journal
- Searchable, side-filterable table of every trade.
- Columns: date, symbol, side, strategy, session, R:R, rating, chart thumbnail
  (click for lightbox), net P&L, delete.
- Add trades from here, the dashboard, or the sidebar.

### 🔍 Analysis
- **Timeframe tabs** + **strategy filter** (scope the whole page to one setup).
- **Coaching Insights** — three columns generated from your trades:
  - **Keep doing** — positive expectancy, strong profit factor, R:R discipline.
  - **Do more of** — best strategy, session, instrument, and day of week.
  - **Where to improve** — losing strategy/session/symbol/day, and flags like
    "your average loss is bigger than your average win."
- **Biggest Win** and **Biggest Loss** cards with full trade context + screenshot.
- Session performance, trade-rating distribution, and P&L breakdowns by strategy
  and by symbol.

---

## Tech & architecture

| Layer        | Choice                                             |
| ------------ | -------------------------------------------------- |
| Frontend     | React 18 + Vite                                    |
| Animation    | Framer Motion                                      |
| Charts       | Recharts                                           |
| Auth         | Supabase Auth (Google OAuth)                       |
| Database     | Supabase Postgres + Row Level Security             |
| File storage | Supabase Storage (public `screenshots` bucket)     |
| Hosting      | Vercel (static SPA, served at root)                |

**Data flow:** `AuthContext` manages the Supabase session; `useTrades(userId)`
does all CRUD; every trade is stamped with `user_id` and RLS scopes reads/writes.
If Supabase env vars are absent the same hooks fall back to browser-local demo
data, so nothing breaks in development.

---

## Project structure

```
src/
  components/
    Shell.jsx           sidebar, nav, user card + sign-out, logo
    TradeForm.jsx       add-trade modal (auto P&L, auto R:R, screenshot upload)
    TradeTable.jsx      journal table + screenshot lightbox
    HeatmapCalendar.jsx per-day P&L heatmap
    charts.jsx          equity curve, P&L bars, session bars
    widgets.jsx         stat cards, gauge, hex stats, star rating
    common.jsx          page header, range tabs, panels
  lib/
    supabase.js         Supabase client (+ isConfigured flag)
    AuthContext.jsx     session, signInWithGoogle, signOut
    useTrades.js        fetch/add/delete trades (Supabase or demo fallback)
    stats.js            all analytics: stats, insights, R:R & money formatting
    instruments.js      asset list, strategies, contract sizes, P&L calc
    storage.js          screenshot upload to Supabase Storage
    cardGlow.js         cursor-tracking hover glow
    demo.js             generated demo trades for no-Supabase mode
  pages/
    Dashboard.jsx  Journal.jsx  Analysis.jsx  Login.jsx
  styles/global.css     design tokens + card/glow styles
supabase/
  schema.sql            trades table + per-user RLS policies
  storage.sql           screenshots bucket + policies
  enable-auth.sql       switch from public policy to per-user RLS
  migrate-numeric.sql   widen qty/rr to numeric on existing tables
vercel.json             Vite framework + SPA rewrites
```

---

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

With no `.env`, the app runs on demo data. To connect a real database, copy
`.env.example` to `.env` and fill in your Supabase URL + publishable key.

---

## Supabase setup

### 1. Create the database
In the Supabase **SQL Editor**, run in this order:
1. `supabase/schema.sql` — creates the `trades` table and per-user RLS policies.
2. `supabase/storage.sql` — creates the public `screenshots` bucket + policies.

If you created the table before the lots/screenshot changes, also run
`supabase/migrate-numeric.sql` (widens `qty`/`rr` to numeric, adds
`screenshot_url`).

### 2. Enable Google login
1. **Google Cloud Console → Credentials → OAuth client (Web)**. Add authorized
   redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Supabase → Authentication → Providers → Google:** enable, paste the Google
   Client ID + Secret.
3. **Supabase → Authentication → URL Configuration:**
   - **Site URL:** `https://rohan-journal.vercel.app`
   - **Redirect URLs:** `https://rohan-journal.vercel.app` and
     `https://rohan-journal.vercel.app/**`

> Getting a Supabase "your train has not arrived" page after login means the app
> URL isn't in Site URL / Redirect URLs above — add it and retry.

### 3. Keys
Grab the **Project URL** and **publishable** key from **Settings → API** (the
publishable `sb_publishable_...` key is safe for the browser; never ship a
`sb_secret_...` key).

---

## Deploying on Vercel

The repo includes `vercel.json` (framework `vite`, output `dist`, SPA rewrites).

1. **Vercel → Add New → Project →** import the repo, branch **`main`**.
2. **Settings → Environment Variables** — add, then **redeploy**:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```
   These are inlined at **build time**, so a redeploy is required after adding.
3. Add the Vercel domain to Supabase URL Configuration (see above) so Google
   login redirects back correctly.

> Any new domain (e.g. a custom domain) must be added to **both** Vercel and the
> Supabase Site URL / Redirect URLs list.

---

## Design system

- **Palette:** near-black charcoal (`#0a0d0c`) with a mint-green accent
  (`#2fd48a`), red for losses, amber for warnings.
- **Fonts:** Sora (display), Inter (body), JetBrains Mono (numbers).
- **Motion:** staggered card reveals, animated gauge/curve, spring modal, and a
  cursor-tracking mint spotlight on every card.
- **Responsive:** sidebar collapses and grids stack on small screens.

---

Built with care for traders who want to actually understand their edge. 📈
