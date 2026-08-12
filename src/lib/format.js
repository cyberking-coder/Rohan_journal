// Display formatting that respects the user's currency and timezone settings.

// The spec is explicit that the currency setting changes the SYMBOL only — it
// does not convert P&L. Brokers report in the account's currency, and inventing
// a conversion without an FX rate feed would silently misstate every figure.
export const CURRENCIES = {
  USD: { symbol: '$', label: 'US Dollar' },
  EUR: { symbol: '€', label: 'Euro' },
  GBP: { symbol: '£', label: 'British Pound' },
  JPY: { symbol: '¥', label: 'Japanese Yen' },
  AUD: { symbol: 'A$', label: 'Australian Dollar' },
  CAD: { symbol: 'C$', label: 'Canadian Dollar' },
  CHF: { symbol: 'CHF ', label: 'Swiss Franc' },
  INR: { symbol: '₹', label: 'Indian Rupee' },
}

export const CURRENCY_KEYS = Object.keys(CURRENCIES)

export function currencySymbol(code) {
  return CURRENCIES[code]?.symbol ?? '$'
}

/**
 * Money in the user's display currency.
 * Mirrors `fmtMoney` in stats.js but takes the symbol from preferences.
 */
export function formatMoney(value, { currency = 'USD', digits = 2 } = {}) {
  const n = Number(value) || 0
  const sign = n < 0 ? '-' : ''
  const body = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${sign}${currencySymbol(currency)}${body}`
}

/**
 * Money for tight spaces (chart labels, strips).
 *
 * Drops the decimals on values large enough not to need them, but keeps them
 * on small ones — rounding -$0.20 to "-$0" reads as "flat" when it isn't.
 */
export function formatMoneyCompact(value, { currency = 'USD' } = {}) {
  const n = Number(value) || 0
  return formatMoney(n, { currency, digits: Math.abs(n) >= 10 || n === 0 ? 0 : 2 })
}

// ---------------------------------------------------------------------------
// Timezones
// ---------------------------------------------------------------------------

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// An empty preference means "follow the browser".
export function resolveTimezone(pref) {
  return pref || browserTimezone()
}

export function formatDateTime(value, { timezone, ...opts } = {}) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return d.toLocaleString(undefined, {
      timeZone: resolveTimezone(timezone),
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      ...opts,
    })
  } catch {
    // An invalid zone shouldn't blank the UI.
    return d.toLocaleString()
  }
}

export function timezoneOffsetLabel(zone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: resolveTimezone(zone), timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

// The spec's timezone picker is a long IANA list grouped by region. This is a
// representative set covering the regions traders actually sit in, rather than
// all ~400 IANA zones, which is unusable in a dropdown.
export const TIMEZONE_GROUPS = [
  {
    label: 'Americas',
    zones: [
      'America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago',
      'America/New_York', 'America/Toronto', 'America/Mexico_City', 'America/Bogota',
      'America/Lima', 'America/Santiago', 'America/Sao_Paulo', 'America/Buenos_Aires',
      'America/Anchorage', 'Pacific/Honolulu',
    ],
  },
  {
    label: 'Europe',
    zones: [
      'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris',
      'Europe/Brussels', 'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Rome',
      'Europe/Vienna', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Stockholm', 'Europe/Oslo',
      'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Athens', 'Europe/Bucharest',
      'Europe/Kiev', 'Europe/Istanbul', 'Europe/Moscow',
    ],
  },
  {
    label: 'Africa & Middle East',
    zones: [
      'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg',
      'Africa/Nairobi', 'Asia/Jerusalem', 'Asia/Beirut', 'Asia/Riyadh', 'Asia/Dubai',
      'Asia/Tehran', 'Asia/Baku',
    ],
  },
  {
    label: 'Asia',
    zones: [
      'Asia/Karachi', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Yangon',
      'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Kuala_Lumpur',
      'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Manila', 'Asia/Seoul',
      'Asia/Tokyo',
    ],
  },
  {
    label: 'Oceania',
    zones: [
      'Australia/Perth', 'Australia/Darwin', 'Australia/Adelaide', 'Australia/Brisbane',
      'Australia/Sydney', 'Australia/Melbourne', 'Australia/Hobart',
      'Pacific/Auckland', 'Pacific/Fiji',
    ],
  },
  { label: 'Other', zones: ['UTC'] },
]

export const ALL_TIMEZONES = TIMEZONE_GROUPS.flatMap((g) => g.zones)

// "Asia/Kolkata" -> "Kolkata"
export function timezoneCity(zone) {
  return String(zone).split('/').pop().replace(/_/g, ' ')
}
