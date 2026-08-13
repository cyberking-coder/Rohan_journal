import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PageHeader } from '../components/common'
import { usePrefs } from '../lib/theme'
import { resolveTimezone, timezoneCity, timezoneOffsetLabel } from '../lib/format'
import { useEconomicEvents } from '../lib/useEconomicEvents'
import {
  DAY_TABS, IMPACTS, IMPACT_KEYS, availableCurrencies, countdown, currencyMeta,
  filterEvents, groupByDay, isImminent, nextUpcoming, surprise,
} from '../lib/economicEvents'

export default function Market() {
  const { timezone } = usePrefs()
  const tz = resolveTimezone(timezone)
  const { events, loading, error, ready, refetch } = useEconomicEvents()

  const [tab, setTab] = useState('upcoming')
  const [impacts, setImpacts] = useState([])
  const [currency, setCurrency] = useState('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  // Countdowns are the point of this page, so they tick.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const filtered = useMemo(
    () => filterEvents(events, { tab, impacts, currency, query, timezone: tz, now }),
    [events, tab, impacts, currency, query, tz, now],
  )
  const days = useMemo(() => groupByDay(filtered, tz), [filtered, tz])
  const next = useMemo(() => nextUpcoming(filtered, now), [filtered, now])
  const currencies = useMemo(() => availableCurrencies(events), [events])

  const toggleImpact = (key) => setImpacts((prev) =>
    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])

  return (
    <>
      <PageHeader eyebrow="Economic Calendar" title="Market">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
              {new Date(now).toLocaleTimeString(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {/* "UTC GMT" reads as a mistake, so the offset is dropped when
                  it just restates the zone name. */}
              {timezoneCity(tz) === 'UTC' ? 'UTC' : `${timezoneCity(tz)} ${timezoneOffsetLabel(tz)}`}
            </div>
          </div>
          <button onClick={refetch} title="Refresh" style={ghost}>↻</button>
        </div>
      </PageHeader>

      {error && (
        <div style={{
          marginBottom: 14, padding: '11px 14px', borderRadius: 11, fontSize: 12.5,
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>Couldn’t load the calendar: {error}</div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--card-2)', borderRadius: 10, padding: 3, overflowX: 'auto' }}>
          {DAY_TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
                background: tab === t.key ? 'var(--card-hover)' : 'transparent',
                color: tab === t.key ? 'var(--text)' : 'var(--text-3)',
              }}>{t.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <ImpactPill label="All" active={impacts.length === 0} onClick={() => setImpacts([])} />
            {IMPACT_KEYS.map((k) => (
              <ImpactPill key={k} label={IMPACTS[k].label} tone={IMPACTS[k].tone}
                active={impacts.includes(k)} onClick={() => toggleImpact(k)} />
            ))}
          </div>

          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={control}>
            <option value="all">All countries</option>
            {currencies.map((c) => (
              <option key={c} value={c}>{currencyMeta(c).country} ({c})</option>
            ))}
          </select>

          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…" style={{ ...control, flex: 1, minWidth: 150 }} />

          <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            {filtered.length} of {events.length} events
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 54 }} />)}
        </div>
      ) : days.length === 0 ? (
        <EmptyState hasAnyEvents={events.length > 0} ready={ready} />
      ) : (
        days.map((day) => (
          <section key={day.key} style={{ marginBottom: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 9, padding: '0 4px 8px',
            }}>
              <span style={{ fontFamily: 'var(--display)', fontSize: 14, fontWeight: 600 }}>
                {new Date(day.at).toLocaleDateString(undefined, {
                  timeZone: tz, weekday: 'long', month: 'short', day: 'numeric',
                })}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {day.events.length} {day.events.length === 1 ? 'event' : 'events'}
              </span>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {day.events.map((e, i) => (
                <EventRow
                  key={e.id ?? `${e.event_at}-${e.title}`}
                  event={e} tz={tz} now={now}
                  isNext={next && (e.id ?? e.title) === (next.id ?? next.title)}
                  first={i === 0}
                  expanded={expanded === (e.id ?? `${e.event_at}-${e.title}`)}
                  onToggle={() => {
                    const key = e.id ?? `${e.event_at}-${e.title}`
                    setExpanded((cur) => (cur === key ? null : key))
                  }}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}

function EventRow({ event, tz, now, isNext, first, expanded, onToggle }) {
  const impact = IMPACTS[event.impact] ?? IMPACTS.low
  const meta = currencyMeta(event.currency)
  const cd = countdown(event, now)
  const imminent = isImminent(event, now)
  const s = surprise(event)

  return (
    <div style={{ borderTop: first ? 'none' : '1px solid var(--stroke-soft)' }}>
      <button onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left', padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
        <span className="mono" style={{ fontSize: 12.5, width: 52, flexShrink: 0, color: 'var(--text-2)' }}>
          {new Date(event.event_at).toLocaleTimeString(undefined, {
            timeZone: tz, hour: '2-digit', minute: '2-digit',
          })}
        </span>

        <span style={{ fontSize: 14, flexShrink: 0 }} title={meta.country}>{meta.flag}</span>
        <span className="mono" style={{ fontSize: 11.5, width: 32, flexShrink: 0, color: 'var(--text-3)' }}>
          {event.currency}
        </span>

        <span title={`${impact.label} impact`} style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: impact.tone,
        }} />

        <span style={{ fontSize: 13, flex: 1, minWidth: 120 }}>{event.title}</span>

        <Figure label="Act" value={event.actual}
          tone={s ? (s.key === 'above' ? 'var(--mint)' : s.key === 'below' ? 'var(--red)' : undefined) : undefined} />
        <Figure label="Fcst" value={event.forecast} />
        <Figure label="Prev" value={event.previous} />

        {isNext ? (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 6px',
            borderRadius: 5, color: 'var(--mint)', border: '1px solid rgba(47,212,138,0.4)', flexShrink: 0,
          }}>NEXT UP</span>
        ) : cd && (
          <span className="mono" style={{
            fontSize: 10.5, width: 62, textAlign: 'right', flexShrink: 0,
            color: imminent ? 'var(--amber)' : 'var(--text-3)',
          }}>{cd}</span>
        )}

        <span style={{ color: 'var(--text-3)', fontSize: 11, flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: '12px 16px 16px 64px', fontSize: 12.5, color: 'var(--text-2)',
              lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div>
                <strong style={{ color: 'var(--text)' }}>{meta.country}</strong> · {impact.label} impact ·{' '}
                {new Date(event.event_at).toLocaleString(undefined, {
                  timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
              {s && (
                <div style={{ color: s.key === 'above' ? 'var(--mint)' : s.key === 'below' ? 'var(--red)' : 'var(--text-2)' }}>
                  {s.label} — actual {event.actual} against a {event.forecast} forecast.
                </div>
              )}
              {!event.actual && (
                <div style={{ color: 'var(--text-3)' }}>
                  Not yet released. Forecast {event.forecast ?? '—'}, previous {event.previous ?? '—'}.
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Source: {event.source}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Figure({ label, value, tone }) {
  return (
    <span className="hide-mobile" style={{
      flexDirection: 'column', alignItems: 'flex-end', width: 54, flexShrink: 0, lineHeight: 1.3,
    }}>
      <span style={{ fontSize: 8.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, color: tone || (value ? 'var(--text)' : 'var(--text-3)') }}>
        {value ?? '—'}
      </span>
    </span>
  )
}

function ImpactPill({ label, tone, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '6px 11px', borderRadius: 8, fontSize: 11.5, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        border: `1px solid ${active ? (tone || 'var(--mint)') : 'var(--stroke)'}`,
        background: active ? 'var(--card-hover)' : 'var(--card-2)',
        color: active ? (tone || 'var(--text)') : 'var(--text-3)',
      }}>
      {tone && <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone }} />}
      {label}
    </button>
  )
}

function EmptyState({ hasAnyEvents, ready }) {
  return (
    <div className="card" style={{
      padding: '48px 28px', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13,
    }}>
      <div style={{
        width: 54, height: 54, borderRadius: 17, fontSize: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--card-2)', border: '1px solid var(--stroke)', color: 'var(--text-3)',
      }}>◎</div>

      {hasAnyEvents ? (
        <>
          <h3 style={{ fontFamily: 'var(--display)', fontSize: 17, fontWeight: 600 }}>No events match</h3>
          <p style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 380, lineHeight: 1.65 }}>
            Try a different day tab, or clear the impact and country filters.
          </p>
        </>
      ) : (
        <>
          <h3 style={{ fontFamily: 'var(--display)', fontSize: 17, fontWeight: 600 }}>
            {ready ? 'No events loaded yet' : 'Calendar not set up yet'}
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 460, lineHeight: 1.7 }}>
            {ready
              ? 'The calendar table exists but has no events in this window. Run the importer to populate it.'
              : 'Apply supabase/phase6.sql, then run the importer to populate the calendar.'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 460, lineHeight: 1.7 }}>
            This page shows real releases only. Which feed supplies them is your choice — feeds differ
            in licensing, and some forbid redisplay — so <span className="mono">calendar_bridge/</span>{' '}
            takes either a JSON file or a small provider adapter. See its README.
          </p>
        </>
      )}
    </div>
  )
}

const control = {
  padding: '7px 11px', borderRadius: 9, fontSize: 12.5,
  background: 'var(--input-bg)', border: '1px solid var(--stroke)',
  color: 'var(--text)', outline: 'none',
}

const ghost = {
  width: 32, height: 32, borderRadius: 9, fontSize: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid var(--stroke)', background: 'var(--card)', color: 'var(--text-2)',
}
