import { motion } from 'framer-motion'

/**
 * What the ICT engine can see at the replay cursor — PRD §56–59.
 *
 * The framing matters as much as the content. Everything here is described as
 * "what is on the chart right now", never as a signal, because a panel that
 * reads like an instruction gets followed. The confluence block is the §59
 * example — HTF bias, a sweep, a gap, the right half of the range — reported
 * as which pieces are present, so a trader can see three of four and decide
 * for themselves whether that is enough.
 */
export default function IctPanel({ picture, align, enabled }) {
  if (!enabled) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.7, maxWidth: 540 }}>
        Off. Turn it on to mark fair value gaps, liquidity levels and structure breaks on
        the chart as you step through. Nothing is computed from candles the cursor hasn’t
        reached — a level that only forms later stays invisible until it does.
      </p>
    )
  }

  if (!picture) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Load candles to begin.</p>
  }

  const openGaps = picture.openFvgs.filter((g) => g.status === 'open')
  const sweeps = picture.sweeps

  return (
    <>
      {align && align.bias && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Confluence
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
              {align.met} of {align.parts.length} present
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {align.parts.map((p, i) => (
              <motion.div key={p.name}
                initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                style={{ display: 'flex', alignItems: 'baseline', gap: 9, fontSize: 12 }}>
                <span style={{
                  width: 14, textAlign: 'center',
                  color: p.met ? 'var(--mint)' : 'var(--text-3)',
                }}>{p.met ? '●' : '○'}</span>
                <span style={{ color: p.met ? 'var(--text-2)' : 'var(--text-3)', minWidth: 118 }}>{p.name}</span>
                {/* Every row explains itself whether met or not: a bare cross
                    tells the trader nothing about what is missing. */}
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.detail}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 11 }}>
        <Cell label="Structure" value={picture.bias ? picture.bias : 'unset'}
          sub={lastBreak(picture)} tone={picture.bias} />
        <Cell label="Open FVGs" value={String(openGaps.length)}
          sub={openGaps.length ? `${openGaps.filter((g) => g.direction === 'bullish').length} bullish` : 'none unfilled'} />
        <Cell label="Liquidity" value={String(picture.levels.filter((l) => l.status === 'open').length)}
          sub={sweeps.length ? `${sweeps.length} swept` : 'none swept yet'} />
        <Cell label="Range" value={picture.range ? picture.range.zone : '—'}
          sub={picture.range ? `${(picture.range.position * 100).toFixed(0)}% of range` : 'no swings yet'} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 14 }}>
        {picture.htf.map((h) => (
          <div key={h.minutes} style={{ display: 'flex', alignItems: 'baseline', gap: 9, fontSize: 12 }}>
            <span className="mono" style={{ color: 'var(--text-3)', minWidth: 42 }}>
              {h.minutes >= 60 ? `${h.minutes / 60}H` : `${h.minutes}M`}
            </span>
            <span style={{ color: toneColor(h.bias), fontWeight: 600 }}>{h.bias || '—'}</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{h.reason}</span>
          </div>
        ))}
      </div>

      {/* The §59 guarantee, said where it can be checked rather than only in
          the source. A trader who does not believe a replay is honest will not
          trust anything built on it. */}
      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.6 }}>
        Higher-timeframe bias uses closed candles only — the 4H candle forming right now
        is withheld until it closes, so nothing here can see further ahead than you can.
      </p>
    </>
  )
}

function lastBreak(picture) {
  const last = picture.structure[picture.structure.length - 1]
  if (!last) return 'no break yet'
  return `${last.kind.toUpperCase()} at ${last.price.toFixed(5)}`
}

function toneColor(bias) {
  if (bias === 'bullish') return 'var(--mint)'
  if (bias === 'bearish') return 'var(--red)'
  return 'var(--text-3)'
}

function Cell({ label, value, sub, tone }) {
  return (
    <div style={{ padding: '11px 13px', borderRadius: 10, background: 'var(--card-2)' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        {label}
      </div>
      <div style={{
        fontSize: 15, fontWeight: 700, marginTop: 4, textTransform: 'capitalize',
        color: toneColor(tone),
      }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}
