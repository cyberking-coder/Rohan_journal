#!/usr/bin/env node
// One-shot: create the product and the four subscription plans in PayPal,
// then print the ids to paste into Supabase secrets.
//
// Usage:
//   PAYPAL_ENV=sandbox \
//   PAYPAL_CLIENT_ID=... \
//   PAYPAL_SECRET=... \
//   node scripts/create-paypal-plans.mjs
//
// PAYPAL_ENV=sandbox by default; set to 'live' when you're ready to launch,
// with your Live client id/secret.

const env = process.env.PAYPAL_ENV || 'sandbox'
const clientId = process.env.PAYPAL_CLIENT_ID
const secret = process.env.PAYPAL_SECRET
if (!clientId || !secret) {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_SECRET before running this.')
  process.exit(1)
}

const base = env === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

const PLANS = [
  { name: 'Pro Monthly',   envKey: 'PRO_MONTHLY',   interval: 'MONTH', freq: 1, price: '12.99'  },
  { name: 'Pro Yearly',    envKey: 'PRO_YEARLY',    interval: 'YEAR',  freq: 1, price: '131.88' },
  { name: 'Elite Monthly', envKey: 'ELITE_MONTHLY', interval: 'MONTH', freq: 1, price: '22.99'  },
  { name: 'Elite Yearly',  envKey: 'ELITE_YEARLY',  interval: 'YEAR',  freq: 1, price: '239.88' },
]

const token = await getToken()
const productId = await createProduct(token)
console.log(`Product: ${productId}`)

const results = []
for (const p of PLANS) {
  const id = await createPlan(token, productId, p)
  results.push({ ...p, id })
  console.log(`  ${p.name}: ${id}`)
}

console.log('\n──────────── Paste into Supabase Edge Function secrets ────────────')
for (const r of results) {
  console.log(`PAYPAL_PLAN_${r.envKey}=${r.id}`)
}

async function getToken() {
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`auth ${r.status} ${JSON.stringify(j)}`)
  return j.access_token
}

async function createProduct(token) {
  const r = await fetch(`${base}/v1/catalogs/products`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Forex Greek Journal',
      description: 'Premium trading journal subscription',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`product ${r.status} ${JSON.stringify(j)}`)
  return j.id
}

async function createPlan(token, productId, { name, interval, freq, price }) {
  const r = await fetch(`${base}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      product_id: productId,
      name,
      status: 'ACTIVE',
      billing_cycles: [{
        frequency: { interval_unit: interval, interval_count: freq },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: price, currency_code: 'USD' } },
      }],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee: { value: '0', currency_code: 'USD' },
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`plan ${name}: ${r.status} ${JSON.stringify(j)}`)
  return j.id
}
