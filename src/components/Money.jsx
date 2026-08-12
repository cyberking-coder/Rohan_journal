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
