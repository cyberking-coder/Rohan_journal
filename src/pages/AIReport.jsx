import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PageHeader } from '../components/common'
import { usePrefs } from '../lib/theme'
import { formatDateTime, resolveTimezone } from '../lib/format'
import { useAiReports } from '../lib/useAiReports'
import {
  MIN_TRADES, canGenerate, formatReset, quotaState, shapeReport, toneMeta,
} from '../lib/aiReport'

export default function AIReport({ trades = [] }) {
  const { timezone } = usePrefs()
  const tz = resolveTimezone(timezone)
  const { reports, loading, error, ready, generating, generate, remove, clearError } = useAiReports()

  const [now, setNow] = useState(() => Date.now())
  const [openId, setOpenId] = useState(null)

  // The reset timer is shown in minutes at its finest, so a minute tick is
  // plenty — anything faster is just re-rendering for the sake of it.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  const shaped = useMemo(() => reports.map(shapeReport).filter(Boolean), [reports])
  const quota = useMemo(() => quotaState(reports, now), [reports, now])
  const gate = canGenerate({ trades, quota, generating })

  const latest = shaped[0] || null
  const older = shaped.slice(1)

  // A freshly generated report should be open, not collapsed behind a click.
  useEffect(() => { if (latest && openId === null) setOpenId(latest.id) }, [latest, openId])

  const onGenerate = async () => {
    const report = await generate(trades)
    if (report) setOpenId(report.id)
  }

  return (
    <>
      <PageHeader eyebrow="Performance Review" title="AI Report">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
              {quota.remaining} / {quota.limit} left
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
              resets in {formatReset(quota.resetsIn)} (Mon, UTC)
            </div>
          </div>
          <motion.button whileTap={{ scale: 0.96 }} onClick={onGenerate} disabled={!gate.ok}
            title={gate.ok ? 'Write a new report from your trade history' : gate.reason}
            style={{
              padding: '11px 18px', borderRadius: 12, fontWeight: 600, fontSize: 13.5,
              background: gate.ok ? 'linear-gradient(120deg, #3ee39a, #23b978)' : 'var(--card-2)',
              color: gate.ok ? '#04140d' : 'var(--text-3)',
              border: gate.ok ? 'none' : '1px solid var(--stroke)',
              cursor: gate.ok ? 'pointer' : 'not-allowed',
              boxShadow: gate.ok ? '0 10px 26px -10px rgba(47,212,138,0.7)' : 'none',
            }}>
            {generating ? 'Writing…' : '✦ Generate report'}
          </motion.button>
        </div>
      </PageHeader>

      {!gate.ok && !generating && (
        <div style={{ marginBottom: 14, fontSize: 12.5, color: 'var(--text-3)' }}>{gate.reason}</div>
      )}

      {error && (
        <div onClick={clearError} style={{
          marginBottom: 14, padding: '11px 14px', borderRadius: 11, fontSize: 12.5, cursor: 'pointer',
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>{error}</div>
      )}

      {!loading && !ready && (
        <SetupNote />
      )}

      {generating && <Writing />}

      {!loading && ready && !latest && !generating && (
        <div className="card" style={{ padding: 34, textAlign: 'center' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>✦</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No reports yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
            A report reads your closed trades <em>and</em> your journal entries, then tells you
            what it sees — including the parts you would rather it didn’t. It needs at
            least {MIN_TRADES} trades, and the journal notes are what make it worth reading.
          </div>
        </div>
      )}

      {latest && (
        <ReportCard report={latest} tz={tz} expanded featured onDelete={() => remove(latest.id)} />
      )}

      {older.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Earlier reports</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {older.map((r) => (
              <ReportCard key={r.id} report={r} tz={tz}
                expanded={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                onDelete={() => remove(r.id)} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function ReportCard({ report, tz, expanded, featured = false, onToggle, onDelete }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <motion.section className="card"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      style={{ padding: featured ? 24 : 16, overflow: 'hidden' }}>
      <div onClick={onToggle}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 14, cursor: onToggle ? 'pointer' : 'default' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            fontFamily: 'var(--display)', fontWeight: 700, letterSpacing: '-0.01em',
            fontSize: featured ? 23 : 16, lineHeight: 1.25,
          }}>{report.title}</h2>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5 }}>
            {report.createdAt ? formatDateTime(report.createdAt, { timezone: tz }) : '—'}
            {report.tradeCount ? ` · ${report.tradeCount} trades` : ''}
            {report.periodEnd ? ` · through ${new Date(report.periodEnd).toISOString().slice(0, 10)}` : ''}
          </div>
          {report.summary && (
            <p style={{
              marginTop: 10, fontSize: featured ? 14.5 : 13, color: 'var(--text-2)', lineHeight: 1.6,
            }}>{report.summary}</p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (confirming) { onDelete(); return }
              setConfirming(true)
              setTimeout(() => setConfirming(false), 2600)
            }}
            title={confirming ? 'Click again to delete' : 'Delete report'}
            style={{ fontSize: 12, color: confirming ? 'var(--red)' : 'var(--text-3)' }}>
            {confirming ? 'Delete?' : '✕'}
          </button>
          {onToggle && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{expanded ? '▴' : '▾'}</span>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && report.sections.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 18 }}>
              {report.sections.map((s, i) => {
                const meta = toneMeta(s.tone)
                return (
                  <div key={i} style={{ borderLeft: `2px solid ${meta.color}`, paddingLeft: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <h3 style={{ fontSize: 13.5, fontWeight: 650 }}>{s.heading}</h3>
                      <span style={{
                        fontSize: 8.5, letterSpacing: '0.06em', textTransform: 'uppercase',
                        padding: '2px 6px', borderRadius: 4, color: meta.color,
                        border: `1px solid ${meta.color}`, opacity: 0.75,
                      }}>{meta.label}</span>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65 }}>{s.body}</p>
                  </div>
                )
              })}
            </div>
            {report.model && (
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 16 }}>
                Written by {report.model}. It reads your data, not the market — treat it as a second opinion on your own notes.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

function Writing() {
  return (
    <div className="card" style={{ padding: 30, textAlign: 'center' }}>
      <motion.div
        animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 1.6, repeat: Infinity }}
        style={{ fontSize: 28, marginBottom: 10 }}>✦</motion.div>
      <div style={{ fontWeight: 600, marginBottom: 5 }}>Reading your journal…</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
        This takes a while — it’s thinking about every trade, not skimming.
      </div>
    </div>
  )
}

function SetupNote() {
  return (
    <div className="card" style={{ padding: 22, lineHeight: 1.65, fontSize: 13, color: 'var(--text-2)' }}>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Reports aren’t set up yet</div>
      <p style={{ marginBottom: 10 }}>
        Generation runs server-side so the API key never reaches the browser. Two steps:
      </p>
      <ol style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li>Run <code className="mono">supabase/phase7.sql</code> in the SQL editor.</li>
        <li>
          Set the key and deploy the function:
          <div className="mono" style={{
            marginTop: 6, padding: '9px 11px', borderRadius: 8, fontSize: 11.5,
            background: 'var(--hex-bg)', color: 'var(--text-2)', overflowX: 'auto', whiteSpace: 'pre',
          }}>{`supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy generate-report`}</div>
        </li>
      </ol>
    </div>
  )
}
