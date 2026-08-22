// Configurable trading sessions — Master PRD §43, which says in as many words:
// "do not permanently hard-code session times".
//
// It is right to insist. The three-session split this app shipped with is one
// convention among several, it is stated in UTC, and it is wrong for anyone
// whose broker's day rolls somewhere else or who thinks in kill zones rather
// than in continents.
//
// ── Two shapes of session, and why both are needed ─────────────────────────
//
//   partition — the windows tile the whole 24 hours without gaps or overlap,
//               so every trade lands in exactly one bucket. This is what a
//               breakdown chart needs: the counts add up to the total.
//
//   windows   — named periods that may overlap and need not cover the day.
//               ICT kill zones are this: London 07:00–10:00, New York AM
//               08:30–11:00 New York time, Silver Bullet inside it. A trade
//               can sit in two of them, or in none.
//
// Collapsing these into one model is the mistake that makes a session feature
// useless. Force kill zones into a partition and they stop being kill zones;
// let a partition overlap and its chart quietly stops summing to the total.

export const MODES = {
  partition: {
    label: 'Full day',
    hint: 'Windows tile all 24 hours. Every trade lands in exactly one.',
  },
  windows: {
    label: 'Windows',
    hint: 'Named periods that may overlap or leave gaps. A trade can be in several, or none.',
  },
}

const TINTS = ['var(--info)', 'var(--mint)', 'var(--amber)', '#b98cff', '#ff9f7a', '#6ad4d4']

// Minutes from UTC midnight is the internal unit throughout. Hours are too
// coarse — 08:30 and 09:30 New York opens are both real and both fall between
// whole UTC hours for half the year.
export function hm(h, m = 0) { return h * 60 + m }

export const PRESETS = {
  classic: {
    id: 'classic',
    label: 'Classic (3 sessions)',
    mode: 'partition',
    note: 'The split this journal shipped with. Every trade lands in one of three.',
    sessions: [
      { id: 'asian', label: 'Asian', start: hm(22), end: hm(8) },
      { id: 'london', label: 'London', start: hm(8), end: hm(13) },
      { id: 'newyork', label: 'New York', start: hm(13), end: hm(22) },
    ],
  },
  fourway: {
    id: 'fourway',
    label: 'Four sessions',
    mode: 'partition',
    note: 'Splits the London/New York overlap out, where a lot of the day’s range happens.',
    sessions: [
      { id: 'sydney', label: 'Sydney', start: hm(22), end: hm(0) },
      { id: 'tokyo', label: 'Tokyo', start: hm(0), end: hm(8) },
      { id: 'london', label: 'London', start: hm(8), end: hm(13) },
      { id: 'overlap', label: 'Overlap', start: hm(13), end: hm(17) },
      { id: 'newyork', label: 'New York', start: hm(17), end: hm(22) },
    ],
  },
  ict: {
    id: 'ict',
    label: 'ICT kill zones',
    mode: 'windows',
    // Stated in UTC like everything else here, which is the honest caveat:
    // ICT's times are New York local, so they shift an hour when the US and
    // the UK are not on the same side of a daylight-saving change. The UI says
    // so, and the editor exists precisely so this can be adjusted.
    note: 'Times are ICT’s New York clock converted at UTC−4. Shift them by an hour outside US summer time.',
    sessions: [
      { id: 'asian-range', label: 'Asian Range', start: hm(0), end: hm(5) },
      { id: 'london-killzone', label: 'London KZ', start: hm(6), end: hm(9) },
      { id: 'ny-am-killzone', label: 'NY AM KZ', start: hm(12), end: hm(15) },
      { id: 'silver-bullet', label: 'Silver Bullet', start: hm(14), end: hm(15) },
      { id: 'ny-pm-killzone', label: 'NY PM KZ', start: hm(18), end: hm(20) },
      { id: 'london-close', label: 'London Close', start: hm(19), end: hm(21) },
    ],
  },
}

export const DEFAULT_SESSION_CONFIG = { preset: 'classic', mode: 'partition', sessions: null }

// ---------------------------------------------------------------------------
// Reading a config
// ---------------------------------------------------------------------------

/**
 * Resolve a stored preference into the session list to actually use.
 *
 * A stored config is either a preset name, or `sessions` the user has edited.
 * Resolving here rather than at each call site means a corrupt or half-written
 * preference degrades to the classic split instead of blanking every chart on
 * the page.
 */
