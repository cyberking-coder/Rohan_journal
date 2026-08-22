import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Logo } from '../components/Shell'
import { Panel } from '../components/common'
import TradeHistoryTable from '../components/TradeHistoryTable'
import { ComparisonBars, EquityDrawdown, MetricStrip } from '../components/AnalysisCharts'
import { useSharedView } from '../lib/useSharedView'
import { useQueryParam } from '../lib/router'
import {
  byDayOfWeek, bySession, bySymbol, computeAnalytics, maxDrawdown,
} from '../lib/analytics'

/**
 * A read-only dashboard opened from a share link.
 *
 * Rendered outside the signed-in app entirely: no sidebar, no navigation, no
 * way to reach anything else. The viewer is a guest looking at one page, and
 * the chrome should say so.
 */
export default function SharedView() {
  const [code] = useQueryParam('code')
  const { view, loading, notFound, error } = useSharedView(code)

  const trades = useMemo(() => (view?.trades || []).map(normalise), [view])
  const stats = useMemo(() => computeAnalytics(trades, trades), [trades])
  const dd = useMemo(() => maxDrawdown(trades), [trades])

  const has = (section) => Array.isArray(view?.sections) && view.sections.includes(section)
  // In R mode the numbers are risk multiples, not currency. Rendering them
  // through <Money> would stamp a dollar sign on them and undo the entire
  // point of hiding the amounts.
  const isR = view?.unit === 'R'
  const fmt = (n) => (isR
    ? `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(2)}R`
    : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{
        borderBottom: '1px solid var(--stroke)', padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <Logo />
        <span style={{
          fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: 'var(--text-3)', border: '1px solid var(--stroke)', borderRadius: 20, padding: '4px 11px',
        }}>Shared · read only</span>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 22px 70px' }}>
        {loading && <Centered>Opening the shared view…</Centered>}

        {!loading && notFound && (
          <Centered>
            <div style={{ fontSize: 30, marginBottom: 12 }}>🔒</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>This link doesn’t work</div>
            <p style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 380, lineHeight: 1.65 }}>
              It may have been revoked by its owner, expired, or copied incorrectly.
              Ask whoever sent it for a fresh one.
            </p>
          </Centered>
        )}

        {!loading && error && (
          <Centered>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--red)' }}>Couldn’t load this view</div>
            <p style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 420, lineHeight: 1.65 }}>{error}</p>
          </Centered>
        )}

        {view && (
          <>
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              style={{ marginBottom: 24 }}>
              <div className="eyebrow">Shared dashboard</div>
              <h1 style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 700, marginTop: 6 }}>
                {view.label}
              </h1>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
                {trades.length} trade{trades.length === 1 ? '' : 's'}
                {isR && ' · results shown in R multiples, not currency'}
                {view.expiresAt && ` · link expires ${new Date(view.expiresAt).toLocaleDateString()}`}
              </div>
            </motion.div>

            {has('overview') && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 13, marginBottom: 16 }}>
                <Stat label={isR ? 'Total (R)' : 'Total P&L'} value={fmt(stats.totalPnl)}
                  tone={stats.totalPnl >= 0 ? 'good' : 'bad'} />
                <Stat label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} />
                <Stat label="Profit Factor"
                  value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}
                  sub={stats.profitFactorLabel?.label} />
                <Stat label={isR ? 'Avg (R)' : 'Expectancy'} value={fmt(stats.expectancy)}
                  tone={stats.expectancy >= 0 ? 'good' : 'bad'} />
              </div>
            )}

            {has('performance') && (
              <Panel title="Performance" delay={0.04} style={{ marginBottom: 14 }}
                right={isR && <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>R multiples</span>}>
                <EquityDrawdown trades={trades} unit={view.unit} />
                <MetricStrip unit={view.unit} items={[
                  { label: 'Trades', value: String(stats.tradeCount) },
                  { label: 'Wins', value: String(stats.winCount) },
                  { label: 'Losses', value: String(stats.lossCount) },
                  { label: isR ? 'Best (R)' : 'Best', value: fmt(stats.bestTrade) },
                  { label: isR ? 'Worst (R)' : 'Worst', value: fmt(stats.worstTrade) },
                  { label: isR ? 'Max DD (R)' : 'Max DD', value: fmt(dd.amount) },
                  { label: 'Max DD %', value: dd.pct === null ? '—' : `${dd.pct.toFixed(1)}%` },
                  { label: 'Win streak', value: String(stats.winStreak) },
                ]} />
              </Panel>
            )}

            {has('performance') && trades.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>
                <Panel title="Top Symbols" delay={0.06}>
                  <ComparisonBars rows={bySymbol(trades)} labelKey="symbol" unit={view.unit} />
                </Panel>
                <Panel title="Day of Week" delay={0.08}>
                  <ComparisonBars rows={byDayOfWeek(trades)} unit={view.unit} />
                </Panel>
                <Panel title="Sessions" delay={0.1}>
                  <ComparisonBars rows={bySession(trades)} unit={view.unit} />
                </Panel>
              </div>
            )}

            {has('trades') && (
              <Panel title="Trades" delay={0.12} style={{ marginBottom: 14 }}>
                <TradeHistoryTable trades={trades} unit={view.unit} />
              </Panel>
            )}

            {has('reports') && (view.reports || []).length > 0 && (
              <Panel title="AI Reports" delay={0.14} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {view.reports.map((r) => (
                    <div key={r.id} style={{ padding: 14, borderRadius: 11, background: 'var(--card-2)' }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{r.title}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-3)', margin: '4px 0 8px' }}>
                        {new Date(r.createdAt).toLocaleDateString()} · {r.tradeCount} trades
                      </div>
                      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>{r.summary}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 22, lineHeight: 1.6 }}>
              A read-only view shared by its owner. Past results are not a prediction of
              future results.
            </p>
          </>
        )}
      </main>
    </div>
  )
}

/**
 * The shared payload names trades the way the database does; the analytics
 * engine expects the app's shape. Mapping here means every widget on this page
 * is the same code the owner sees, rather than a second implementation that
 * would eventually disagree with the first.
 */
function normalise(t) {
  return {
    ...t,
    id: t.id,
    pnl: Number(t.pnl) || 0,
    fees: Number(t.fees) || 0,
    rating: null,
    journal_rating: t.journal_rating ?? null,
    traded_at: t.traded_at,
  }
}

function Stat({ label, value, sub, tone }) {
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div className="mono" style={{
        fontSize: 23, fontWeight: 700, marginTop: 6,
        color: tone === 'good' ? 'var(--mint)' : tone === 'bad' ? 'var(--red)' : 'var(--text)',
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{sub}</div>}
    </motion.div>
  )
}

function Centered({ children }) {
  return (
    <div className="card" style={{
      padding: 44, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', color: 'var(--text-3)', fontSize: 13,
    }}>{children}</div>
  )
}
