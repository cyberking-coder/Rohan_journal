# MetaApi.cloud → Forex Greek Journal auto-sync

Hosted alternative to `mt5_bridge/`. Users connect a broker account through
**Settings → Connected Trading Accounts → Cloud auto-sync**; MetaApi.cloud
runs the MT4/MT5 terminal in their cloud and this worker pulls closed trades
into `public.trades` on a schedule.

Nothing runs on the user's machine.

## One-time setup

### 1. Database
Apply `../supabase/phase10.sql` in the Supabase SQL editor.

### 2. MetaApi account
Sign up at <https://metaapi.cloud>. Copy the **API token** from the account
menu. The free tier allows one connected account; you'll want the "Copyfactory"
or paid tier past that.

### 3. Encryption key
Generate a base64-encoded 256-bit key. This never leaves the server:

```bash
openssl rand -base64 32
```

### 4. Supabase Edge Functions
Deploy the two functions:

```bash
supabase functions deploy broker-connect
supabase functions deploy broker-disconnect
```

Then set their secrets (Supabase → Project settings → Edge Functions →
Secrets):

| Name | Value |
| --- | --- |
| `METAAPI_TOKEN` | Your MetaApi API token |
| `METAAPI_ENCRYPTION_KEY` | The base64 key from step 3 |
| `METAAPI_REGION` | `new-york` (default) or your closest MetaApi region |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already available to Edge
Functions automatically.

### 5. GitHub Actions secrets
Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Same as your project URL |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → `service_role` key |
| `METAAPI_TOKEN` | Same token as step 2 |
| `METAAPI_ENCRYPTION_KEY` | Same key as step 3 |

The workflow `.github/workflows/metaapi-sync.yml` will now run every 5 minutes.

## What gets synced

Closed positions only. Each MetaApi deal is grouped by `positionId` and the
opening + closing deals become one `trades` row keyed on
`(user_id, external_id = "<mt5_login>:<positionId>")`. This is the same unique
index the on-prem `mt5_bridge/` uses, so a user can mix and match without
duplicates.

Open positions are deliberately **not** written — every stat in the app is
computed from closed trades to keep floating P&L out of the numbers.

## Local development

```bash
cd metaapi_bridge
npm install
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... METAAPI_TOKEN=... METAAPI_ENCRYPTION_KEY=... npm run sync
```

## Trust model

- **Browser never sees the MetaApi token.** All mutations go through the
  `broker-connect` / `broker-disconnect` Edge Functions.
- **Broker password never returns to the browser.** The Edge Function
  encrypts it with `METAAPI_ENCRYPTION_KEY` (AES-256-GCM) before storing the
  ciphertext in `broker_connections`.
- **`broker_connections` is service-role-only.** RLS is on with no policies;
  the app reads its own rows through the `list_broker_connections()`
  security-definer function, which never returns the ciphertext columns.
- **Users are told to use the investor password** in the UI, and MT5 enforces
  read-only access at the broker level for that credential.
