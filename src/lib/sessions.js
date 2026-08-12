// Forex trading sessions for the Market Hours tool.
//
// Note there are two session models in the spec, deliberately kept separate:
//   • This tool uses four *cities* (Sydney, Tokyo, London, New York) with real,
//     overlapping market hours — that's what a trader watching the clock wants.
//   • The Analysis module buckets trades into three non-overlapping *sessions*
//     covering all 24h, because every trade must land in exactly one bucket.
// Merging them would break one or the other, so they stay distinct.

// Hours are UTC. `open` > `close` means the session wraps past midnight.
export const MARKET_SESSIONS = [
  { id: 'sydney', city: 'Sydney', flag: '🇦🇺', zone: 'Australia/Sydney', open: 22, close: 7 },
  { id: 'tokyo', city: 'Tokyo', flag: '🇯🇵', zone: 'Asia/Tokyo', open: 0, close: 9 },
  { id: 'london', city: 'London', flag: '🇬🇧', zone: 'Europe/London', open: 8, close: 17 },
  { id: 'newyork', city: 'New York', flag: '🇺🇸', zone: 'America/New_York', open: 13, close: 22 },
]

// Fractional UTC hour (e.g. 13.5 for 13:30) — the unit every position on the
// timeline is expressed in.
export function utcHour(date = new Date()) {
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
}

export function isSessionOpen(session, hour) {
  // Forex is shut over the weekend; a session whose clock says "open" on a
  // Saturday is not actually tradeable.
  return session.open < session.close
    ? hour >= session.open && hour < session.close
    : hour >= session.open || hour < session.close
}

// Saturday all day, Sunday before 22:00 UTC (when Sydney reopens), and after
// 22:00 UTC Friday.
export function isMarketClosed(date = new Date()) {
  const day = date.getUTCDay()
  const hour = utcHour(date)
  if (day === 6) return true
  if (day === 0) return hour < 22
  if (day === 5) return hour >= 22
  return false
}

export function openSessions(date = new Date()) {
  if (isMarketClosed(date)) return []
  const hour = utcHour(date)
  return MARKET_SESSIONS.filter((s) => isSessionOpen(s, hour))
}

// Sessions render as one or two bars on a shared 24h timeline; a wrapping
// session has to be drawn as two segments rather than one negative-width bar.
export function sessionSegments(session) {
  if (session.open < session.close) {
    return [{ start: session.open, end: session.close }]
  }
  return [
    { start: session.open, end: 24 },
    { start: 0, end: session.close },
  ]
}

// ---------------------------------------------------------------------------
// Expected volume
// ---------------------------------------------------------------------------

// Liquidity follows how many major centres are trading at once. The
// London/New York overlap is the deepest window of the day.
export function volumeLevel(date = new Date()) {
  if (isMarketClosed(date)) {
    return { level: 'Closed', tone: 'bad', note: 'Markets are closed for the weekend.' }
  }
  const open = openSessions(date)
  const ids = open.map((s) => s.id)

  if (ids.includes('london') && ids.includes('newyork')) {
    return { level: 'High', tone: 'good', note: 'London and New York are both open — deepest liquidity and tightest spreads.' }
  }
  if (open.length >= 2) {
    return { level: 'Medium', tone: 'neutral', note: `${open.map((s) => s.city).join(' and ')} are open.` }
  }
  if (open.length === 1) {
    return { level: 'Medium', tone: 'neutral', note: `Only ${open[0].city} is open — moves can be thinner.` }
  }
  return { level: 'Low', tone: 'bad', note: 'Between sessions — expect thin liquidity and wider spreads.' }
}

// ---------------------------------------------------------------------------
// Reference windows
// ---------------------------------------------------------------------------

// Stored in UTC and converted to the viewer's local time at render, so these
// stay correct wherever the trader is.
export const BEST_TIMES = [
  {
    id: 'overlap',
    title: 'Highest Volume',
    subtitle: 'London + New York overlap',
    startUtc: 13,
    endUtc: 17,
    description: 'Maximum liquidity and the tightest spreads of the day. Best for EUR/USD, GBP/USD and USD/JPY.',
  },
  {
    id: 'london-open',
    title: 'London Open',
    subtitle: 'High volatility window',
    startUtc: 8,
    endUtc: 10,
    description: 'The day’s first major expansion in volatility. Often sets directional bias for EUR/GBP crosses.',
  },
  {
    id: 'tokyo-open',
    title: 'Tokyo Open',
    subtitle: 'Best Asia window',
    startUtc: 0,
    endUtc: 3,
    description: 'Strongest Asian session activity. Best for USD/JPY, EUR/JPY, AUD/USD and NZD/USD.',
  },
]

// Turns a UTC hour into today's local time for display.
export function utcHourToLocal(utcH, date = new Date()) {
  const d = new Date(date)
  d.setUTCHours(Math.floor(utcH), Math.round((utcH % 1) * 60), 0, 0)
  return d
}

export function fmtTime(date, use24h) {
  return date.toLocaleTimeString(undefined, {
    hour: use24h ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !use24h,
  })
}

// The local time in a specific city, for the per-session rows.
export function cityTime(zone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone, weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(date)
  } catch {
    // A runtime without full ICU data can't resolve named zones.
    return null
  }
}

export function cityOffsetLabel(zone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(date)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? null
  } catch {
    return null
  }
}