export function resolveSessions(config) {
  const c = config || DEFAULT_SESSION_CONFIG

  if (Array.isArray(c.sessions) && c.sessions.length) {
    const sessions = c.sessions
      .map(normaliseSession)
      .filter(Boolean)
      .slice(0, 12)
    if (sessions.length) {
      return {
        id: 'custom',
        label: 'Custom',
        mode: MODES[c.mode] ? c.mode : 'windows',
        sessions: tint(sessions),
      }
    }
  }

  const preset = PRESETS[c.preset] || PRESETS.classic
  return { ...preset, sessions: tint(preset.sessions) }
}

function tint(sessions) {
  return sessions.map((s, i) => ({ ...s, tint: s.tint || TINTS[i % TINTS.length] }))
}

function normaliseSession(s) {
  const start = clampMinute(s?.start)
  const end = clampMinute(s?.end)
  const label = String(s?.label || '').trim().slice(0, 28)
  if (start === null || end === null || !label) return null
  // A zero-length window matches nothing and would sit in the list looking
  // like a session. Rejected rather than kept as a puzzle for the user.
  if (start === end) return null
  return {
    id: String(s.id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 32),
    label,
    start,
    end,
    tint: s.tint,
  }
}

function clampMinute(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1439, Math.round(n)))
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Minutes from UTC midnight for a timestamp. */
export function minuteOfDay(ms) {
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** Does a minute fall inside a window? Windows that wrap past midnight work. */
export function inWindow(minute, s) {
  if (minute === null) return false
  return s.start < s.end
    ? minute >= s.start && minute < s.end
    : minute >= s.start || minute < s.end
}

/**
 * Every session a minute falls in.
 *
 * Returns a list because in `windows` mode that is the truth — a Silver Bullet
 * trade is also inside the NY AM kill zone, and reporting only the first would
 * make one of them permanently look unused.
 */
export function sessionsAt(minute, resolved) {
  return (resolved?.sessions || []).filter((s) => inWindow(minute, s))
}

/**
 * The single session for a partition, or null.
 *
 * In `windows` mode this deliberately returns the *narrowest* match rather
 * than the first: Silver Bullet sits inside NY AM, and a trader who has
 * defined the tighter window cares more about it than about the one that
 * contains it.
 */
export function sessionAt(minute, resolved) {
  const hits = sessionsAt(minute, resolved)
  if (!hits.length) return null
  if (hits.length === 1) return hits[0]
  return hits.reduce((best, s) => (span(s) < span(best) ? s : best))
}

export function span(s) {
  return s.start < s.end ? s.end - s.start : 1440 - s.start + s.end
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * What is wrong with a partition, in the user's terms.
 *
 * Only meaningful for `partition` mode — overlaps and gaps are the entire
 * point of `windows`, so flagging them there would be nagging about a feature
 * working correctly.
 *
 * Reported as warnings rather than enforced as errors: a half-edited config is
 * a normal state to be in while typing, and refusing to save it is worse than
 * saying what it will do.
 */
export function validate(resolved) {
  const issues = []
  const sessions = resolved?.sessions || []

  if (!sessions.length) {
    return [{ kind: 'empty', message: 'No sessions defined — trades will not be bucketed at all.' }]
  }

  const dupes = sessions.filter((s, i) => sessions.findIndex((o) => o.id === s.id) !== i)
  for (const d of dupes) {
    issues.push({ kind: 'duplicate', message: `Two sessions share the id “${d.id}”, so one of them will be ignored.` })
  }

  if (resolved.mode !== 'partition') return issues

  // Walk the day a minute at a time. Crude, and 1,440 iterations of nothing is
  // instant — much easier to trust than interval arithmetic over windows that
  // wrap past midnight.
  let uncovered = 0
  let overlapping = 0
  for (let m = 0; m < 1440; m++) {
    const n = sessions.filter((s) => inWindow(m, s)).length
    if (n === 0) uncovered++
    else if (n > 1) overlapping++
  }

  if (uncovered) {
    issues.push({
      kind: 'gap',
      message: `${fmtSpan(uncovered)} of the day isn’t covered — trades in those minutes will show as “No session”.`,
    })
  }
  if (overlapping) {
    issues.push({
      kind: 'overlap',
      message: `${fmtSpan(overlapping)} of the day is covered twice, so your session totals won’t add up to your overall P&L.`,
    })
  }

  return issues
}

function fmtSpan(minutes) {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function fmtMinute(minute) {
  const m = ((Math.round(Number(minute)) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function parseMinute(text) {
  const match = /^\s*(\d{1,2})\s*:?\s*(\d{2})?\s*$/.exec(String(text || ''))
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2] || 0)
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/** Segments for drawing on a 24-hour bar; a wrapping window becomes two. */
export function segments(s) {
  if (s.start < s.end) return [{ start: s.start, end: s.end }]
  return [{ start: s.start, end: 1440 }, { start: 0, end: s.end }]
}
