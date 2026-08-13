// Economic calendar domain logic.
//
// All filtering, grouping and countdown maths lives here so it can be tested
// without a browser, and so the page component stays presentational.

export const IMPACTS = {
  high: { label: 'High', tone: 'var(--red)', weight: 3 },
  medium: { label: 'Med', tone: 'var(--amber)', weight: 2 },
  low: { label: 'Low', tone: 'var(--mint)', weight: 1 },
}

export const IMPACT_KEYS = Object.keys(IMPACTS)

export const DAY_TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'This Week' },
  { key: 'all', label: 'All' },
]

// Currency → flag and country. The calendar is keyed by currency because that
// is what a release actually moves; the country is for the filter and label.
export const CURRENCY_META = {
  USD: { flag: '🇺🇸', country: 'United States' },
  EUR: { flag: '🇪🇺', country: 'Euro Area' },
  GBP: { flag: '🇬🇧', country: 'United Kingdom' },
  JPY: { flag: '🇯🇵', country: 'Japan' },
  AUD: { flag: '🇦🇺', country: 'Australia' },
  NZD: { flag: '🇳🇿', country: 'New Zealand' },
  CAD: { flag: '🇨🇦', country: 'Canada' },
  CHF: { flag: '🇨🇭', country: 'Switzerland' },
  CNY: { flag: '🇨🇳', country: 'China' },
  INR: { flag: '🇮🇳', country: 'India' },
  SEK: { flag: '🇸🇪', country: 'Sweden' },
  NOK: { flag: '🇳🇴', country: 'Norway' },
  MXN: { flag: '🇲🇽', country: 'Mexico' },
  BRL: { flag: '🇧🇷', country: 'Brazil' },
  ZAR: { flag: '🇿🇦', country: 'South Africa' },
  SGD: { flag: '🇸🇬', country: 'Singapore' },
  HKD: { flag: '🇭🇰', country: 'Hong Kong' },
  KRW: { flag: '🇰🇷', country: 'South Korea' },
}

export function currencyMeta(code) {
  return CURRENCY_META[String(code || '').toUpperCase()] ?? { flag: '🏳️', country: code || 'Unknown' }
}

export function eventTime(event) {
  const ms = new Date(event?.event_at).getTime()
  return Number.isFinite(ms) ? ms : null
}

// ---------------------------------------------------------------------------
// Day boundaries
// ---------------------------------------------------------------------------

// Day boundaries have to be computed in the user's timezone, not the browser's
// and not UTC — otherwise "Today" shows yesterday's releases for anyone far
// enough east or west.
function zonedParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(new Date(ms))
  return { y: Number(y), m: Number(m), d: Number(d) }
}

