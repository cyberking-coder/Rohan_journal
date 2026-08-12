import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PageHeader } from '../components/common'
import RatingSlider from '../components/RatingSlider'
import {
  DATE_FILTERS, JOURNAL_FIELDS, JOURNAL_SORTS, JOURNAL_TABS,
  filterJournal, fmtPlannedRatio, isJournaled, journalCompletion,
  journalRating, tabCounts,
} from '../lib/journal'
import { closeTime } from '../lib/analytics'
import { net } from '../lib/stats'
import Money from '../components/Money'
import { usePrefs } from '../lib/theme'
import { formatDateTime } from '../lib/format'

export default function Journal({ trades, onAdd, onUpdate, onEdit }) {
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [sort, setSort] = useState('recent')
  const [selectedId, setSelectedId] = useState(null)

  const counts = useMemo(() => tabCounts(trades), [trades])
  const list = useMemo(
    () => filterJournal(trades, { tab, query, dateFilter, sort }),
    [trades, tab, query, dateFilter, sort],
  )

  // Keep a selection alive as filters change: hold the current trade if it's
  // still in the list, otherwise fall back to the first one.
  useEffect(() => {
    if (list.some((t) => t.id === selectedId)) return
    setSelectedId(list[0]?.id ?? null)
  }, [list, selectedId])

  const selected = trades.find((t) => t.id === selectedId) ?? null

  return (
    <>
      <PageHeader eyebrow="Trade Journal" title="Journal">
        <button onClick={onAdd} className="hide-mobile"
          style={{
            padding: '10px 18px', borderRadius: 11, fontWeight: 600, fontSize: 14,
            background: 'linear-gradient(120deg,#3ee39a,#23b978)', color: '#04140d',
          }}>+ Add Trade</button>
      </PageHeader>

      <div className="journal-split">
        {/* ── List ──────────────────────────────────────────────────── */}
        <section className="card journal-list" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--stroke)', display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div style={{ display: 'flex', gap: 4, background: 'var(--card-2)', borderRadius: 10, padding: 3 }}>
              {JOURNAL_TABS.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  style={{
                    flex: 1, padding: '7px 6px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: tab === t.key ? 'var(--card-hover)' : 'transparent',
                    color: tab === t.key ? 'var(--text)' : 'var(--text-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}>
                  {t.label}
                  <span className="mono" style={{
                    fontSize: 10, padding: '1px 5px', borderRadius: 5,
                    background: 'var(--track)', color: 'var(--text-3)',
                  }}>{counts[t.key]}</span>
                </button>
              ))}
            </div>

            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol or notes…" style={controlStyle} />

            <div style={{ display: 'flex', gap: 8 }}>
              <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ ...controlStyle, flex: 1 }}>
                {Object.entries(DATE_FILTERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...controlStyle, flex: 1 }}>
                {Object.entries(JOURNAL_SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, padding: 8, minHeight: 0 }}>
            {list.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13, lineHeight: 1.6 }}>
                {trades.length === 0
                  ? 'No trades yet — log your first one.'
                  : 'No trades match these filters.'}
              </div>
            ) : list.map((t) => (
              <TradeCard key={t.id} trade={t} active={t.id === selectedId} onSelect={() => setSelectedId(t.id)} />
            ))}
          </div>
        </section>

        {/* ── Detail ────────────────────────────────────────────────── */}
        <section className="card" style={{ padding: 0, minHeight: 420, display: 'flex', flexDirection: 'column' }}>
          <AnimatePresence mode="wait">
            {selected
              ? <JournalDetail key={selected.id} trade={selected} onUpdate={onUpdate} onEdit={onEdit} />
              : <DetailEmpty key="empty" />}
          </AnimatePresence>
        </section>
      </div>
    </>
  )
}

function TradeCard({ trade, active, onSelect }) {
  const { timezone } = usePrefs()
  const pnl = net(trade)
  const at = closeTime(trade)
  const fresh = !isJournaled(trade)

  return (
    <button onClick={onSelect}
      style={{
        width: '100%', textAlign: 'left', padding: '11px 12px', borderRadius: 11, marginBottom: 4,
        background: active ? 'var(--card-hover)' : 'transparent',
        border: `1px solid ${active ? 'var(--stroke)' : 'transparent'}`,
        display: 'flex', flexDirection: 'column', gap: 5,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{trade.symbol}</span>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 5, fontWeight: 600,
          color: trade.side === 'Long' ? 'var(--mint)' : 'var(--red)',
          background: trade.side === 'Long' ? 'rgba(47,212,138,0.1)' : 'rgba(255,107,107,0.1)',
        }}>{trade.side}</span>
        {fresh && (
          <span style={{
            fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 5px',
            borderRadius: 4, color: 'var(--amber)', border: '1px solid rgba(255,207,107,0.35)',
          }}>NEW</span>
        )}
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>
          <Money value={pnl} colored />
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-3)' }}>
        <span>{trade.entry != null ? `@ ${trade.entry}` : '—'}</span>
        <span style={{ marginLeft: 'auto' }}>
          {at ? formatDateTime(at, { timezone, hour: undefined, minute: undefined }) : '—'}
        </span>
      </div>
    </button>
  )
}

