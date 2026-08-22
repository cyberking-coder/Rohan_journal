import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, Panel } from '../components/common'
import Money, { Sensitive } from '../components/Money'
import { useAuth } from '../lib/AuthContext'
import { useFundedAccounts } from '../lib/useFundedAccounts'
import {
  DRAWDOWN_TYPES, STATUS, describeBreach, evaluate, statusTone,
} from '../lib/funded'

/**
 * Prop-firm challenge tracking — Master PRD §31–32.
 *
 * The question this page answers is not "how am I doing" — the Analysis page
 * does that. It is "do I still have an account, and what ends it today". Every
 * figure is framed as room remaining rather than as a total, because that is
 * the number a trader has to hold in their head before taking the next trade.
 */
export default function Funded({ trades = [], brokerAccounts = [] }) {
  const { user } = useAuth()
  const { accounts, loading, ready, error, save, setArchived, remove } = useFundedAccounts(user?.id)
  const [editing, setEditing] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  const visible = accounts.filter((a) => showArchived || !a.archived)
  const archivedCount = accounts.filter((a) => a.archived).length

  return (
    <>
      <PageHeader eyebrow="Funded" title="Prop Challenges">
        <button className="btn-primary" onClick={() => setEditing(blank())}>New challenge</button>
      </PageHeader>

      {error && (
        <div className="card" style={{ padding: 14, marginBottom: 14, color: 'var(--red)', fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {!loading && !ready && (
        <Panel title="Not set up yet">
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
            Challenge tracking needs one migration. Run{' '}
            <code style={{ background: 'var(--card-2)', padding: '2px 6px', borderRadius: 5 }}>
              supabase/funded.sql
            </code>{' '}
            in the Supabase SQL editor, then reload this page.
          </p>
        </Panel>
      )}

      {!loading && ready && visible.length === 0 && (
        <Panel title="No challenges yet">
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, maxWidth: 560 }}>
            Add the rules your firm gave you — profit target, daily loss limit, maximum
            loss, minimum trading days — and this page will tell you how much room each
            one has left, from the trades already in your journal.
          </p>
          <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => setEditing(blank())}>
            Add your first challenge
          </button>
        </Panel>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {visible.map((a, i) => (
          <ChallengeCard
            key={a.id} account={a} trades={trades} delay={i * 0.05}
            onEdit={() => setEditing(a)}
            onArchive={() => setArchived(a.id, !a.archived)}
            onDelete={() => remove(a.id)}
          />
        ))}
      </div>

      {archivedCount > 0 && (
        <button
          onClick={() => setShowArchived((v) => !v)}
          style={{ marginTop: 18, fontSize: 12, color: 'var(--text-3)' }}
        >
          {showArchived ? 'Hide' : 'Show'} {archivedCount} archived challenge{archivedCount === 1 ? '' : 's'}
        </button>
      )}

      {editing && (
        <RuleForm
          initial={editing}
          brokerAccounts={brokerAccounts}
          onClose={() => setEditing(null)}
          onSave={async (draft) => { const r = await save(draft); if (r) setEditing(null) }}
        />
      )}
    </>
  )
}

function blank() {
  return {
    label: 'Challenge', firm: '', phase: 'Phase 1',
    brokerAccountId: null,
    startingBalance: 100000, profitTarget: 8000,
    dailyLossLimit: 5000, maxLoss: 10000,
    minTradingDays: 4, consistencyLimit: '',
    drawdownType: 'static', dayResetOffsetMinutes: 0,
    startedAt: '',
  }
}

// ---------------------------------------------------------------------------
// One challenge
// ---------------------------------------------------------------------------

function ChallengeCard({ account, trades, delay, onEdit, onArchive, onDelete }) {
  const scoped = useMemo(() => {
    let list = trades
    // A challenge tracks one account. Without this filter a second account's
    // profits would quietly pay off the first one's drawdown.
    if (account.brokerAccountId) {
      list = list.filter((t) => t.broker_account_id === account.brokerAccountId)
    }
    if (account.startedAt) {
      const from = new Date(account.startedAt).getTime()
      list = list.filter((t) => new Date(t.closed_at || t.traded_at).getTime() >= from)
    }
    return list
  }, [trades, account.brokerAccountId, account.startedAt])

  const r = useMemo(() => evaluate(account, scoped), [account, scoped])
  const tone = statusTone(r.status)
  const hasOpen = scoped.some((t) => t.status === 'open')

  return (
    <Panel
      delay={delay}
      style={{ opacity: account.archived ? 0.6 : 1 }}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {account.label}
          {account.firm && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{account.firm}</span>}
          {account.phase && (
            <span style={{
              fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--text-3)', border: '1px solid var(--stroke)', borderRadius: 20, padding: '2px 9px',
            }}>{account.phase}</span>
          )}
        </span>
      }
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusPill status={r.status} tone={tone} />
          <button onClick={onEdit} style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Edit</button>
          <button onClick={onArchive} style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            {account.archived ? 'Restore' : 'Archive'}
          </button>
          <button onClick={onDelete} style={{ fontSize: 11.5, color: 'var(--red)' }}>Delete</button>
        </div>
      }
    >
      {r.breach && (
        <div style={{
          padding: '11px 14px', borderRadius: 10, marginBottom: 16, fontSize: 12.5,
          background: 'rgba(255,90,90,0.09)', border: '1px solid rgba(255,90,90,0.3)', color: 'var(--red)',
        }}>
          <Sensitive>{describeBreach(r.breach)}</Sensitive>
        </div>
      )}

      {/* The target bar comes first: it is the only figure that is progress
          rather than remaining room, and it is what the trader is here for. */}
      {r.targetProgress !== null && !r.breach && (
        <div style={{ marginBottom: 18 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', fontSize: 11.5,
            color: 'var(--text-3)', marginBottom: 7,
          }}>
            <span>Profit target</span>
            <span>
              <Money value={r.profit} colored /> of <Money value={r.rules.profitTarget} />
              {' · '}{(r.targetProgress * 100).toFixed(1)}%
            </span>
          </div>
          <Bar value={r.targetProgress} tone={r.targetProgress >= 1 ? 'good' : 'neutral'} />
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12,
      }}>
        <Figure label="Balance" value={<Money value={r.equity} />} />
        <Figure label="Today's P&L" value={<Money value={r.todayPnl} colored />} />
        {r.dailyLossRemaining !== null && (
          <Figure
            label="Daily loss left"
            value={<Money value={r.dailyLossRemaining} />}
            tone={dangerTone(r.dailyLossRemaining, r.rules.dailyLossLimit)}
          />
        )}
        {r.maxLossRemaining !== null && (
          <Figure
            label="Max loss left"
            value={<Money value={r.maxLossRemaining} />}
            tone={dangerTone(r.maxLossRemaining, r.rules.maxLoss)}
          />
        )}
        <Figure
          label="Drawdown"
          value={<span><Money value={r.drawdown} /> <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {r.drawdownPct.toFixed(1)}%
          </span></span>}
        />
        <Figure
          label="Trading days"
          // Counts and day totals are never blurred by Streamer Mode — only
          // money is.
          value={`${r.tradingDays}${r.rules.minTradingDays ? ` / ${r.rules.minTradingDays}` : ''}`}
        />
      </div>

      {r.consistency.applicable && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', fontSize: 11.5,
            color: r.consistency.ok ? 'var(--text-3)' : 'var(--red)', marginBottom: 7,
          }}>
            <span>Consistency — best day is {(r.consistency.share * 100).toFixed(1)}% of profit</span>
            <span>limit {(r.consistency.limit * 100).toFixed(0)}%</span>
          </div>
          <Bar
            value={Math.min(r.consistency.share / r.consistency.limit, 1)}
            tone={r.consistency.ok ? 'neutral' : 'bad'}
          />
          {!r.consistency.ok && (
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 7, lineHeight: 1.6 }}>
              Make <Money value={r.consistency.profitNeeded} /> more on other days and this
              comes back inside the rule.
            </p>
          )}
        </div>
      )}

      {r.outstanding.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 16, lineHeight: 1.6 }}>
          Still to go: {r.outstanding.join(', ')}.
        </p>
      )}

      {/* Said plainly rather than hidden, because it is the one case where
          this page can be behind the firm's own view of the account. */}
      {hasOpen && !r.breach && (
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.6 }}>
          You have open positions. These figures count closed trades only — your firm
          measures the daily loss on live equity, so an open loser can breach before it
          shows up here.
        </p>
      )}
    </Panel>
  )
}