/** The calendar date in `timeZone` as a YYYY-MM-DD key. */
export function dayKey(ms, timeZone = 'UTC') {
  try {
    const { y, m, d } = zonedParts(ms, timeZone)
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

// Offset between UTC and the zone at this instant, in ms.
function zoneOffset(ms, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
    return asUtc - ms
  } catch {
    return 0
  }
}

/** Midnight (00:00) of the given day in `timeZone`, as a UTC epoch ms. */
export function startOfDay(ms, timeZone = 'UTC', dayOffset = 0) {
  const { y, m, d } = (() => {
    try { return zonedParts(ms, timeZone) } catch { const dt = new Date(ms); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() } }
  })()
  const naive = Date.UTC(y, m - 1, d + dayOffset, 0, 0, 0)
  // Subtract the zone's offset to land on the real instant of local midnight.
  return naive - zoneOffset(naive, timeZone)
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function filterEvents(events, {
  tab = 'upcoming', impacts = [], currency = 'all', query = '',
  timezone = 'UTC', now = Date.now(),
} = {}) {
  const todayStart = startOfDay(now, timezone, 0)
  const tomorrowStart = startOfDay(now, timezone, 1)
  const dayAfter = startOfDay(now, timezone, 2)
  const weekEnd = startOfDay(now, timezone, 7)
  const q = query.trim().toLowerCase()
  const wanted = new Set(impacts)

  return events.filter((e) => {
    const at = eventTime(e)
    if (at === null) return false

    if (tab === 'upcoming' && at < now) return false
    if (tab === 'today' && (at < todayStart || at >= tomorrowStart)) return false
    if (tab === 'tomorrow' && (at < tomorrowStart || at >= dayAfter)) return false
    if (tab === 'week' && (at < todayStart || at >= weekEnd)) return false

    if (wanted.size && !wanted.has(e.impact)) return false
    if (currency !== 'all' && String(e.currency).toUpperCase() !== currency) return false

    if (!q) return true
    return `${e.title} ${e.currency} ${e.country ?? ''}`.toLowerCase().includes(q)
  }).sort((a, b) => eventTime(a) - eventTime(b))
}

/** Groups a sorted event list into day buckets for the rendered list. */
export function groupByDay(events, timezone = 'UTC') {
  const map = new Map()
  for (const e of events) {
    const at = eventTime(e)
    if (at === null) continue
    const key = dayKey(at, timezone)
    if (!map.has(key)) map.set(key, { key, at, events: [] })
    map.get(key).events.push(e)
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** The currencies actually present, for the country filter dropdown. */
export function availableCurrencies(events) {
  return [...new Set(events.map((e) => String(e.currency || '').toUpperCase()).filter(Boolean))].sort()
}

/**
 * The next event still to come. Drives the "NEXT UP" badge — only meaningful
 * for future releases, so a past-only list has none.
 */
export function nextUpcoming(events, now = Date.now()) {
  let best = null
  for (const e of events) {
    const at = eventTime(e)
    if (at === null || at < now) continue
    if (!best || at < eventTime(best)) best = e
  }
  return best
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

/**
 * Human countdown to an event, e.g. "7h left", "in 3d", "released".
 * Returns null when the timestamp is unusable, so the UI can fall back.
 */
export function countdown(event, now = Date.now()) {
  const at = eventTime(event)
  if (at === null) return null

  const ms = at - now
  if (ms <= 0) {
    // A release with no published value yet is still pending, not stale — the
    // figure often lands a minute or two after the scheduled time.
    return event.actual ? 'released' : 'due now'
  }

  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'in <1m'
  if (mins < 60) return `${mins}m left`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h left`
  return `in ${Math.floor(hours / 24)}d`
}

/** True when the release is close enough to be worth flagging. */
export function isImminent(event, now = Date.now(), withinMs = 60 * 60 * 1000) {
  const at = eventTime(event)
  if (at === null) return false
  return at > now && at - now <= withinMs
}

// ---------------------------------------------------------------------------
// Surprise
// ---------------------------------------------------------------------------

// Releases publish as text with units ('3.2%', '250K', '-0.1%'), so comparing
// actual against forecast means parsing carefully — and refusing when the two
// aren't comparable rather than guessing.
export function parseReleaseValue(text) {
  if (text == null) return null
  const s = String(text).trim()
  if (!s) return null
  const m = s.match(/^(-?[\d,]*\.?\d+)\s*([KMB%]?)/i)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] ?? 1
  return { value: n * mult, unit: m[2].toUpperCase() || '' }
}

/**
 * Whether the actual beat, missed or matched the forecast.
 * Returns null when either side is missing or the units disagree — a "beat"
 * computed across mismatched units would be worse than showing nothing.
 */
export function surprise(event) {
  const a = parseReleaseValue(event?.actual)
  const f = parseReleaseValue(event?.forecast)
  if (!a || !f) return null
  if (a.unit !== f.unit) return null
  if (a.value === f.value) return { key: 'met', label: 'In line' }
  return a.value > f.value
    ? { key: 'above', label: 'Above forecast' }
    : { key: 'below', label: 'Below forecast' }
}
