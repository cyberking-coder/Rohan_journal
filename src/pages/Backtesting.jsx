import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, Panel } from '../components/common'
import Money from '../components/Money'
import CandleChart from '../components/CandleChart'
import { ASSET_GROUPS } from '../lib/instruments'
import { computeAnalytics } from '../lib/analytics'
import {
  ambiguityReport, detectTimeframe, floatingPnl, indexAtOrBefore, parseCandles,
  positionPnl, replay, toTradeRows, validateOrder,
} from '../lib/backtest'
import { TF_ORDER, useCandleSets, useCandles } from '../lib/useCandles'

// How many candles are visible at once. Enough context to read structure
// without shrinking bodies to a smear.
const WINDOW = 120
const SPEEDS = [
  { label: '0.5×', ms: 1600 },
  { label: '1×', ms: 800 },
  { label: '2×', ms: 400 },
  { label: '4×', ms: 200 },
  { label: '10×', ms: 80 },
]

export default function Backtesting() {
  // Two sources of candles: whatever the bridge has uploaded, or a file. The
  // uploaded path is the normal one — it needs no file and can switch
  // timeframe mid-session.
  const { sets, symbols, loading: setsLoading, ready: setsReady, refresh } = useCandleSets()

  const [symbol, setSymbol] = useState(null)
  const [timeframe, setTimeframe] = useState(null)
  const { candles: stored, loading: candlesLoading, error: storeError } = useCandles(symbol, timeframe)

  const [fileCandles, setFileCandles] = useState(null)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)

  // A file, once loaded, wins — the user just asked for it explicitly.
  const candles = fileCandles ?? stored

  // The index of the last revealed candle. Everything after it is the future
  // and must never be visible — that's the whole discipline a replay enforces.
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  // The record of what the trader DID. Everything else — which stops were hit,
  // what the P&L came to — is derived from this plus the candles, so rewinding
  // and changing timeframe both reproduce the session exactly.
  const [actions, setActions] = useState([])

  const fileRef = useRef(null)

  const visible = useMemo(
    () => candles.slice(Math.max(0, cursor - WINDOW + 1), cursor + 1),
    [candles, cursor],
  )
  const current = candles[cursor] || null
  const atEnd = cursor >= candles.length - 1

  // Recomputed from scratch on every change. For the few hundred bars a replay
  // covers this is far cheaper than the bugs that incremental state invites —
  // and it's what makes scrubbing and timeframe changes exact rather than
  // approximate.
  const { open, closed } = useMemo(
    () => replay(candles, actions, cursor),
    [candles, actions, cursor],
  )

  // ── Advancing ────────────────────────────────────────────────────────────
  // Just moves the cursor; the fills follow from `replay` above.
  const advance = useCallback(() => {
    setCursor((prev) => (prev + 1 >= candles.length ? prev : prev + 1))
  }, [candles.length])

  useEffect(() => {
    if (!playing || !candles.length) return
    if (atEnd) { setPlaying(false); return }
    const id = setInterval(advance, SPEEDS[speed].ms)
    return () => clearInterval(id)
  }, [playing, speed, advance, atEnd, candles.length])

  // ── Loading ──────────────────────────────────────────────────────────────
  const loadFile = async (file) => {
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const parsed = parseCandles(text)
      setMeta({
        file: file.name,
        skipped: parsed.skipped,
        duplicates: parsed.duplicates,
        timeframe: detectTimeframe(parsed.candles),
        from: parsed.candles[0].t,
        to: parsed.candles[parsed.candles.length - 1].t,
      })
      // Start with a screen of history rather than a single candle — a chart
      // with one bar on it tells you nothing about where price has been.
      setFileCandles(parsed.candles)
      setCursor(Math.min(WINDOW - 1, parsed.candles.length - 1))
      setActions([])
      setPlaying(false)
      const guess = file.name.toUpperCase().match(/[A-Z]{6}|XAU[A-Z]{3}|US30|NAS100/)
      if (guess) setSymbol(guess[0])
      setTimeframe(detectTimeframe(parsed.candles))
    } catch (e) {
      setError(e.message)
      setFileCandles(null)
      setMeta(null)
    }
  }

  // Pick the first available set once the list arrives, so the page opens
  // ready to replay rather than asking a question it can answer itself.
  useEffect(() => {
    if (symbol || fileCandles || !sets.length) return
    setSymbol(sets[0].symbol)
    setTimeframe(sets[0].timeframe)
  }, [sets, symbol, fileCandles])

  // A fresh series needs the cursor placed inside it.
  const seriesKey = fileCandles ? 'file' : `${symbol}|${timeframe}`
  const lastSeries = useRef(null)
  useEffect(() => {
    if (!candles.length) return

    if (lastSeries.current !== seriesKey) {
      lastSeries.current = seriesKey
      setCursor((prev) => (prev > 0 && prev < candles.length ? prev : Math.min(WINDOW - 1, candles.length - 1)))
      return
    }

    // Clamped on every length change, not only when the series key changes.
    // The key changes a render before the new candles arrive, so the first
    // pass sees the OLD array — switching from 1,600 M15 bars to a 200-bar
    // symbol left the cursor at 509, past the end, and the chart had no
    // current bar at all.
    setCursor((prev) => Math.min(prev, candles.length - 1))
  }, [candles.length, seriesKey])

  /**
   * Switching timeframe keeps your place in TIME, not in bar count.
   *
   * The same instant is a different index in a different series — jumping to
   * the same index would silently move you weeks. Your orders carry absolute
   * timestamps, so `replay` re-derives the identical session at the new
   * resolution, and a finer timeframe genuinely resolves fills the coarser one
   * could only guess at.
   */
  const changeTimeframe = (tf) => {
    const at = current?.t ?? null
    setPlaying(false)
    setFileCandles(null)
    setTimeframe(tf)
    if (at !== null) pendingMoment.current = at
  }
  const pendingMoment = useRef(null)

  useEffect(() => {
    if (pendingMoment.current === null || !candles.length) return
    const i = indexAtOrBefore(candles, pendingMoment.current)
    pendingMoment.current = null
    if (i >= 0) setCursor(i)
  }, [candles])

  const changeSymbol = (next) => {
    setPlaying(false)
    setFileCandles(null)
    setSymbol(next)
    setActions([])
    // Timeframes available for one symbol may not exist for another.
    const available = sets.filter((s) => s.symbol === next).map((s) => s.timeframe)
    if (!available.includes(timeframe)) setTimeframe(available[0] ?? null)
  }

  const reset = () => {
    setCursor(Math.min(WINDOW - 1, candles.length - 1))
    setActions([])
    setPlaying(false)
  }

  // ── Trading ──────────────────────────────────────────────────────────────
  // Both record an action; the resulting positions come back out of `replay`.
  const place = (order) => {
    if (!current) return
    setActions((prev) => [...prev, {
      type: 'open', at: current.t,
      order: { ...order, symbol, entry: current.c },
    }])
  }

  const closeNow = (position) => {
    if (!current) return
    setActions((prev) => [...prev, { type: 'close', at: current.t, id: position.id }])
  }

  const timeframesFor = useMemo(() => {
    const list = sets.filter((s) => s.symbol === symbol).map((s) => s.timeframe)
    return TF_ORDER.filter((tf) => list.includes(tf))
  }, [sets, symbol])

  const rows = useMemo(() => toTradeRows(closed), [closed])
  const stats = useMemo(() => computeAnalytics(rows, rows), [rows])
  const ambiguity = useMemo(() => ambiguityReport(closed), [closed])
  const floating = current ? floatingPnl(open, current.c) : 0

  return (
    <>
      <PageHeader eyebrow="Candle Replay" title="Backtesting">
        {candles.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                {cursor + 1} / {candles.length}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                {meta?.timeframe || 'candles'} · {symbol}
              </div>
            </div>
            <button onClick={reset} style={ghost} title="Back to the start">↺</button>
            <button onClick={() => fileRef.current?.click()} style={ghost} title="Load another file">⤒</button>
          </div>
        )}
      </PageHeader>

      <input ref={fileRef} type="file" accept=".csv,.txt,.json,.tsv" style={{ display: 'none' }}
        onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = '' }} />

      {error && (
        <div onClick={() => setError(null)} style={{
          marginBottom: 14, padding: '11px 14px', borderRadius: 11, fontSize: 12.5, cursor: 'pointer',
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>{error}</div>
      )}

      {candles.length === 0 ? (
        (setsLoading || candlesLoading)
          ? <div className="card" style={{ padding: 34, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Loading candles…</div>
          : <Loader onPick={() => fileRef.current?.click()} hasSets={sets.length > 0} ready={setsReady} />
      ) : (
        <>
          {/* Symbol and timeframe, when the data came from the journal rather
              than a file. Switching timeframe keeps your place in time. */}
          {!fileCandles && symbols.length > 0 && (
            <div className="card" style={{
              padding: 12, marginBottom: 14, display: 'flex', gap: 12,
              alignItems: 'center', flexWrap: 'wrap',
            }}>
              <select value={symbol || ''} onChange={(e) => changeSymbol(e.target.value)}
                style={{
                  background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)',
                  borderRadius: 9, padding: '7px 10px', fontSize: 13, fontWeight: 600,
                }}>
                {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>

              <div style={{ display: 'flex', gap: 3, background: 'var(--card-2)', borderRadius: 9, padding: 3 }}>
                {timeframesFor.map((tf) => (
                  <button key={tf} onClick={() => changeTimeframe(tf)}
                    title={`Switch to ${tf} — you keep your place in time`}
                    style={{
                      padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                      background: timeframe === tf ? 'var(--card-hover)' : 'transparent',
                      color: timeframe === tf ? 'var(--text)' : 'var(--text-3)',
                    }}>{tf}</button>
                ))}
              </div>

              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {candles.length.toLocaleString()} bars
              </span>

              <button onClick={refresh} style={{ ...ghost, marginLeft: 'auto' }} title="Re-check for newly uploaded candles">↻</button>
            </div>
          )}

          {meta && (meta.skipped > 0 || meta.duplicates > 0) && (
            <div style={{
              marginBottom: 12, padding: '9px 13px', borderRadius: 10, fontSize: 12,
              background: 'rgba(240,178,74,0.09)', border: '1px solid rgba(240,178,74,0.3)', color: 'var(--amber)',
            }}>
              {meta.skipped > 0 && `${meta.skipped} unusable row${meta.skipped === 1 ? '' : 's'} skipped. `}
              {meta.duplicates > 0 && `${meta.duplicates} duplicate timestamp${meta.duplicates === 1 ? '' : 's'} dropped.`}
            </div>
          )}

          <Panel title={symbol} delay={0.02} style={{ marginBottom: 14 }}
            right={current && (
              <span className="mono" style={{ fontSize: 12.5 }}>
                {new Date(current.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                {' · '}<span style={{ fontWeight: 600 }}>{current.c}</span>
              </span>
            )}>
            <CandleChart candles={visible} positions={open}
              markers={closed.map((t) => ({ at: t.closedAt, price: t.exit, win: t.pnl > 0 }))} />

            <Controls
              playing={playing} atEnd={atEnd} speed={speed}
              onPlay={() => setPlaying((p) => !p)} onStep={advance} onSpeed={setSpeed}
              cursor={cursor} total={candles.length}
              onScrub={(i) => {
                // Scrubbing replays from scratch. Jumping the cursor without
                // re-running the fills would leave positions that should have
                // been stopped out still open — the state has to be a pure
                // function of the candles seen so far.
                setPlaying(false)
                const target = Math.max(0, Math.min(i, candles.length - 1))
                let live = []
                const done = []
                for (let n = 1; n <= target; n++) {
                  const r = step(live, candles[n])
                  live = r.open
                  done.push(...r.closed)
                }
                setCursor(target)
                setOpen(live)
                setClosed(done)
              }}
            />
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Panel title="New Order" delay={0.04}>
              <Ticket price={current?.c} onPlace={place} symbol={symbol} onSymbol={setSymbol} />
            </Panel>

            <Panel title="Open Positions" delay={0.06}
              right={open.length > 0 && (
                <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                  <Money value={floating} digits={2} colored />
                </span>
              )}>
              {open.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '8px 0' }}>Nothing open.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {open.map((p) => (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
                      borderRadius: 9, background: 'var(--card-2)', fontSize: 12,
                    }}>
                      <span style={{ fontWeight: 600, color: p.side === 'Long' ? 'var(--mint)' : 'var(--red)' }}>
                        {p.side === 'Long' ? '↑' : '↓'} {p.lots}
                      </span>
                      <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>@ {p.entry}</span>
                      <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600 }}>
                        <Money value={current ? positionPnl(p, current.c) : 0} digits={2} colored />
                      </span>
                      <button onClick={() => closeNow(p)} style={{ fontSize: 11, color: 'var(--text-3)' }}>Close</button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Results" delay={0.08}
            right={<span style={{ fontSize: 11, color: 'var(--text-3)' }}>scored by the Analysis engine</span>}>
            {closed.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                No closed trades yet. Place an order and step forward.
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                  <Stat label="Net P&L" money={stats.totalPnl} colored />
                  <Stat label="Trades" value={String(stats.tradeCount)} />
                  <Stat label="Win rate" value={`${stats.winRate.toFixed(1)}%`} />
                  <Stat label="Profit factor" value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} />
                  <Stat label="Avg win" money={stats.avgWin} colored />
                  <Stat label="Avg loss" money={stats.avgLoss} colored />
                  <Stat label="Max DD" money={stats.maxDrawdown} colored />
                  <Stat label="Expectancy" money={stats.expectancy} colored />
                </div>

                {ambiguity.count > 0 && <AmbiguityNote report={ambiguity} />}
              </>
            )}
          </Panel>
        </>
      )}
    </>
  )
}

