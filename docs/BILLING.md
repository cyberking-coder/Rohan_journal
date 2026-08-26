# Billing setup (Phase 11)

Everything in this repo is built and tested. What's left is connecting your own
Stripe account, which is deliberately a manual step — nobody's code should be
able to start charging cards as a side effect of a deploy.

Nothing in this document requires code changes.

## What is already done

- `subscriptions` and `stripe_events` tables, with the security property that
  matters: **there is no client write policy on `subscriptions`.** A user
  cannot set their own plan. Verified by the isolation suite.
- `stripe-webhook` — verifies Stripe's signature, deduplicates retries, ignores
  out-of-order events.
- `create-checkout` — translates a *plan name* into a price server-side.
- `create-portal` — hands cancellation, plan changes, cards and invoices to
  Stripe's own portal.
- The Billing tab, with real upgrade buttons.

## What you need to do

### 1. Create the products in Stripe

Two recurring monthly prices, one per paid plan. The amounts should match
`PLANS` in `src/lib/plans.js` ($12 and $29) or you should change that file —
the app displays those numbers and Stripe charges its own, and nothing
reconciles them.

Copy the two **price** ids (`price_...`, not `prod_...`).

### 2. Run the migration

`supabase/billing.sql` in the SQL editor.

### 3. Set the secrets

```
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_PRICE_PRO=price_...
supabase secrets set STRIPE_PRICE_PREMIUM=price_...
supabase secrets set APP_URL=https://your-app-url
supabase secrets set ALLOWED_ORIGIN=https://your-app-url
```

Use `sk_test_...` and test prices first. Stripe's test mode is a complete
parallel world — you can run the whole flow with card `4242 4242 4242 4242`
without moving money.

### 4. Deploy the functions

```
supabase functions deploy create-checkout
supabase functions deploy create-portal
supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook is required and is the one place it is
correct: Stripe cannot present a Supabase JWT. The signature check replaces it.
**Do not copy that flag to the other two functions** — it would make them
callable by anyone.

### 5. Register the webhook

In Stripe → Developers → Webhooks → Add endpoint:

- URL: `https://<your-project>.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`

Copy the signing secret and set it:

```
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

Then redeploy the webhook function — secrets are read at boot.

### 6. Enable the customer portal

Stripe → Settings → Billing → Customer portal → activate. Without this,
"Manage billing" returns a configuration error that reads like an app bug. The
function detects that specific failure and says so, but it is easier to just
switch it on.

## Testing it

```
stripe listen --forward-to https://<project>.supabase.co/functions/v1/stripe-webhook
```

Then subscribe with `4242 4242 4242 4242`. Worth exercising deliberately:

| Card | What it tests |
|---|---|
| `4242 4242 4242 4242` | The happy path |
| `4000 0000 0000 0341` | Attaches, then fails on charge → `past_due` |
| `4000 0000 0000 9995` | Declines outright → `incomplete`, no access |

Then cancel from the portal and confirm the plan **stays** until the period
ends. That is the behaviour most likely to be broken by a well-meaning change,
and the one your customers will notice fastest.

## Things that will bite

**The signature check is the entire access control.** The webhook URL is
public and unauthenticated — it has to be. Without verification, upgrading
yourself to Premium is one `curl`. If you ever find yourself "temporarily"
disabling it to debug something, the endpoint is wide open while you do.

**Read the raw body.** `constructEventAsync` needs the exact bytes Stripe sent.
Parsing to JSON and re-serialising changes them and breaks verification — the
most common way this check gets accidentally defeated.

**An unmapped price grants nothing.** If you add a price in Stripe and forget
its env var, that customer pays and stays on Free. That is the deliberate
direction of the failure: the alternative default would give Premium to
everyone. The webhook logs it loudly.

**`past_due` keeps access on purpose.** Stripe retries a failed charge for
days. Locking someone out on the first failure loses customers whose card
merely expired. Both `effective_plan()` and `resolvePlan()` encode this, and
`test/subscription.test.mjs` pins it.

**Tax.** `automatic_tax` is enabled in the checkout session, but Stripe Tax
must be turned on in your dashboard and you need a registered address. Selling
into the EU or UK without it is a problem discovered late and retroactively.

## Still not done

- **Dunning emails.** Stripe can send them; nothing here does.
- **Proration on plan changes** is whatever the portal is configured to do.
- **Deleting a Stripe customer** when an account is deleted. `usePrivacy`
  removes the row; the Stripe-side customer and its invoice history remain,
  which is usually what tax law requires — but it should be a decision you
  make knowingly rather than a gap.
