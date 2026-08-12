// The spec puts a scrolling economic-events ticker at the bottom of the
// Dashboard. The events themselves come from the calendar feed, which is
// phase 6 and gated on a data-provider decision.
//
// Rather than scroll invented headlines — which on a trading app would be
// actively dangerous, since a trader might act on them — this renders the
// real chrome with an honest empty state.

export default function NewsTicker() {
  return (
    <div className="card" style={{
      marginTop: 14, padding: '12px 18px', display: 'flex',
      alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '4px 8px',
        borderRadius: 5, color: 'var(--text-3)', border: '1px solid var(--stroke)',
        flexShrink: 0,
      }}>ECONOMIC CALENDAR</span>

      <span style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, minWidth: 0 }}>
        High-impact events, forecasts and countdowns appear here once the calendar feed is
        connected — that’s phase 6, and it needs a data provider chosen first.
      </span>
    </div>
  )
}