/**
 * The honest caveat. A backtest whose result rests on coin-flips should say so
 * loudly, in the same panel as the result — not in a footnote nobody reads.
 */
function AmbiguityNote({ report }) {
  return (
    <div style={{
      marginTop: 16, padding: '12px 14px', borderRadius: 11, fontSize: 12.5, lineHeight: 1.6,
      background: 'rgba(240,178,74,0.08)', border: '1px solid rgba(240,178,74,0.28)',
    }}>
      <strong style={{ color: 'var(--amber)' }}>
        {report.count} of {report.total} fills ({report.pct.toFixed(0)}%) couldn’t be settled by the data.
      </strong>
      <div style={{ color: 'var(--text-2)', marginTop: 5 }}>
        In those candles the price touched both your stop and your target, and OHLC bars
        can’t say which came first — that only exists in the ticks inside the bar. They
        were counted as <strong>stops</strong>, the pessimistic reading. Counting them all
        as targets instead would move the result by{' '}
        <span className="mono" style={{ fontWeight: 600 }}><Money value={report.swing} digits={2} /></span>.
        {report.pct > 30 && ' At this rate the result says more about the bar size than the strategy — try a lower timeframe.'}
      </div>
    </div>
  )
}

function Controls({ playing, atEnd, speed, onPlay, onStep, onSpeed, cursor, total, onScrub }) {
  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input type="range" min={0} max={Math.max(0, total - 1)} value={cursor}
        onChange={(e) => onScrub(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--mint)' }} aria-label="Scrub through history" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <motion.button whileTap={{ scale: 0.94 }} onClick={onPlay} disabled={atEnd}
          style={{
            padding: '8px 18px', borderRadius: 10, fontWeight: 600, fontSize: 13,
            background: atEnd ? 'var(--card-2)' : 'linear-gradient(120deg, #3ee39a, #23b978)',
            color: atEnd ? 'var(--text-3)' : '#04140d',
            cursor: atEnd ? 'not-allowed' : 'pointer',
          }}>{playing ? '❚❚ Pause' : '▶ Play'}</motion.button>

        <button onClick={onStep} disabled={atEnd} style={{ ...ghost, opacity: atEnd ? 0.4 : 1 }}>Step ›</button>

        <div style={{ display: 'flex', gap: 3, background: 'var(--card-2)', borderRadius: 9, padding: 3, marginLeft: 'auto' }}>
          {SPEEDS.map((s, i) => (
            <button key={s.label} onClick={() => onSpeed(i)}
              style={{
                padding: '5px 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
                background: speed === i ? 'var(--card-hover)' : 'transparent',
                color: speed === i ? 'var(--text)' : 'var(--text-3)',
              }}>{s.label}</button>
          ))}
        </div>
      </div>

      {atEnd && (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>End of the data.</div>
      )}
    </div>
  )
}

