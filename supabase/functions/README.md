# Edge Functions

Deployed with the Supabase CLI:

```bash
supabase functions deploy broker-connect
supabase functions deploy broker-disconnect
supabase functions deploy create-checkout-session
supabase functions deploy create-billing-portal
supabase functions deploy stripe-webhook --no-verify-jwt
```

`stripe-webhook` **must** be deployed with `--no-verify-jwt` because Stripe
posts to it without a Supabase session — the Stripe-Signature header is
verified inside the function against `STRIPE_WEBHOOK_SECRET` instead.

## Stripe setup

1. Sign up at <https://dashboard.stripe.com>.
2. Create products with two prices each (monthly and yearly):
   | Product | Monthly | Yearly |
   | --- | --- | --- |
   | Pro   | $12.99 | $10.99 |
   | Elite | $22.99 | $19.99 |
3. Copy the four price IDs (they look like `price_1P…`).
4. Create a webhook endpoint pointing at
   `https://<project>.functions.supabase.co/stripe-webhook`
   subscribed to:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy the signing secret (starts with `whsec_`).

## Required secrets

Set on the Supabase project (Project Settings → Edge Functions → Secrets):

| Name | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_…` or `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Endpoint signing secret (`whsec_…`) |
| `STRIPE_PRICE_PRO_MONTHLY` | Stripe price id |
| `STRIPE_PRICE_PRO_YEARLY` | Stripe price id |
| `STRIPE_PRICE_ELITE_MONTHLY` | Stripe price id |
| `STRIPE_PRICE_ELITE_YEARLY` | Stripe price id |
| `APP_URL` | The site URL Stripe redirects back to (`https://rohan-journal.vercel.app`) |
| `METAAPI_TOKEN` / `METAAPI_ENCRYPTION_KEY` / `METAAPI_REGION` | MetaApi.cloud integration |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions
automatically.

## Local testing with the Stripe CLI

```bash
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
stripe trigger checkout.session.completed
```
