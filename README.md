# Forex Greek Journal — Premium Trading Journal

A dark, premium trading journal with a mint-on-charcoal design language, smooth
animations, and Supabase-backed persistence. Track trades manually, review your
edge on the dashboard, and slice performance across timeframes.

![sections](https://img.shields.io/badge/sections-Dashboard%20·%20Journal%20·%20Analysis-2fd48a)

## Features

- **Dashboard** — gross/net P&L, expectancy, win-rate gauge, risk-reward &
  profit-factor hexes, a 30-day P&L histogram, an animated **equity curve**
  (net vs gross), a **performance heatmap calendar**, and **session performance**.
  Time-range switcher: *This Week · 1 Month · 3 Months · All Time*.
- **Journal** — searchable, filterable trade table. Add trades from here or from
  the dashboard/sidebar. Delete with one click.
- **Analysis** — deep-dive per timeframe: session performance, trade-rating
  distribution, and P&L breakdowns by strategy and by symbol.
- **Manual entry** — rich modal form (symbol, side, strategy, session, entry/exit,
  qty, R:R, P&L, fees, 1–5 star rating, notes).
- **Supabase** — real persistence when configured; falls back to local demo data
  so the UI is fully explorable out of the box.
- Premium fonts (Sora / Inter / JetBrains Mono), Framer Motion animations.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173. With no configuration it runs on generated demo data
stored in your browser.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql).
   - For a quick no-auth start, uncomment the "public access" policy block.
3. Copy `.env.example` to `.env` and fill in:

   ```env
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

4. Restart `npm run dev`. The sidebar badge turns green ("Supabase connected")
   and all reads/writes go to your database.

## Deploy on Railway

The repo is Railway-ready. Railway builds with Nixpacks and serves the static
`dist/` build via [`serve`](https://www.npmjs.com/package/serve).

1. In Railway: **New Project → Deploy from GitHub repo →** select
   `cyberking-coder/rohan_journal` (branch `main`).
2. Railway auto-detects the config in [`railway.json`](railway.json):
   - Build: `npm run build`
   - Start: `npm start` → `serve -s dist -l $PORT`
3. (Optional) Add your Supabase keys under **Variables**:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These are read at
   **build time**, so trigger a redeploy after setting them.
4. Under **Settings → Networking**, click **Generate Domain** to get a public URL.

The app is served at the domain root (`/`), so no base-path config is needed —
`vite.config.js` only switches to the `/rohan_journal/` sub-path when
`DEPLOY_TARGET=gh-pages` (used by the optional GitHub Pages workflow).

> Note: `serve -s` handles SPA routing (any path falls back to `index.html`).

## Deploy on GitHub Pages (optional)

A workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
builds with `DEPLOY_TARGET=gh-pages` and publishes to Pages. Enable
**Settings → Pages → Source: GitHub Actions** and allow `main` under the
`github-pages` environment's deployment branches.

## Tech stack

React + Vite · Framer Motion · Recharts · Supabase JS.

## Project structure

```
src/
  components/   Shell, widgets, charts, heatmap, trade form & table
  lib/          supabase client, useTrades store, stats/analytics, demo data
  pages/        Dashboard, Journal, Analysis
  styles/       global design tokens
supabase/
  schema.sql    trades table + RLS policies
```
