# Security & multi-tenancy audit

Date: 2026-08-13 · Scope: database isolation, storage, the AI-report edge
function, client credential handling.

Run the isolation suite yourself at any time:

```bash
./supabase/run_security_test.sh
```

It builds a throwaway PostgreSQL, applies every migration in order, then acts
as two different signed-in users and an anonymous visitor, asserting 38 things
about what each can and cannot see or change. Zero failures as of this commit.

## Why it's a test and not a checklist

Reading a policy tells you what someone intended. Only running as a second user
tells you what happens. Two things routinely make a correct-looking policy do
nothing at all:

- **RLS does not apply to the table owner** unless `FORCE ROW LEVEL SECURITY`
  is set. An audit run as the owner passes no matter how broken the policy is.
- **A missing `GRANT`** makes a table unreachable, which looks exactly like
  isolation working — until you add the grant and discover it never was.

The suite runs as a separate non-owner role and checks both directions: other
users' rows invisible, *and* your own still reachable.

It also catches breakage. Deliberately weakening the `candles` read policy to
`using (true)` produces three failures including `anon: no candles — saw 2`.
A suite that can only pass proves nothing.

## Findings

### 1. Screenshot bucket was world-readable — **fixed**

**Severity: high** for any deployment with more than one account.

`storage.sql` created the `screenshots` bucket as public, with:

```sql
create policy "screenshots public read" on storage.objects
  for select using (bucket_id = 'screenshots');
```

No role restriction, so the policy applied to `anon` as well as
`authenticated`. The anon key is published in the app's JavaScript bundle by
design, so **anyone could list the bucket and download every user's
screenshots** — no filename guessing needed, because listing was permitted.

The original comment justified this as "non-sensitive chart images". They
aren't: a chart screenshot usually has the MT5 terminal in frame, and that
shows account balance, equity and open positions.

**Fix:** bucket is private; read, write and delete are restricted to the owning
user's folder and to `authenticated`. The app requests a one-hour signed URL
when it needs to display one (`screenshotSrc` in `src/lib/storage.js`).

Confirmed by negative control: restoring the old policy makes the suite report
`anon: no screenshots — saw 2`.

**Action for you:** re-run `supabase/storage.sql`. Any screenshot already saved
as a public URL will stop resolving — that is the correct outcome, since that
link was readable by anyone. Re-upload the few images you care about.

### 2. Edge function trusted client-supplied text sizes — **fixed**

**Severity: medium** — cost abuse, not data exposure.

`generate-report` capped the *number* of trades at 200 but not their size. The
browser trims journal notes to 200 characters, but a request doesn't have to
come from the browser. 200 trades each carrying megabytes of text was a valid
request, and every byte is billed as input tokens.

**Fix:** the prompt input is rebuilt server-side, field by field, with hard
length caps; anything else in the body never reaches the model.

Measured against a hostile payload: **134 MB → 368 KB**, roughly 33.5M tokens
down to 94K — a 356× reduction. At `claude-opus-5` input pricing that is about
$168 per request avoided.

### 3. `ALLOWED_ORIGIN` for the edge function — **added, needs setting**

CORS was `*`. The function requires a bearer token regardless, so this was
never the lock itself, but it should be narrowed. Set `ALLOWED_ORIGIN` to your
app's URL as a function secret before launch.

### 4. A finding that turned out not to be one

Four `for update` policies specify `using` without `with check`, which looks
like it would let a user reassign their own row to another `user_id` — handing
a trade to another tenant.

It doesn't. **PostgreSQL uses the `USING` expression as the `WITH CHECK`
expression when the latter is absent.** The suite asserts this directly
(`trades: cannot reassign to B` — blocked by RLS) rather than relying on the
claim. Recorded here because reading the SQL genuinely suggests a hole, and the
next person to audit this will think the same thing.

## What passes

- Every table in `public` has RLS enabled, and every RLS table has at least one
  policy. Both are asserted structurally, so a new table added without them
  fails the suite.
- Per-user isolation on `trades`, `broker_accounts`, `profiles`, `ai_reports`,
  `backtest_sessions`, `candles`: reads, updates, deletes, and inserts
  *labelled as another user*.
- `ai_reports` has no client insert policy, so a user cannot mint themselves
  unlimited AI reports; the edge function is the only writer, and it counts the
  weekly quota against the database before spending anything.
- `economic_events` is read-only from the browser — a client that could write
  there could feed every user false economic data.
- Anonymous visitors see nothing at all: no trades, profiles, candles, reports,
  calendar or screenshots.
- No secrets are committed. `.env` is gitignored in both bridges; the templates
  hold placeholders only.
- The client sends `user_id` on writes, which is safe because the insert policy
  requires it to equal `auth.uid()` — asserted, not assumed.

## Open before you take payment

These are not code defects; they're launch requirements.

1. **Account deletion.** `profiles` has no delete policy and there is no
   "delete my account" flow. Cascades handle it when the auth user is removed,
   but a user has no way to trigger that. Required under GDPR if you have EU
   users.
2. **Supabase dashboard settings** I cannot verify from here: email
   confirmation on, leaked-password protection on, a sane password policy, and
   an MFA option for your own admin account.
3. **Backups.** Confirm your Supabase plan's retention and actually test a
   restore. An untested backup is a hope.
4. **The service key must never ship to users.** The bridge now signs in as the
   user with the anon key; the service-key path remains for single-user setups
   and warns loudly. Anyone you give a service key to can read every user's
   trades.
5. **Security headers / CSP** on wherever you host the front end.
6. **Error monitoring.** You currently learn about failures by reading a
   terminal.