// Turns "room remaining" into a colour. Under a quarter of the limit left is
// the point at which a normal-sized trade can end the account.
function dangerTone(remaining, limit) {
  if (!limit) return undefined
  const share = remaining / limit
  if (share <= 0.25) return 'bad'
  if (share <= 0.5) return 'warn'
  return undefined
}

function StatusPill({ status, tone }) {
  const colors = {
    good: ['rgba(62,227,154,0.13)', 'var(--mint)'],
    bad: ['rgba(255,90,90,0.13)', 'var(--red)'],
    neutral: ['var(--card-2)', 'var(--text-2)'],
  }[tone] || ['var(--card-2)', 'var(--text-2)']

  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
      background: colors[0], color: colors[1], borderRadius: 20, padding: '4px 11px',
    }}>{status}</span>
  )
}

function Figure({ label, value, tone }) {
  const color = tone === 'bad' ? 'var(--red)' : tone === 'warn' ? 'var(--amber, #e8b13a)' : 'var(--text)'
  return (
    <div style={{ padding: '12px 14px', borderRadius: 11, background: 'var(--card-2)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 5, color }}>{value}</div>
    </div>
  )
}

function Bar({ value, tone }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100
  const fill = tone === 'good' ? 'linear-gradient(90deg,#3ee39a,#23b978)'
    : tone === 'bad' ? 'linear-gradient(90deg,#ff8080,#e04b4b)'
      : 'linear-gradient(90deg,#6ba7ff,#3d7fd6)'
  return (
    <div style={{ height: 7, borderRadius: 20, background: 'var(--card-2)', overflow: 'hidden' }}>
      <motion.div
        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{ height: '100%', background: fill }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rules form
// ---------------------------------------------------------------------------

function RuleForm({ initial, brokerAccounts, onClose, onSave }) {
  const [f, setF] = useState(() => ({ ...initial }))
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto',
      }}
    >
      <motion.div
        className="card" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        style={{ padding: 24, width: '100%', maxWidth: 560 }}
      >
        <h3 style={{ fontFamily: 'var(--display)', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          {initial.id ? 'Edit challenge' : 'New challenge'}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20, lineHeight: 1.6 }}>
          Copy the numbers from your firm's rules page. Leave a field blank if your firm
          doesn't have that rule.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 13 }}>
          <Field label="Name"><input value={f.label} onChange={set('label')} /></Field>
          <Field label="Firm"><input value={f.firm} onChange={set('firm')} placeholder="FundingPips" /></Field>
          <Field label="Phase"><input value={f.phase} onChange={set('phase')} placeholder="Phase 1" /></Field>

          <Field label="Account" hint="Which trades count toward this challenge.">
            <select
              value={f.brokerAccountId || ''}
              onChange={(e) => setF((p) => ({ ...p, brokerAccountId: e.target.value || null }))}
            >
              <option value="">All trades</option>
              {brokerAccounts.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </Field>

          <Field label="Starting balance">
            <input type="number" value={f.startingBalance} onChange={set('startingBalance')} />
          </Field>
          <Field label="Profit target">
            <input type="number" value={f.profitTarget ?? ''} onChange={set('profitTarget')} />
          </Field>
          <Field label="Daily loss limit">
            <input type="number" value={f.dailyLossLimit ?? ''} onChange={set('dailyLossLimit')} />
          </Field>
          <Field label="Maximum loss">
            <input type="number" value={f.maxLoss ?? ''} onChange={set('maxLoss')} />
          </Field>
          <Field label="Minimum trading days">
            <input type="number" value={f.minTradingDays} onChange={set('minTradingDays')} />
          </Field>
          <Field label="Consistency %" hint="Most profit allowed from one day. Blank if none.">
            <input type="number" value={f.consistencyLimit ?? ''} onChange={set('consistencyLimit')} placeholder="40" />
          </Field>

          <Field label="Drawdown type" hint={DRAWDOWN_TYPES[f.drawdownType]?.hint}>
            <select value={f.drawdownType} onChange={set('drawdownType')}>
              {Object.entries(DRAWDOWN_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Day reset (UTC offset, minutes)"
            hint="Your firm's daily reset. New York 17:00 is −300.">
            <input type="number" value={f.dayResetOffsetMinutes} onChange={set('dayResetOffsetMinutes')} />
          </Field>

          <Field label="Started on" hint="Trades before this date are ignored.">
            <input
              type="date"
              value={(f.startedAt || '').slice(0, 10)}
              onChange={(e) => setF((p) => ({
                ...p,
                startedAt: e.target.value ? new Date(`${e.target.value}T00:00:00Z`).toISOString() : '',
              }))}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button onClick={onClose} style={{ fontSize: 13, color: 'var(--text-3)', padding: '9px 14px' }}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSave(f)}>Save</button>
        </div>
      </motion.div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{
        fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: 'var(--text-3)', marginBottom: 6,
      }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
    </label>
  )
}

export { STATUS }
