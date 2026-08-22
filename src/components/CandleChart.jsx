import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../lib/theme'

/**
 * Candlestick chart, hand-drawn in SVG.
 *
 * Recharts has no candlestick primitive, and faking one out of stacked bars
 * fights the library the whole way. Direct SVG is less code and gives exact
 * control over the level lines and the entry markers, which is what the
 * replay actually needs.
 *
 * Only the visible window is rendered, so a 75,000-candle file costs the same
 * to draw as a 200-candle one.
 */
export default function CandleChart({
  candles, positions = [], markers = [], height = 380, pending = null,
  // ICT overlays. Passed in already computed rather than derived here, so the
  // chart never sees candles the replay cursor hasn't revealed — the
  // look-ahead boundary stays in one place (src/lib/ict.js).
  ict = null, offset = 0,
}) {
  const { theme } = useTheme()
  const dark = theme !== 'light'

  const c = {
    up: dark ? '#2fd48a' : '#14a86a',
    down: dark ? '#ff6b6b' : '#d64545',
    grid: dark ? '#161d1c' : '#e4ebe7',
    axis: dark ? '#5c6a64' : '#7d8b84',
    sl: dark ? '#ff6b6b' : '#d64545',
    tp: dark ? '#2fd48a' : '#14a86a',
    entry: dark ? '#5aa9e6' : '#2f7fb8',
  }

  // The viewBox is sized to the element's real width so one SVG unit is one
  // CSS pixel. A fixed-width viewBox scaled to fit shrinks the axis text with
  // it — at phone width a 10px label renders at about 3px — and
  // preserveAspectRatio="none" stretches the candle bodies out of shape on
  // the way. Measuring costs one observer and fixes both.
  const wrapRef = useRef(null)
  const [measured, setMeasured] = useState(1000)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setMeasured(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = measured
  const H = height
  const padR = 68
  const padB = 22
  const padT = 8

  const view = useMemo(() => {
    if (!candles.length) return null

    let lo = Infinity
    let hi = -Infinity
    for (const k of candles) {
      if (k.l < lo) lo = k.l
      if (k.h > hi) hi = k.h
    }
    // Levels outside the candle range still have to be visible, or a stop
    // sitting just off-screen looks like it isn't set at all.
    for (const p of positions) {
      for (const level of [p.entry, p.stopLoss, p.takeProfit]) {
        if (level == null) continue
        if (level < lo) lo = level
        if (level > hi) hi = level
      }
    }
    if (pending != null && Number.isFinite(pending)) {
      if (pending < lo) lo = pending
      if (pending > hi) hi = pending
    }

    const span = hi - lo || hi * 0.001 || 1
    const pad = span * 0.08
    lo -= pad
    hi += pad

    const plotW = W - padR
    const plotH = H - padB - padT
    const bw = plotW / candles.length

    return {
      lo, hi, bw, plotW, plotH,
      x: (i) => i * bw + bw / 2,
      y: (price) => padT + (1 - (price - lo) / (hi - lo)) * plotH,
    }
    // W belongs here: every x-coordinate is derived from it, so leaving it out
    // pins the geometry to the pre-measurement default and the candles are
    // drawn to a width the viewBox doesn't have.
  }, [candles, positions, pending, H, W])

  if (!view) {
    return (
      <div ref={wrapRef} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        Load candles to begin.
      </div>
    )
  }

  const { x, y, bw } = view
  // Detector indices are absolute into the full series; the chart draws a
  // window. Anything before the window is clamped to its left edge so a gap
  // that started off-screen still shows where it sits in price.
  const xi = (i) => x(Math.max(0, Math.min(candles.length - 1, i - offset)))
  // Below about 3px a body is thinner than its own wick; drawing the wick
  // alone reads better than a smear of overlapping rectangles.
  const bodyW = Math.max(1, Math.min(bw * 0.7, 14))
  const gridLines = 5

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height}
      style={{ display: 'block', overflow: 'visible' }}>
      {/* ICT overlays, drawn under the candles so price stays readable. An
          overlay that obscures the thing it annotates is worse than none. */}
      {ict && (
        <g>
          {ict.openFvgs?.map((g) => {
            const top = y(g.top)
            const bottom = y(g.bottom)
            const left = xi(g.index)
            return (
              <g key={g.id}>
                <rect
                  x={left} y={Math.min(top, bottom)}
                  width={Math.max(2, W - padR - left)} height={Math.abs(bottom - top)}
                  fill={g.direction === 'bullish' ? c.up : c.down}
                  opacity={g.status === 'filled' ? 0.06 : 0.13}
                />
              </g>
            )
          })}

          {ict.levels?.filter((l) => l.status !== 'broken').map((l, i) => (
            <g key={`${l.type}-${i}`}>
              <line
                x1={xi(l.confirmedAt)} x2={W - padR} y1={y(l.price)} y2={y(l.price)}
                stroke={c.axis} strokeWidth={1}
                strokeDasharray={l.status === 'swept' ? '1 3' : '4 3'}
                opacity={l.status === 'swept' ? 0.45 : 0.75}
              />
              <text x={xi(l.confirmedAt) + 4} y={y(l.price) - 4} fill={c.axis} fontSize={9}>
                {l.type.replace('-', ' ')}{l.status === 'swept' ? ' · swept' : ''}
              </text>
            </g>
          ))}

          {ict.structure?.map((e, i) => (
            <g key={`st-${i}`}>
              <line
                x1={xi(e.index) - bw} x2={xi(e.index) + bw} y1={y(e.price)} y2={y(e.price)}
                stroke={e.direction === 'bullish' ? c.up : c.down} strokeWidth={1.5}
              />
              <text
                x={xi(e.index)} y={y(e.price) + (e.direction === 'bullish' ? -6 : 12)}
                fill={e.direction === 'bullish' ? c.up : c.down}
                fontSize={8.5} fontWeight={700} textAnchor="middle"
              >{e.kind.toUpperCase()}</text>
            </g>
          ))}
        </g>
      )}

      {/* Price grid */}
      {Array.from({ length: gridLines }, (_, i) => {
        const price = view.lo + ((view.hi - view.lo) * i) / (gridLines - 1)
        const py = y(price)
        return (
          <g key={i}>
            <line x1={0} x2={W - padR} y1={py} y2={py} stroke={c.grid} strokeWidth={1} />
            <text x={W - padR + 6} y={py + 3.5} fill={c.axis} fontSize={10} fontFamily="ui-monospace, monospace">
              {fmtPrice(price)}
            </text>
          </g>
        )
      })}

      {/* Candles */}
      {candles.map((k, i) => {
        const up = k.c >= k.o
        const colour = up ? c.up : c.down
        const cx = x(i)
        const yo = y(k.o)
        const yc = y(k.c)
        return (
          <g key={k.t}>
            <line x1={cx} x2={cx} y1={y(k.h)} y2={y(k.l)} stroke={colour} strokeWidth={1} />
            <rect
              x={cx - bodyW / 2}
              y={Math.min(yo, yc)}
              width={bodyW}
              // A doji has zero body height and would vanish entirely; 1px
              // keeps it on the chart as the flat bar it is.
              height={Math.max(1, Math.abs(yc - yo))}
              fill={colour}
            />
          </g>
        )
      })}

      {/* Open position levels */}
      {positions.map((p) => (
        <g key={p.id}>
          <Level y={y(p.entry)} W={W - padR} colour={c.entry} label={`${p.side} ${p.lots}`} dash="4 3" />
          {p.stopLoss != null && <Level y={y(p.stopLoss)} W={W - padR} colour={c.sl} label="SL" dash="3 3" />}
          {p.takeProfit != null && <Level y={y(p.takeProfit)} W={W - padR} colour={c.tp} label="TP" dash="3 3" />}
        </g>
      ))}

      {/* The price being typed into the ticket, so a level can be placed by eye */}
      {pending != null && Number.isFinite(pending) && (
        <Level y={y(pending)} W={W - padR} colour={c.axis} label="" dash="2 4" />
      )}

      {/* Closed-trade markers */}
      {markers.map((m, i) => {
        const idx = candles.findIndex((k) => k.t === m.at)
        if (idx < 0) return null
        return (
          <g key={i}>
            <circle cx={x(idx)} cy={y(m.price)} r={3.5}
              fill={m.win ? c.up : c.down} stroke={dark ? '#0b0f0e' : '#fff'} strokeWidth={1.2} />
          </g>
        )
      })}

      {/* Time axis: first, middle and last only — anything denser collides */}
      {(W < 420 ? [0, candles.length - 1] : [0, Math.floor(candles.length / 2), candles.length - 1])
        .filter((i, n, arr) => i >= 0 && arr.indexOf(i) === n)
        .map((i) => (
          <text key={i} x={x(i)} y={H - 6} fill={c.axis} fontSize={10}
            textAnchor={i === 0 ? 'start' : i === candles.length - 1 ? 'end' : 'middle'}
            fontFamily="ui-monospace, monospace">
            {new Date(candles[i].t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </text>
        ))}
    </svg>
    </div>
  )
}

function Level({ y, W, colour, label, dash }) {
  return (
    <>
      <line x1={0} x2={W} y1={y} y2={y} stroke={colour} strokeWidth={1} strokeDasharray={dash} opacity={0.85} />
      {label && (
        <text x={4} y={y - 4} fill={colour} fontSize={9.5} fontFamily="ui-monospace, monospace">{label}</text>
      )}
    </>
  )
}

// Price precision varies by instrument — 5 decimals on EURUSD, 2 on gold,
// none on an index. Deriving it from the magnitude beats hardcoding a table.
function fmtPrice(p) {
  if (p >= 1000) return p.toFixed(1)
  if (p >= 100) return p.toFixed(2)
  if (p >= 10) return p.toFixed(3)
  return p.toFixed(5)
}
