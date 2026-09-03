#!/usr/bin/env node
// One-shot: create the four subscription products in Dodo Payments and
// print the ids to paste into Supabase secrets.
//
// Usage:
//   DODO_ENV=test DODO_API_KEY=sk_test_... node scripts/create-dodo-products.mjs
//
// DODO_ENV=test by default; set to 'live' with a live key when going live.
//
// If your Dodo account doesn't yet permit product creation via API, create
// the four products by hand in the dashboard (Products → New product →
// Subscription) and paste their ids into Supabase secrets directly — the
// output format at the bottom is what you'd type in.

const env = process.env.DODO_ENV || 'test'
const key = process.env.DODO_API_KEY
if (!key) { console.error('Set DODO_API_KEY before running this.'); process.exit(1) }

const base = env === 'live'
  ? 'https://live.dodopayments.com'
  : 'https://test.dodopayments.com'

const PRODUCTS = [
  { name: 'Pro Monthly',   envKey: 'PRO_MONTHLY',   cents: 1299,  interval: 'Month', count: 1 },
  { name: 'Pro Yearly',    envKey: 'PRO_YEARLY',    cents: 13188, interval: 'Year',  count: 1 },
  { name: 'Elite Monthly', envKey: 'ELITE_MONTHLY', cents: 2299,  interval: 'Month', count: 1 },
  { name: 'Elite Yearly',  envKey: 'ELITE_YEARLY',  cents: 23988, interval: 'Year',  count: 1 },
]

const results = []
for (const p of PRODUCTS) {
  const id = await createProduct(p)
  results.push({ ...p, id })
  console.log(`  ${p.name}: ${id}`)
}

console.log('\n──────────── Paste into Supabase Edge Function secrets ────────────')
for (const r of results) console.log(`DODO_PRODUCT_${r.envKey}=${r.id}`)

async function createProduct({ name, cents, interval, count }) {
  const r = await fetch(`${base}/products`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: `Forex Greek Journal — ${name}`,
      tax_category: 'saas',
      price: {
        type: 'recurring_price',
        currency: 'USD',
        price: cents,
        discount: 0,
        purchasing_power_parity: false,
        pay_what_you_want: false,
        payment_frequency_interval: interval,
        payment_frequency_count: count,
        subscription_period_interval: interval,
        subscription_period_count: count,
        trial_period_days: 0,
      },
    }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${name}: ${r.status} ${JSON.stringify(j)}`)
  return j.product_id ?? j.id
}
