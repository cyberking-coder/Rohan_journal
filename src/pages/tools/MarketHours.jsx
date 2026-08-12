import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import ToolPageShell from '../../components/ToolPageShell'
import {
  BEST_TIMES, MARKET_SESSIONS, cityOffsetLabel, cityTime, fmtTime,
  isMarketClosed, isSessionOpen, openSessions, sessionSegments,
  utcHour, utcHourToLocal, volumeLevel,
} from '../../lib/sessions'

export default function MarketHours({ onBack }) {
  const [now, setNow] = useState(() => new Date())
  const [use24h, setUse24h] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const hour = utcHour(now)
  const open = openSessions(now)
  const closed = isMarketClosed(now)

  return (
    <ToolPageShell
      icon="◷" title="Forex Market Hours" onBack={onBack}
      subtitle="Track trading sessions across the globe in real time."
      headerActions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 10, background: 'var(--card)', border: '1px solid var(--stroke)' }}>
            {[['12h', false], ['24h', true]].map(([label, v]) => (
              <button key={label} onClick={() => setUse24h(v)}
                style={{
                  padding: '5px 11px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
                  background: use24h === v ? 'var(--card-hover)' : 'transparent',
                  color: use24h === v ? 'var(--text)' : 'var(--text-3)',
                }}>{label}</button>
            ))}
          </div>
          <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{fmtTime(now, use24h)}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
              {now.toLocaleDateString(undefined, { weekday: 'short' })} · your local time
            </div>
          </div>
        </div>
      }
    >
      {/* Status banner */}
      <div className="card" style={{
        padding: '14px 18px', marginBottom: 14, display: 'flex',
        alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: closed ? 'var(--text-3)' : 'var(--mint)',
          boxShadow: closed ? 'none' : '0 0 0 4px rgba(47,212,138,0.15)',
        }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {closed ? 'Market closed for the weekend' : `${open.length} ${open.length === 1 ? 'session' : 'sessions'} open`}
        </span>
        {open.length > 0 && (
          <span style={{ fontSize: 15, letterSpacing: 2 }}>{open.map((s) => s.flag).join('')}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-3)' }} className="mono">
          {String(Math.floor(hour)).padStart(2, '0')}:{String(Math.floor((hour % 1) * 60)).padStart(2, '0')} UTC
        </span>
      </div>

      {/* Timeline */}
      <section className="card" style={{ padding: '20px 22px 22px', marginBottom: 14 }}>
        <Ruler />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {MARKET_SESSIONS.map((s) => (
            <SessionRow key={s.id} session={s} hour={hour} now={now} closed={closed} use24h={use24h} />
          ))}
        </div>
        <NowLineLegend hour={hour} />
      </section>

      <VolumeIndicator now={now} />

      {/* Best times */}
      <h3 style={{ fontFamily: 'var(--display)', fontSize: 15.5, fontWeight: 600, margin: '22px 0 12px' }}>
        Best Times to Trade
      </h3>
      <div className="best-times-grid">
        {BEST_TIMES.map((w) => (
          <BestTimeCard key={w.id} window={w} now={now} use24h={use24h} />
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.6 }}>
        Windows are shown in your local time, converted from the underlying UTC session hours.
      </p>
    </ToolPageShell>
  )
}

// Shared 24h UTC axis that every session bar is positioned against.
function Ruler() {
  const marks = [0, 4, 8, 12, 16, 20, 24]
  return (
    <div style={{ position: 'relative', height: 18, marginLeft: 108, marginBottom: 4 }}>
      {marks.map((m) => (
        <span key={m} style={{
          position: 'absolute', left: `${(m / 24) * 100}%`, top: 0,
          transform: m === 0 ? 'none' : m === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
          fontSize: 10, color: 'var(--text-3)',
        }} className="mono">{String(m % 24).padStart(2, '0')}</span>
      ))}
    </div>
  )
}

function SessionRow({ session, hour, now, closed, use24h }) {
  const isOpen = !closed && isSessionOpen(session, hour)
  const local = cityTime(session.zone, now)
  const offset = cityOffsetLabel(session.zone, now)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 96, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
          <span>{session.flag}</span>{session.city}
        </div>
        <div style={{ fontSize: 9.5, color: isOpen ? 'var(--mint)' : 'var(--text-3)', fontWeight: 600, letterSpacing: '0.04em' }}>
          {isOpen ? 'OPEN' : 'CLOSED'}
        </div>
      </div>

      {/* Track */}
      <div style={{
        position: 'relative', flex: 1, height: 26, borderRadius: 7,
        background: 'var(--track)', overflow: 'hidden',
      }}>
        {sessionSegments(session).map((seg, i) => (
          <div key={i} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${(seg.start / 24) * 100}%`,
            width: `${((seg.end - seg.start) / 24) * 100}%`,
            background: isOpen
              ? 'linear-gradient(120deg, rgba(62,227,154,0.85), rgba(35,185,120,0.7))'
              : 'var(--track-2)',
            transition: 'background 0.4s',
          }} />
        ))}
        {!closed && (
          <div style={{
            position: 'absolute', top: -2, bottom: -2, left: `${(hour / 24) * 100}%`,
            width: 2, background: 'var(--mint)', boxShadow: '0 0 8px rgba(47,212,138,0.9)',
          }} />
        )}
      </div>

      <div className="hide-mobile" style={{ width: 168, flexShrink: 0, textAlign: 'right', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{local ?? '—'}</div>
        <div style={{ fontSize: 10, color: 'var(--text-3)' }} className="mono">
          {offset ?? ''} · {String(session.open).padStart(2, '0')}:00–{String(session.close).padStart(2, '0')}:00 UTC
        </div>
      </div>
    </div>
  )
}

function NowLineLegend({ hour }) {
  return (
    <div style={{ marginLeft: 108, marginTop: 10, fontSize: 10.5, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 2, height: 10, background: 'var(--mint)', display: 'inline-block' }} />
      Now — {String(Math.floor(hour)).padStart(2, '0')}:{String(Math.floor((hour % 1) * 60)).padStart(2, '0')} UTC
    </div>
  )
}

function VolumeIndicator({ now }) {
  // Recomputed from `now` on every tick so it tracks session changes live.
  const { level, tone, note } = volumeLevel(now)
  const color = tone === 'good' ? 'var(--mint)' : tone === 'bad' ? 'var(--text-3)' : 'var(--amber)'

  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{
        padding: '5px 11px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, flexShrink: 0,
        color, border: `1px solid ${color}`, background: 'var(--card-2)',
      }}>{level}</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', minWidth: 0, flex: 1 }}>
        Expected trading volume — {note}
      </div>
    </div>
  )
}

function BestTimeCard({ window: w, now, use24h }) {
  const start = utcHourToLocal(w.startUtc, now)
  const end = utcHourToLocal(w.endUtc, now)
  const hour = utcHour(now)
  const active = hour >= w.startUtc && hour < w.endUtc && !isMarketClosed(now)

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="card"
      style={{
        padding: 18, display: 'flex', flexDirection: 'column', gap: 7,
        borderColor: active ? 'rgba(47,212,138,0.4)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--display)' }}>{w.title}</span>
        {active && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 6px',
            borderRadius: 5, color: 'var(--mint)', border: '1px solid rgba(47,212,138,0.4)',
          }}>NOW</span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{w.subtitle}</div>
      <div className="mono" style={{ fontSize: 13.5, color: 'var(--mint)', fontWeight: 600 }}>
        {fmtTime(start, use24h)} – {fmtTime(end, use24h)}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 2 }}>{w.description}</p>
    </motion.div>
  )
}
