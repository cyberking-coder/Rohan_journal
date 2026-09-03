import { useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader } from '../components/common'
import { Sensitive } from '../components/Money'
import { useAuth } from '../lib/AuthContext'
import ShareLinks from '../components/ShareLinks'
import { usePrefs } from '../lib/theme'
import { useQueryParam } from '../lib/router'
import BrokerAccounts from '../components/BrokerAccounts'
import MetaApiConnect from '../components/MetaApiConnect'
import { PLANS } from '../lib/plans'
import { cancelSubscription, useSubscription } from '../lib/billing'
import PlanBadge from '../components/PlanBadge'
import {
  CURRENCIES, CURRENCY_KEYS, TIMEZONE_GROUPS, formatMoney,
  resolveTimezone, timezoneCity, timezoneOffsetLabel,
} from '../lib/format'
import { fmtPct } from '../lib/stats'
import SessionEditor from '../components/SessionEditor'

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'accounts', label: 'MT5 / MT4' },
  { key: 'sharing', label: 'Sharing' },
  { key: 'preferences', label: 'Settings' },
  { key: 'billing', label: 'Billing' },
  { key: 'security', label: 'Security' },
]

export default function Settings({ trades = [], onClearAll, brokerAccounts }) {
  const [tab, setTab] = useQueryParam('tab')
  const active = TABS.some((t) => t.key === tab) ? tab : 'profile'

  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" />

      <ProfileCard />

      <div style={{ display: 'flex', gap: 4, padding: 4, margin: '16px 0 14px', overflowX: 'auto',
        background: 'var(--card)', border: '1px solid var(--stroke)', borderRadius: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 15px', borderRadius: 9, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
              background: active === t.key ? 'var(--card-hover)' : 'transparent',
              color: active === t.key ? 'var(--text)' : 'var(--text-3)',
            }}>{t.label}</button>
        ))}
      </div>

      <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {active === 'profile' && <ProfileTab />}
        {active === 'accounts' && <AccountsTab trades={trades} brokerAccounts={brokerAccounts} />}
        {active === 'sharing' && <SharingTab brokerAccounts={brokerAccounts} />}
        {active === 'preferences' && <PreferencesTab trades={trades} onClearAll={onClearAll} />}
        {active === 'billing' && <BillingTab />}
        {active === 'security' && <SecurityTab />}
      </motion.div>
    </>
  )
}

/* ── Profile header ─────────────────────────────────────────────────────── */

function ProfileCard() {
  const { user, requiresAuth } = useAuth()
  const { profileVisibility } = usePrefs()

  const meta = user?.user_metadata || {}
  const name = meta.full_name || meta.name || user?.email?.split('@')[0] || 'Trader'
  const avatar = meta.avatar_url || meta.picture
  const handle = user?.email ? `@${user.email.split('@')[0]}` : null
  const joined = user?.created_at ? new Date(user.created_at).getFullYear() : null

  return (
    <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      {avatar ? (
        <img src={avatar} alt="" referrerPolicy="no-referrer"
          style={{ width: 62, height: 62, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 62, height: 62, borderRadius: '50%', flexShrink: 0, fontSize: 24, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(140deg,#2fd48a,#128a56)', color: '#04140d',
        }}>{name[0]?.toUpperCase()}</div>
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--display)', fontSize: 19, fontWeight: 700 }}>{name}</span>
          <PlanBadge size="md" />
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 7px', borderRadius: 5,
            color: profileVisibility === 'public' ? 'var(--mint)' : 'var(--text-3)',
            border: '1px solid var(--stroke)',
          }}>{profileVisibility === 'public' ? 'PUBLIC' : 'PRIVATE'}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
          {handle}{joined ? ` · joined ${joined}` : ''}
          {!requiresAuth && ' · demo mode'}
        </div>
      </div>
    </div>
  )
}

/* ── Sharing tab ────────────────────────────────────────────────────────── */

function SharingTab({ brokerAccounts }) {
  const { user } = useAuth()
  const { accounts = [] } = brokerAccounts ?? {}

  return (
    <Section
      title="Shared views"
      subtitle="Read-only links to your performance. You choose what each one shows, and can revoke it at any time."
    >
      <ShareLinks userId={user?.id ?? null} accounts={accounts} />

      <Note>
        A link is a bearer token: anyone holding it sees what you enabled, without
        signing in. Nothing else is reachable through it — not your email, not your
        broker account numbers, not your other accounts, and not any section you left
        off. Revoking is immediate, but it cannot un-see what was already read, so
        prefer a short expiry for anything sensitive.
      </Note>
    </Section>
  )
}