function Ticket({ price, onPlace, symbol, onSymbol }) {
  const [side, setSide] = useState('Long')
  const [lots, setLots] = useState('0.10')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')

  const problems = validateOrder({ side, lots, entry: price, stopLoss, takeProfit })
  const ready = price != null && problems.length === 0

  const submit = () => {
    if (!ready) return
    onPlace({ side, lots, stopLoss, takeProfit })
    setStopLoss('')
    setTakeProfit('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* The instrument decides contract size, and contract size decides P&L.
          Guessed from the filename where possible, but a file called
          "export.csv" would otherwise be priced as EURUSD — which values a
          gold trade at 1/1000th of the truth. */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Instrument</span>
        <select value={symbol} onChange={(e) => onSymbol(e.target.value)}
          style={{
            background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)',
            borderRadius: 9, padding: '8px 10px', fontSize: 13, width: '100%',
          }}>
          {ASSET_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => <option key={i} value={i}>{i}</option>)}
            </optgroup>
          ))}
          {/* A symbol guessed from a filename may not be in the list; without
              this it would silently reset to the first option. */}
          {!ASSET_GROUPS.some((g) => g.items.includes(symbol)) && (
            <option value={symbol}>{symbol}</option>
          )}
        </select>
      </label>

      <div style={{ display: 'flex', gap: 6 }}>
        {['Long', 'Short'].map((s) => (
          <button key={s} onClick={() => setSide(s)}
            style={{
              flex: 1, padding: '9px', borderRadius: 9, fontWeight: 600, fontSize: 13,
              border: `1px solid ${side === s ? (s === 'Long' ? 'var(--mint)' : 'var(--red)') : 'var(--stroke)'}`,
              color: side === s ? (s === 'Long' ? 'var(--mint)' : 'var(--red)') : 'var(--text-3)',
              background: side === s ? (s === 'Long' ? 'rgba(47,212,138,0.09)' : 'rgba(255,107,107,0.09)') : 'transparent',
            }}>{s === 'Long' ? '↑ Long' : '↓ Short'}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <Field label="Lots" value={lots} onChange={setLots} />
        <Field label="Stop" value={stopLoss} onChange={setStopLoss} placeholder="—" />
        <Field label="Target" value={takeProfit} onChange={setTakeProfit} placeholder="—" />
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        Fills at the current candle’s close: <span className="mono">{price ?? '—'}</span>
      </div>

      {/* Every problem at once, not one per attempt. */}
      {problems.length > 0 && price != null && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {problems.map((p) => <span key={p}>{p}</span>)}
        </div>
      )}

      <motion.button whileTap={{ scale: 0.97 }} onClick={submit} disabled={!ready}
        style={{
          padding: '10px', borderRadius: 10, fontWeight: 600, fontSize: 13,
          background: ready ? 'linear-gradient(120deg, #3ee39a, #23b978)' : 'var(--card-2)',
          color: ready ? '#04140d' : 'var(--text-3)',
          cursor: ready ? 'pointer' : 'not-allowed',
        }}>Place order</motion.button>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        inputMode="decimal" className="mono"
        style={{
          background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)',
          borderRadius: 9, padding: '8px 10px', fontSize: 13, width: '100%',
        }} />
    </label>
  )
}

