# Edge Functions

Deployed with the Supabase CLI:

```bash
supabase functions deploy broker-connect
supabase functions deploy broker-disconnect
supabase functions deploy create-subscription
supabase functions deploy cancel-subscription
supabase functions deploy dodo-webhook --no-verify-jwt
```

`dodo-webhook` **must** be deployed with `--no-verify-jwt` — Dodo posts to
it unauthenticated and the request is verified inside the function against
`DODO_WEBHOOK_SECRET` using the Standard Webhooks HMAC-SHA256 scheme.

## Dodo Payments setup

1. Sign up at <https://dodopayments.com>. Complete business verification —
   for India this needs PAN + a bank account; test mode works without it.
2. Dashboard → toggle **Test mode** (top-right) while wiring this up.
3. **Settings → API keys → Create key**. Copy it — starts with `sk_test_…`
   (or `sk_live_…` in Live mode).
4. **Products → New product → Subscription**, one per plan × cycle:

   | Product name | Price | Cycle |
   | --- | --- | --- |
   | Pro Monthly     | $12.99  | Monthly |
   | Pro Yearly      | $131.88 | Yearly  |
   | Elite Monthly   | $22.99  | Monthly |
   | Elite Yearly    | $239.88 | Yearly  |

   Copy each product id (looks like `pdt_...`).
5. **Developers → Webhooks → Add endpoint**:
   - URL: `https://<project>.supabase.co/functions/v1/dodo-webhook`
   - Events: `subscription.active`, `subscription.on_hold`,
     `subscription.paused`, `subscription.cancelled`, `subscription.failed`,
     `subscription.expired`, `subscription.renewed`, `payment.succeeded`.
   - Save, then click the endpoint → **Signing secret** (starts with `whsec_`).

## Required Supabase secrets

Project Settings → Edge Functions → Secrets:

| Name | Purpose |
| --- | --- |
| `DODO_API_KEY`        | Secret key from step 3 |
| `DODO_ENV`            | `test` (default) or `live` |
| `DODO_WEBHOOK_SECRET` | `whsec_…` from step 5 |
| `DODO_PRODUCT_PRO_MONTHLY`   | product id from step 4 |
| `DODO_PRODUCT_PRO_YEARLY`    | product id |
| `DODO_PRODUCT_ELITE_MONTHLY` | product id |
| `DODO_PRODUCT_ELITE_YEARLY`  | product id |
| `APP_URL`             | `https://rohan-journal.vercel.app` |
| `METAAPI_TOKEN` / `METAAPI_ENCRYPTION_KEY` / `METAAPI_REGION` | MetaApi.cloud |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions
automatically.

## Test flow

1. Set `DODO_ENV=test` and the four `sk_test_…` / `pdt_…` values.
2. On the site: Pricing → **Get Started** on Pro. You'll be sent to Dodo's
   hosted checkout.
3. Use a test card from <https://docs.dodopayments.com/testing/test-cards>
   (e.g. `4242 4242 4242 4242`, any future date, any CVC).
4. On approval you're sent back to the app and the webhook records the
   subscription within a second or two.

## Going live

Flip `DODO_ENV=live`, swap in the live API key and live product ids, and add
a webhook endpoint in Live mode too (the test-mode one only fires for test
transactions).