/* ── Profile tab ────────────────────────────────────────────────────────── */

function ProfileTab() {
  const { user, requiresAuth } = useAuth()
  const { profileVisibility, setPref } = usePrefs()
  const meta = user?.user_metadata || {}

  return (
    <Section title="Profile" subtitle="Who you are in the app.">
      <Row label="Display name" hint="Comes from your Google account.">
        <ReadOnly>{meta.full_name || meta.name || '—'}</ReadOnly>
      </Row>
      <Row label="Email">
        <ReadOnly>{user?.email || (requiresAuth ? '—' : 'Not signed in (demo mode)')}</ReadOnly>
      </Row>
      <Row label="Avatar" hint="Managed by your Google account.">
        <ReadOnly>{meta.avatar_url || meta.picture ? 'From Google' : 'None'}</ReadOnly>
      </Row>
      <Toggle
        label="Public profile"
        description="A hint for future community features. Share links are managed on the Sharing tab and work regardless of this setting."
        checked={profileVisibility === 'public'}
        onChange={(on) => setPref('profileVisibility', on ? 'public' : 'private')}
      />
      <Note>
        Name and avatar are supplied by Google at sign-in, so they are edited there rather than here.
        A separate editable display name and bio arrive with the public profile in phase 9.
      </Note>
    </Section>
  )
}

/* ── Accounts tab ───────────────────────────────────────────────────────── */

function AccountsTab({ trades, brokerAccounts }) {
  const { streamerMode } = usePrefs()
  const { accounts = [], error, addAccount, updateAccount, removeAccount } = brokerAccounts ?? {}

  return (
    <Section
      title="Connected Trading Accounts"
      subtitle="The accounts your trades belong to, and whether each one is still syncing."
    >
      {error && (
        <div style={{
          marginBottom: 12, padding: '10px 13px', borderRadius: 10, fontSize: 12.5,
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>Couldn’t load accounts: {error}</div>
      )}

      <BrokerAccounts
        accounts={accounts}
        trades={trades}
        onAdd={addAccount}
        onUpdate={updateAccount}
        onRemove={removeAccount}
      />

      <MetaApiConnect />

      <Note>
        Syncing runs from <span className="mono">mt5_bridge/</span> on your own machine, pushing
        closed trades, open positions and your account balance here. Where it logs in, it uses your
        broker’s <strong>investor</strong> password — read-only at the broker, so it can see your
        account but cannot trade it. Nothing is stored in this database: a browser app that could
        read your credentials would be a way to lose an account, not a journal. Sync that keeps
        running while your machine is off still needs a server holding that credential, which is the
        one broker decision left open in the plan.
        {streamerMode && ' Figures are blurred because Streamer Mode is on.'}
      </Note>
    </Section>
  )
}

/* ── Preferences tab ────────────────────────────────────────────────────── */

function PreferencesTab({ trades, onClearAll }) {
  const p = usePrefs()
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const tz = resolveTimezone(p.timezone)

  return (
    <>
      <Section title="Appearance">
        <Toggle label="Dark mode" description="Dark is the default."
          checked={p.theme === 'dark'} onChange={p.toggleTheme} />
        <Toggle
          label="Streamer Mode"
          description="Blurs every money figure so balances don’t leak on a stream or shared screen. Hover a value to reveal it."
          checked={p.streamerMode} onChange={(on) => p.setPref('streamerMode', on)} />
      </Section>

      <Section title="Notifications">
        <Toggle label="Push notifications"
          description="Browser notifications. Needs permission and a delivery source — arrives with broker sync in phase 5."
          checked={p.notifications.push} onChange={(v) => p.setNotification('push', v)} disabled />
        <Toggle label="Trade alerts"
          description="Notify when a trade closes. Requires live broker sync (phase 5)."
          checked={p.notifications.tradeAlerts} onChange={(v) => p.setNotification('tradeAlerts', v)} disabled />
        <Toggle label="Weekly report"
          description="A weekly performance summary. Arrives with AI Report in phase 7."
          checked={p.notifications.weeklyReport} onChange={(v) => p.setNotification('weeklyReport', v)} disabled />
        <Note>
          These are switched off and disabled because nothing can deliver them yet. Enabling a
          toggle that silently does nothing would be worse than showing it greyed out.
        </Note>
      </Section>

      <Section title="Currency & Timezone">
        <Row label="Display currency"
          hint="Changes the symbol only — it does not convert your P&L, which stays in your account currency.">
          <select value={p.currency} onChange={(e) => p.setPref('currency', e.target.value)} style={control}>
            {CURRENCY_KEYS.map((c) => (
              <option key={c} value={c}>{c} — {CURRENCIES[c].label} ({CURRENCIES[c].symbol.trim()})</option>
            ))}
          </select>
        </Row>
        <Row label="Timezone" hint={`Trade timestamps render in this zone. Currently ${timezoneCity(tz)} ${timezoneOffsetLabel(tz)}.`}>
          <select value={p.timezone} onChange={(e) => p.setPref('timezone', e.target.value)} style={control}>
            <option value="">Follow my browser ({timezoneCity(tz)})</option>
            {TIMEZONE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.zones.map((z) => (
                  <option key={z} value={z}>{timezoneCity(z)} — {z}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Trading Sessions"
        subtitle="Which windows the Analysis module buckets your trades into.">
        <SessionEditor
          config={p.sessions}
          onChange={(next) => p.setPref('sessions', next)}
        />
      </Section>

      <Section title="Dismissed Notifications">
        {p.dismissedNotifications.length === 0 ? (
          <Empty>All clear — nothing has been dismissed.</Empty>
        ) : (
          <Row label={`${p.dismissedNotifications.length} hidden`}>
            <button onClick={p.restoreNotifications} style={ghost}>Restore all</button>
          </Row>
        )}
      </Section>

      <Section title="Danger Zone" danger>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Clear all trading data</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.6 }}>
              Permanently deletes all {trades.length} trades and their journal entries. This cannot be undone.
            </div>
          </div>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} disabled={!trades.length}
              style={{ ...ghost, color: trades.length ? 'var(--red)' : 'var(--text-3)',
                borderColor: trades.length ? 'rgba(255,107,107,0.3)' : 'var(--stroke)',
                cursor: trades.length ? 'pointer' : 'not-allowed' }}>Clear</button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type DELETE"
                style={{ ...control, width: 140 }} autoFocus />
              <button onClick={() => { setConfirming(false); setTyped('') }} style={ghost}>Cancel</button>
              <button
                disabled={typed.trim().toUpperCase() !== 'DELETE'}
                onClick={async () => { await onClearAll?.(); setConfirming(false); setTyped('') }}
                style={{
                  ...ghost,
                  background: typed.trim().toUpperCase() === 'DELETE' ? 'var(--red)' : 'var(--card-2)',
                  color: typed.trim().toUpperCase() === 'DELETE' ? '#fff' : 'var(--text-3)',
                  border: 'none',
                }}>Delete everything</button>
            </div>
          )}
        </div>
      </Section>
    </>
  )
}

