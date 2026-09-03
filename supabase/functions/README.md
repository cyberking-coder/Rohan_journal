# Edge Functions

Deployed with the Supabase CLI:

```bash
supabase functions deploy broker-connect
supabase functions deploy broker-disconnect
supabase functions deploy create-subscription
supabase functions deploy cancel-subscription
supabase functions deploy paypal-webhook --no-verify-jwt
```

`paypal-webhook` **must** be deployed with `--no-verify-jwt` because PayPal
posts to it without a Supabase session — the request is verified by calling
PayPal's `/v1/notifications/verify-webhook-signature` inside the function.

## PayPal setup

1. Create a PayPal Business account at <https://developer.paypal.com>.
2. Under **Apps & Credentials**, create an app. Copy the **Client ID** and
   **Secret** (Sandbox for testing, Live once you go live).
3. Under **Products & Plans** (or via the REST API) create one product and
   four plans:

   | Plan name | Cycle | Price |
   | --- | --- | --- |
   | Pro Monthly     | Monthly | 12.99 USD |
   | Pro Yearly      | Yearly  | 131.88 USD *(equivalent to $10.99/mo)* |
   | Elite Monthly   | Monthly | 22.99 USD |
   | Elite Yearly    | Yearly  | 239.88 USD *(equivalent to $19.99/mo)* |

   Copy each plan's id (looks like `P-XXXXXXXXXXXXXXXX`).
4. Under **Webhooks** on the same app, add an endpoint pointing at
   `https://<project>.functions.supabase.co/paypal-webhook`
   subscribed to:
   `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`,
   `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED`,
   `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`.
   Copy the webhook id (starts with `WH-`).

## Required secrets

Set on the Supabase project (Project Settings → Edge Functions → Secrets):

| Name | Purpose |
| --- | --- |
| `PAYPAL_CLIENT_ID`   | PayPal REST app client id |
| `PAYPAL_SECRET`      | PayPal REST app secret |
| `PAYPAL_ENV`         | `sandbox` (default) or `live` |
| `PAYPAL_WEBHOOK_ID`  | Webhook id from step 4 |
| `PAYPAL_PLAN_PRO_MONTHLY`   | Plan id |
| `PAYPAL_PLAN_PRO_YEARLY`    | Plan id |
| `PAYPAL_PLAN_ELITE_MONTHLY` | Plan id |
| `PAYPAL_PLAN_ELITE_YEARLY`  | Plan id |
| `APP_URL` | The site URL PayPal redirects back to (`https://rohan-journal.vercel.app`) |
| `METAAPI_TOKEN` / `METAAPI_ENCRYPTION_KEY` / `METAAPI_REGION` | MetaApi.cloud integration |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions
automatically.

## Test flow (Sandbox)

1. Set `PAYPAL_ENV=sandbox` and use the Sandbox client id / secret / plan ids.
2. In the app, click **Get Started** on a plan. You'll be redirected to the
   Sandbox approval page.
3. Log in with a sandbox buyer account from your PayPal developer dashboard
   (Sandbox → Accounts).
4. On approval you're sent back to the app and the webhook records the
   subscription within a second or two.
