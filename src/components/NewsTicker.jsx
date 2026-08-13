import { useEffect, useState } from 'react'
import { useEconomicEvents } from '../lib/useEconomicEvents'
import { usePrefs } from '../lib/theme'
import { resolveTimezone } from '../lib/format'
import { IMPACTS, countdown, currencyMeta, filterEvents } from '../lib/economicEvents'

// The spec's bottom-of-dashboard economic ticker. It shows real upcoming
// releases once the calendar is populated, and says so plainly when it isn't —
// inventing headlines on a trading app would be worse than useless, since a
// trader might act on them.
export default function NewsTicker({ limit = 6 }) {
  const { timezone } = usePrefs()
  const tz = resolveTimezone(timezone)
  const { events, loading, ready } = useEconomicEvents({ days: 7 })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  // High and medium impact only: a ticker of every low-impact print is noise.
  const upcoming = filterEvents(events, {
    tab: 'upcoming', impacts: ['high', 'medium'], timezone: tz, now,
  }).slice(0, limit)

  return (
    <div className="card" style={{
      marginTop: 14, padding: '11px 16px', display: 'flex',
      alignItems: 'center', gap: 14, overflowX: 'auto',
    }}>
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '4px 8px',
        borderRadius: 5, color: 'var(--text-3)', border: '1px solid var(--stroke)',
        flexShrink: 0, whiteSpace: 'nowrap',
      }}>ECONOMIC CALENDAR</span>

      {loading ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Loading…</span>
      ) : upcoming.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
          {ready
            ? 'No high-impact releases scheduled in the next few days.'
            : 'Not set up yet — apply supabase/phase6.sql and run calendar_bridge/ to populate it.'}
        </span>
      ) : upcoming.map((e) => {
        const impact = IMPACTS[e.impact] ?? IMPACTS.low
        const meta = currencyMeta(e.currency)
        return (
          <span key={e.id ?? `${e.event_at}-${e.title}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: impact.tone }} />
            <span style={{ fontSize: 13 }}>{meta.flag}</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{e.currency}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{e.title}</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
              {countdown(e, now)}
            </span>
          </span>
        )
      })}
    </div>
  )
}