/* ── Billing tab ────────────────────────────────────────────────────────── */

function BillingTab() {
  const { sub, loading, refetch } = useSubscription()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const plan = PLANS.find((p) => p.id === sub?.plan) ?? PLANS[0]
  const isPaid = plan.id !== 'free'
  const renewsAt = sub?.current_period_end ? new Date(sub.current_period_end) : null

  const cancel = async () => {
    if (!confirm('Cancel your subscription? You will keep access until the end of the current billing period.')) return
    setBusy(true); setError(null)
    const { error } = await cancelSubscription()
    setBusy(false)
    if (error) setError(error); else refetch()
  }

  return (
    <Section title="Billing" subtitle="Your plan, next renewal and payment method.">
      <Row label="Current plan">
        <ReadOnly>
          {loading ? '…' : plan.name}
          {sub?.billing ? ` · ${sub.billing}` : ''}
          {sub?.status && sub.status !== 'active' && sub.status !== 'inactive' ? ` · ${sub.status}` : ''}
        </ReadOnly>
      </Row>

      {isPaid && (
        <Row label={sub.cancel_at_period_end ? 'Ends on' : 'Renews on'}>
          <ReadOnly>{renewsAt ? renewsAt.toLocaleDateString() : '—'}</ReadOnly>
        </Row>
      )}

      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {isPaid ? (
          <>
            {!sub.cancel_at_period_end ? (
              <button onClick={cancel} disabled={busy} style={{ ...ghost, color: 'var(--red)', borderColor: 'rgba(255,107,107,0.3)' }}>
                {busy ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            ) : (
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                Cancels at the end of the current period.
              </span>
            )}
          </>
        ) : (
          <a href="?view=pricing" style={{ ...primaryButton, textDecoration: 'none', display: 'inline-block' }}>
            Upgrade plan
          </a>
        )}
        <button onClick={refetch} style={ghost}>Refresh</button>
      </div>

      {error && (
        <div style={{
          marginTop: 12, padding: '10px 13px', borderRadius: 10, fontSize: 12.5,
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>{error}</div>
      )}

      <Note>
        Payments are handled by Dodo Payments (merchant of record). Receipts arrive by email;
        change payment method through the link in the latest receipt.
      </Note>
    </Section>
  )
}

/* ── Security tab ───────────────────────────────────────────────────────── */

function SecurityTab() {
  const { user, signOut, requiresAuth } = useAuth()
  const [working, setWorking] = useState(false)

  const provider = user?.app_metadata?.provider
  const providers = user?.app_metadata?.providers || (provider ? [provider] : [])

  return (
    <Section title="Security">
      <Row label="Sign-in method">
        <ReadOnly>{providers.length ? providers.join(', ') : requiresAuth ? '—' : 'Demo mode (no sign-in)'}</ReadOnly>
      </Row>
      <Row label="Account ID" hint="Used by the MT5 bridge to attribute imported trades.">
        <ReadOnly mono>{user?.id ?? '—'}</ReadOnly>
      </Row>
      <Row label="Last sign-in">
        <ReadOnly>{user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : '—'}</ReadOnly>
      </Row>

      {requiresAuth && (
        <Row label="Active sessions" hint="Signs you out on every device where you are signed in.">
          <button
            disabled={working}
            onClick={async () => { setWorking(true); await signOut({ scope: 'global' }); }}
            style={{ ...ghost, color: 'var(--amber)', borderColor: 'rgba(255,207,107,0.3)' }}>
            {working ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        </Row>
      )}

      <Note>
        Passwords and two-factor authentication are handled by Google, since that is the only
        sign-in method configured — there is no password here to change. Deleting your account
        outright needs a server-side admin call, which this app does not have; clearing your
        trading data under Settings removes everything the app stores about your trading.
      </Note>
    </Section>
  )
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */

function Section({ title, subtitle, right, danger, children }) {
  return (
    <section className="card" style={{
      padding: 20, marginBottom: 14,
      borderColor: danger ? 'rgba(255,107,107,0.28)' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: subtitle ? 4 : 14, flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: 15, fontWeight: 600, color: danger ? 'var(--red)' : 'var(--text)' }}>{title}</h3>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      {subtitle && <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>{subtitle}</p>}
      {children}
    </section>
  )
}

function Row({ label, hint, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      padding: '12px 0', borderTop: '1px solid var(--stroke-soft)',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.55 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Toggle({ label, description, checked, onChange, disabled }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '12px 0', borderTop: '1px solid var(--stroke-soft)',
      opacity: disabled ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        {description && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.55 }}>{description}</div>}
      </div>
      <button
        role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 42, height: 24, borderRadius: 12, flexShrink: 0, position: 'relative',
          background: checked ? 'linear-gradient(120deg,#3ee39a,#23b978)' : 'var(--track)',
          border: '1px solid var(--stroke)', transition: 'background 0.2s',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        <motion.span
          animate={{ x: checked ? 19 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          style={{
            position: 'absolute', top: 2, left: 0, width: 18, height: 18, borderRadius: '50%',
            background: checked ? '#04140d' : 'var(--text-3)',
          }} />
      </button>
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 9 }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{value}</div>
    </div>
  )
}

function ReadOnly({ children, mono }) {
  return (
    <span className={mono ? 'mono' : undefined}
      style={{ fontSize: 12.5, color: 'var(--text-2)', wordBreak: 'break-all' }}>{children}</span>
  )
}

function Empty({ children }) {
  return (
    <div style={{
      padding: '20px 16px', borderRadius: 11, fontSize: 12.5, lineHeight: 1.7,
      color: 'var(--text-3)', background: 'var(--card-2)', border: '1px solid var(--stroke)',
    }}>{children}</div>
  )
}

function Note({ children }) {
  return (
    <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.65, marginTop: 14 }}>{children}</p>
  )
}

const control = {
  padding: '8px 12px', borderRadius: 10, fontSize: 13, minWidth: 220,
  background: 'var(--input-bg)', border: '1px solid var(--stroke)',
  color: 'var(--text)', outline: 'none',
}

const ghost = {
  padding: '8px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
  color: 'var(--text-2)', border: '1px solid var(--stroke)', background: 'var(--card-2)',
}

const primaryButton = {
  padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: 'var(--mint)', color: '#001512', fontWeight: 600, fontSize: 13,
}
