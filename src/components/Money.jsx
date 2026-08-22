import { usePrefs } from '../lib/theme'
import { formatMoney } from '../lib/format'

/**
 * A money figure in the user's display currency, blurred when Streamer Mode
 * is on. Hovering reveals it, so the person at the desk can still read their
 * own numbers while the stream can't.
 *
 * Use this anywhere a currency amount is rendered. For a value that is already
 * a formatted string, use `<Sensitive>` instead.
 */
export default function Money({ value, digits = 2, colored = false, className = '', style }) {
  const { currency } = usePrefs()
  const n = Number(value) || 0
  const color = colored ? (n >= 0 ? 'var(--mint)' : 'var(--red)') : undefined

  return (
    <Sensitive className={className} style={{ color, ...style }}>
      {formatMoney(n, { currency, digits })}
    </Sensitive>
  )
}

// Wraps any already-formatted sensitive text in the streamer-mode blur.
export function Sensitive({ children, className = '', style }) {
  const { streamerMode } = usePrefs()
  return (
    <span
      className={`${className} ${streamerMode ? 'sensitive' : ''}`.trim()}
      title={streamerMode ? 'Hidden by Streamer Mode — hover to reveal' : undefined}
      style={style}
    >{children}</span>
  )
}

/**
 * A money amount, or a risk multiple when `unit` says so.
 *
 * Shared dashboards can hide the owner's account size by expressing results in
 * R — each trade divided by their average loss. Those numbers must never be
 * rendered through `<Money>`: it would print a currency symbol on a value that
 * isn't currency, which is exactly the impression the owner asked not to give.
 *
 * Also skips the Streamer Mode blur in R mode, since a risk multiple reveals
 * nothing about account size — that being the whole point of it.
 */
export function Amount({ value, unit = 'money', digits = 2, colored = false, style }) {
  if (unit !== 'R') return <Money value={value} digits={digits} colored={colored} style={style} />

  const n = Number(value) || 0
  return (
    <span style={{ color: colored ? (n >= 0 ? 'var(--mint)' : 'var(--red)') : undefined, ...style }}>
      {n < 0 ? '−' : ''}{Math.abs(n).toFixed(digits)}R
    </span>
  )
}
