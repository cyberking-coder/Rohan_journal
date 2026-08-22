// Shared read-only dashboards ("Trader POV").
//
// Pure helpers only. The rules that decide what a viewer may see live in
// `shared_view()` in supabase/phase9.sql, deliberately — anything enforced
// here would be enforced in code the viewer's browser is running, which is to
// say not enforced at all. This file formats, validates and labels.

/**
 * What an owner can switch on. `key` matches the strings stored in
 * `shared_dashboards.sections` and read by the SQL function.
 */
export const SHARE_SECTIONS = [
  {
    key: 'overview',
    label: 'Overview',
    description: 'Headline P&L, win rate, profit factor and expectancy.',
  },
  {
    key: 'performance',
    label: 'Performance',
    description: 'Equity curve, drawdown and the breakdown charts.',
  },
  {
    key: 'trades',
    label: 'Trade history',
    description: 'Every trade: symbol, direction, prices and result.',
  },
  {
    key: 'journal',
    label: 'Journal notes',
    description: 'Your written analysis, mistakes, lessons and ratings.',
    caution: 'This is the personal part. Share it deliberately.',
  },
  {
    key: 'reports',
    label: 'AI reports',
    description: 'The performance reviews written about your trading.',
    caution: 'These quote your journal back, so they can reveal notes even when the journal section is off.',
  },
]

export const DEFAULT_SECTIONS = ['overview', 'performance', 'trades']

export const EXPIRY_OPTIONS = [
  { key: '24h', label: '24 hours', hours: 24 },
  { key: '7d', label: '7 days', hours: 24 * 7 },
  { key: '30d', label: '30 days', hours: 24 * 30 },
  { key: 'never', label: 'No expiry', hours: null },
]

export function expiryFrom(key, now = Date.now()) {
  const option = EXPIRY_OPTIONS.find((o) => o.key === key)
  if (!option || option.hours === null) return null
  return new Date(now + option.hours * 3600000).toISOString()
}

// Matches what `new_share_code()` produces: VIEW- plus four groups of four.
const CODE_RE = /^VIEW(-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}){4}$/

export function isShareCode(value) {
  return CODE_RE.test(normaliseCode(value))
}

/**
 * Tidies a pasted code.
 *
 * People paste whole URLs, add spaces, and lowercase things. Rejecting those
 * would be technically correct and useless — the code is unambiguous either
 * way, since the alphabet has no lookalike characters.
 */
export function normaliseCode(value) {
  if (!value) return ''
  const text = String(value).trim()
  // A full share URL: take the code parameter.
  const fromUrl = text.match(/[?&]code=([^&\s]+)/)
  return (fromUrl ? fromUrl[1] : text).trim().toUpperCase().replace(/\s+/g, '')
}

export function shareUrl(code, origin = typeof window !== 'undefined' ? window.location.origin : '') {
  return `${origin}/?view=shared&code=${encodeURIComponent(code)}`
}

/** Live / expired / revoked, with the reason a viewer would hit. */
export function shareStatus(share, now = Date.now()) {
  if (!share) return { key: 'unknown', label: 'Unknown', tone: 'neutral' }
  if (share.revoked) return { key: 'revoked', label: 'Revoked', tone: 'bad' }
  const expires = share.expires_at ? Date.parse(share.expires_at) : null
  if (expires !== null && expires <= now) return { key: 'expired', label: 'Expired', tone: 'bad' }
  if (expires !== null && expires - now < 24 * 3600000) {
    return { key: 'expiring', label: 'Expires soon', tone: 'neutral' }
  }
  return { key: 'live', label: 'Live', tone: 'good' }
}

export function sectionLabels(sections = []) {
  return SHARE_SECTIONS.filter((s) => sections.includes(s.key)).map((s) => s.label)
}

/**
 * Warnings worth showing before a link is created.
 *
 * Not validation — none of these block anything. They exist because "share my
 * results" and "share my private notes forever with anyone holding a URL" are
 * easy to confuse until someone says it plainly.
 */
export function shareWarnings({ sections = [], expiry = 'never', hideAmounts = false }) {
  const out = []
  if (sections.includes('journal')) {
    out.push('Journal notes are included — anyone with the link can read what you wrote.')
  }
  if (sections.includes('reports') && !sections.includes('journal')) {
    out.push('AI reports quote your journal, so notes can appear even with the journal section off.')
  }
  if (expiry === 'never') {
    out.push('This link never expires. You can revoke it later, but until then it works for anyone who has it.')
  }
  if (!hideAmounts) {
    out.push('Money amounts are shown, which reveals your account size.')
  }
  return out
}

/** How the shared view labels a value: currency, or R multiples. */
export function unitLabel(unit) {
  return unit === 'R' ? 'R' : ''
}