function DetailEmpty() {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, padding: 40, textAlign: 'center',
      }}>
      <div style={{
        width: 50, height: 50, borderRadius: 15, fontSize: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--card-2)', border: '1px solid var(--stroke)', color: 'var(--text-3)',
      }}>▤</div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 260, lineHeight: 1.6 }}>
        Select a trade on the left to write up what you saw, what happened, and what you’d do differently.
      </p>
    </motion.div>
  )
}

function JournalDetail({ trade, onUpdate, onEdit }) {
  const [draft, setDraft] = useState(() => initialDraft(trade))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Switching trades must load that trade's entry, not carry the last one over.
  useEffect(() => { setDraft(initialDraft(trade)); setSaved(false) }, [trade.id])

  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft(trade))
  const pnl = net(trade)
  const completion = journalCompletion({ ...trade, ...draft })

  const set = (key) => (value) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    // Empty strings would make `is_journaled` true for a blank entry, so they
    // are stored as null.
    const payload = {
      ...Object.fromEntries(JOURNAL_FIELDS.map((f) => [f.key, draft[f.key].trim() || null])),
      planned_rr_risk: draft.planned_rr_risk === '' ? null : Number(draft.planned_rr_risk),
      planned_rr_reward: draft.planned_rr_reward === '' ? null : Number(draft.planned_rr_reward),
      journal_rating: draft.journal_rating,
    }
    await onUpdate?.(trade.id, payload)
    setSaving(false)
    setSaved(true)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--stroke)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{trade.symbol}</span>
            <span style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 5,
              color: pnl >= 0 ? 'var(--mint)' : 'var(--red)',
              border: `1px solid ${pnl >= 0 ? 'rgba(47,212,138,0.35)' : 'rgba(255,107,107,0.35)'}`,
            }}>{pnl >= 0 ? 'WINNER' : 'LOSER'}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }}>
            {trade.side} · {trade.qty ?? '—'} lots · entry {trade.entry ?? '—'}
            {trade.strategy ? ` · ${trade.strategy}` : ''}
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 17, fontWeight: 700 }}>
            <Money value={pnl} colored />
          </span>
          {onEdit && (
            <button onClick={() => onEdit(trade)} title="Edit trade details"
              style={{ ...ghostButton, padding: '7px 11px' }}>Edit</button>
          )}
          <button onClick={save} disabled={!dirty || saving}
            style={{
              padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: dirty ? 'linear-gradient(120deg,#3ee39a,#23b978)' : 'var(--card-2)',
              color: dirty ? '#04140d' : 'var(--text-3)',
              border: dirty ? 'none' : '1px solid var(--stroke)',
              cursor: dirty && !saving ? 'pointer' : 'default',
            }}>
            {saving ? 'Saving…' : saved && !dirty ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>

      {/* Completeness */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--stroke)', display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>Journal {completion}% complete</span>
        <div style={{ flex: 1, height: 5, background: 'var(--track)', borderRadius: 3, overflow: 'hidden' }}>
          <motion.div animate={{ width: `${completion}%` }} transition={{ duration: 0.4 }}
            style={{ height: '100%', background: 'linear-gradient(90deg,#23b978,#3ee39a)' }} />
        </div>
      </div>

      {/* Fields */}
      <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="journal-fields">
          {JOURNAL_FIELDS.map((f) => (
            <div key={f.key}>
              <label style={fieldLabel}>{f.label}</label>
              <textarea
                value={draft[f.key]} onChange={(e) => set(f.key)(e.target.value)}
                placeholder={f.placeholder} rows={4}
                style={{ ...controlStyle, resize: 'vertical', lineHeight: 1.6, minHeight: 92 }}
              />
            </div>
          ))}
        </div>

        <div className="journal-meta">
          <div>
            <label style={fieldLabel}>Planned Risk : Reward</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min="0" step="any" value={draft.planned_rr_risk}
                onChange={(e) => set('planned_rr_risk')(e.target.value)} placeholder="1"
                style={{ ...controlStyle, width: 74, textAlign: 'center' }} />
              <span style={{ color: 'var(--text-3)', fontSize: 15 }}>:</span>
              <input type="number" min="0" step="any" value={draft.planned_rr_reward}
                onChange={(e) => set('planned_rr_reward')(e.target.value)} placeholder="2"
                style={{ ...controlStyle, width: 74, textAlign: 'center' }} />
              <span className="mono" style={{ fontSize: 13, color: 'var(--mint)', marginLeft: 4 }}>
                {fmtPlannedRatio(draft.planned_rr_risk, draft.planned_rr_reward)}
              </span>
            </div>
          </div>

          <div>
            <label style={fieldLabel}>Rating</label>
            <RatingSlider value={draft.journal_rating} onChange={set('journal_rating')} />
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function initialDraft(trade) {
  return {
    ...Object.fromEntries(JOURNAL_FIELDS.map((f) => [f.key, trade[f.key] ?? ''])),
    planned_rr_risk: trade.planned_rr_risk ?? '',
    planned_rr_reward: trade.planned_rr_reward ?? '',
    journal_rating: journalRating(trade),
  }
}

const controlStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 10, fontSize: 13,
  background: 'var(--input-bg)', border: '1px solid var(--stroke)',
  color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
}

const fieldLabel = {
  display: 'block', fontSize: 11.5, fontWeight: 600,
  color: 'var(--text-2)', marginBottom: 7,
}

const ghostButton = {
  borderRadius: 10, fontSize: 12.5, color: 'var(--text-2)',
  border: '1px solid var(--stroke)', background: 'var(--card-2)',
}