function Stat({ label, value, money, colored }) {
  return (
    <div style={{ padding: '11px 13px', borderRadius: 10, background: 'var(--card-2)' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
        {money !== undefined ? <Money value={money} digits={2} colored={colored} /> : value}
      </div>
    </div>
  )
}

function Loader({ onPick, hasSets, ready }) {
  return (
    <div className="card" style={{ padding: 34 }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>⧗</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>No candles yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 540, margin: '0 auto', lineHeight: 1.65 }}>
          {hasSets
            ? 'That symbol and timeframe has no bars stored. Pick another, or upload more from the bridge.'
            : ready === false
              ? 'The candles table isn’t there yet — run supabase/phase8.sql, then upload from the bridge.'
              : 'Push history from your own MT5 terminal and it appears here automatically — no file, and you can switch timeframe mid-replay.'}
        </div>
      </div>

      <div className="mono" style={{
        maxWidth: 560, margin: '0 auto 22px', padding: '12px 14px', borderRadius: 10,
        background: 'var(--hex-bg)', color: 'var(--text-2)', fontSize: 11.5,
        overflowX: 'auto', whiteSpace: 'pre',
      }}>{`cd mt5_bridge
python export_candles.py --symbol XAUUSD --timeframes M5,M15,H1,H4 --days 365 --upload`}</div>

      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
        or replay a file you already have
      </div>

      <motion.button whileTap={{ scale: 0.97 }} onClick={onPick}
        style={{
          display: 'block', margin: '0 auto 24px', padding: '11px 22px', borderRadius: 11,
          fontWeight: 600, fontSize: 13.5, background: 'linear-gradient(120deg, #3ee39a, #23b978)', color: '#04140d',
        }}>Choose a file</motion.button>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, fontSize: 12, lineHeight: 1.6 }}>
        <How title="MetaTrader 5" body="Tools → History Center, pick the symbol and timeframe, then Export. Saves a tab-separated .csv." />
        <How title="TradingView" body="Open the chart, then the export icon above it → Export chart data. Saves a comma-separated .csv." />
        <How title="Anything else" body="Any file with time, open, high, low and close columns works — CSV, TSV or JSON, headers optional." />
      </div>
    </div>
  )
}

function How({ title, body }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 11, background: 'var(--card-2)', border: '1px solid var(--stroke)' }}>
      <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>{title}</div>
      <div style={{ color: 'var(--text-3)' }}>{body}</div>
    </div>
  )
}

const ghost = {
  padding: '8px 12px', borderRadius: 10, fontSize: 12.5,
  border: '1px solid var(--stroke)', color: 'var(--text-2)',
}
