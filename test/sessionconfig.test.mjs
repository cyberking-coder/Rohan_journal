// Configurable sessions.
//
// The interesting cases are all about windows that wrap past midnight, and
// about the partition/windows distinction holding: a partition that quietly
// overlaps produces charts that don't add up, and that is exactly the kind of
// wrongness nobody notices.

import assert from 'node:assert/strict'
import {
  DEFAULT_SESSION_CONFIG, PRESETS, fmtMinute, hm, inWindow, minuteOfDay,
  parseMinute, resolveSessions, segments, sessionAt, sessionsAt, span, validate,
} from '../src/lib/sessionConfig.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }

// ── windows ────────────────────────────────────────────────────────────────
{
  const day = { start: hm(8), end: hm(13) }
  ok(inWindow(hm(8), day), 'start is inside')
  ok(inWindow(hm(12, 59), day), 'a minute before the end is inside')
  ok(!inWindow(hm(13), day), 'the end is exclusive, so windows can abut')
  ok(!inWindow(hm(7, 59), day), 'before the start is outside')

  // The one that goes wrong in every naive implementation.
  const night = { start: hm(22), end: hm(8) }
  ok(inWindow(hm(22), night), 'wrapping: start')
  ok(inWindow(hm(23, 59), night), 'wrapping: before midnight')
  ok(inWindow(hm(0), night), 'wrapping: midnight')
  ok(inWindow(hm(7, 59), night), 'wrapping: before the end')
  ok(!inWindow(hm(8), night), 'wrapping: the end is still exclusive')
  ok(!inWindow(hm(12), night), 'wrapping: the middle of the day is outside')

  eq(span({ start: hm(8), end: hm(13) }), 300, 'span of a normal window')
  eq(span({ start: hm(22), end: hm(8) }), 600, 'span of a wrapping window')

  ok(!inWindow(null, day), 'an unknown minute is in nothing')
}

// ── minute of day ──────────────────────────────────────────────────────────
{
  eq(minuteOfDay(Date.parse('2026-03-02T08:30:00Z')), 510, 'UTC minutes')
  eq(minuteOfDay(Date.parse('2026-03-02T00:00:00Z')), 0, 'midnight')
  eq(minuteOfDay(Date.parse('2026-03-02T23:59:00Z')), 1439, 'last minute')
  eq(minuteOfDay(NaN), null, 'no minute for an unparseable time')
}

// ── presets ────────────────────────────────────────────────────────────────
{
  const classic = resolveSessions(DEFAULT_SESSION_CONFIG)
  eq(classic.id, 'classic', 'the default is the classic split')
  eq(classic.mode, 'partition', 'which is a partition')
  eq(validate(classic), [], 'and it tiles the day exactly')
  ok(classic.sessions.every((s) => s.tint), 'every session gets a colour')

  eq(validate(resolveSessions({ preset: 'fourway' })), [], 'the four-way split also tiles exactly')

  // The kill zones are windows, and must NOT be judged as a partition — they
  // overlap by design and cover well under half the day.
  const ict = resolveSessions({ preset: 'ict' })
  eq(ict.mode, 'windows', 'kill zones are windows')
  eq(validate(ict), [], 'so gaps and overlaps are not reported as problems')

  // Silver Bullet sits inside NY AM. Both must be reported.
  const at = sessionsAt(hm(14, 30), ict).map((s) => s.id)
  eq(at.sort(), ['ny-am-killzone', 'silver-bullet'], 'a minute can be in two windows')
  // And the narrower one wins when a single answer is needed.
  eq(sessionAt(hm(14, 30), ict).id, 'silver-bullet', 'the tighter window is the more specific answer')
  eq(sessionAt(hm(13), ict).id, 'ny-am-killzone', 'outside it, the containing window')
  eq(sessionAt(hm(23), ict), null, 'a quiet hour is in no kill zone at all')
}

// ── partition validation ───────────────────────────────────────────────────
{
  // A gap: nothing covers 13:00–14:00.
  const gapped = resolveSessions({
    mode: 'partition',
    sessions: [
      { id: 'a', label: 'A', start: hm(0), end: hm(13) },
      { id: 'b', label: 'B', start: hm(14), end: hm(0) },
    ],
  })
  const gaps = validate(gapped)
  eq(gaps.length, 1, 'one issue')
  eq(gaps[0].kind, 'gap', 'a gap')
  ok(/1h/.test(gaps[0].message), 'reported as an hour')

  // An overlap: both cover 12:00–13:00.
  const overlapped = resolveSessions({
    mode: 'partition',
    sessions: [
      { id: 'a', label: 'A', start: hm(0), end: hm(13) },
      { id: 'b', label: 'B', start: hm(12), end: hm(0) },
    ],
  })
  const over = validate(overlapped)
  eq(over.length, 1, 'one issue')
  eq(over[0].kind, 'overlap', 'an overlap')
  ok(/add up/.test(over[0].message), 'and says what it costs the reader')

  // The same overlap in windows mode is not a problem.
  eq(validate(resolveSessions({ mode: 'windows', sessions: overlapped.sessions })), [],
    'overlap is the point of windows mode')

  // Both at once, with a wrapping session in the mix.
  const messy = resolveSessions({
    mode: 'partition',
    sessions: [
      { id: 'a', label: 'A', start: hm(22), end: hm(9) },
      { id: 'b', label: 'B', start: hm(8), end: hm(20) },
    ],
  })
  const kinds = validate(messy).map((i) => i.kind).sort()
  eq(kinds, ['gap', 'overlap'], 'a wrapping session is measured correctly in both directions')

  // Duplicate ids silently lose a session, so they are called out.
  const dupe = resolveSessions({
    mode: 'partition',
    sessions: [
      { id: 'a', label: 'One', start: hm(0), end: hm(12) },
      { id: 'a', label: 'Two', start: hm(12), end: hm(0) },
    ],
  })
  ok(validate(dupe).some((i) => i.kind === 'duplicate'), 'duplicate ids are reported')
}

// ── resolving bad input ────────────────────────────────────────────────────
{
  eq(resolveSessions(null).id, 'classic', 'null falls back')
  eq(resolveSessions({}).id, 'classic', 'an empty config falls back')
  eq(resolveSessions({ preset: 'nonsense' }).id, 'classic', 'an unknown preset falls back')
  eq(resolveSessions({ sessions: [] }).id, 'classic', 'an empty list falls back')

  // Every entry unusable — must fall back rather than render an empty page.
  eq(resolveSessions({ sessions: [{ label: '', start: 'x', end: 'y' }] }).id, 'classic',
    'entirely invalid sessions fall back')

  // Partially valid: keep what works, drop what doesn't.
  const mixed = resolveSessions({
    sessions: [
      { id: 'good', label: 'Good', start: hm(1), end: hm(2) },
      { id: 'bad', label: 'Zero length', start: hm(3), end: hm(3) },
      { label: '', start: 0, end: 10 },
    ],
  })
  eq(mixed.sessions.map((s) => s.id), ['good'], 'zero-length and unlabelled entries are dropped')
  eq(mixed.id, 'custom', 'and the result is a custom config')
  eq(mixed.mode, 'windows', 'defaulting to windows, the forgiving mode')

  // Out-of-range minutes are clamped rather than rejected, since a slider or a
  // typo shouldn't delete the session.
  const clamped = resolveSessions({ sessions: [{ id: 'x', label: 'X', start: -50, end: 99999 }] })
  eq(clamped.sessions[0].start, 0, 'clamped low')
  eq(clamped.sessions[0].end, 1439, 'clamped high')

  eq(resolveSessions({ sessions: Array.from({ length: 40 }, (_, i) => ({
    id: `s${i}`, label: `S${i}`, start: i, end: i + 1,
  })) }).sessions.length, 12, 'capped at 12 sessions')

  // An edited config keeps the mode it was given.
  eq(resolveSessions({ mode: 'partition', sessions: [{ id: 'a', label: 'A', start: 0, end: 1 }] }).mode,
    'partition', 'explicit mode is respected')
}

// ── formatting ─────────────────────────────────────────────────────────────
{
  eq(fmtMinute(0), '00:00', 'midnight')
  eq(fmtMinute(510), '08:30', 'padded')
  eq(fmtMinute(1439), '23:59', 'last minute')
  eq(fmtMinute(1440), '00:00', 'wraps')

  eq(parseMinute('08:30'), 510, 'colon form')
  eq(parseMinute('8:30'), 510, 'unpadded')
  eq(parseMinute('0830'), 510, 'no colon')
  eq(parseMinute('13'), 780, 'hour only')
  eq(parseMinute('24:00'), null, 'out of range')
  eq(parseMinute('08:99'), null, 'bad minutes')
  eq(parseMinute('abc'), null, 'not a time')
  eq(parseMinute(''), null, 'empty')

  eq(segments({ start: hm(8), end: hm(13) }).length, 1, 'a normal window is one bar')
  const two = segments({ start: hm(22), end: hm(8) })
  eq(two.length, 2, 'a wrapping window is two bars')
  eq(two[0], { start: 1320, end: 1440 }, 'up to midnight')
  eq(two[1], { start: 0, end: 480 }, 'and on from it')
}

// ── the presets are internally sound ───────────────────────────────────────
{
  for (const [key, preset] of Object.entries(PRESETS)) {
    const ids = preset.sessions.map((s) => s.id)
    eq(ids.length, new Set(ids).size, `${key}: session ids are unique`)
    ok(preset.sessions.every((s) => s.start !== s.end), `${key}: no zero-length session`)
    ok(preset.sessions.every((s) => s.label), `${key}: every session is labelled`)
    // A preset that doesn't survive its own resolver would be a trap.
    eq(resolveSessions({ preset: key }).sessions.length, preset.sessions.length,
      `${key}: survives resolution intact`)
  }
}


// ── bySession across the two modes ─────────────────────────────────────────
//
// This was a real bug, found by looking at the page rather than the code: in
// windows mode the NY AM kill zone read "0 trades" while a trade taken inside
// it showed under Silver Bullet, the narrower window sitting within it.
{
  const { bySession } = await import('../src/lib/analytics.js')
  const at = (h, m = 0) => ({
    pnl: 100, fees: 0,
    traded_at: new Date(Date.UTC(2026, 7, 10, h, m)).toISOString(),
  })

  const ict = resolveSessions({ preset: 'ict' })
  const rows = bySession([at(14, 30)], ict)
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.count]))
  eq(byId['silver-bullet'], 1, 'the narrow window counts the trade')
  eq(byId['ny-am-killzone'], 1, 'and so does the window containing it')

  // In a partition the same trade must be counted exactly once, or the session
  // rows stop summing to the account total.
  const classic = resolveSessions({ preset: 'classic' })
  const total = bySession([at(14, 30), at(9), at(2)], classic)
    .reduce((s, r) => s + r.count, 0)
  eq(total, 3, 'a partition counts every trade exactly once')
}

console.log(`sessionConfig: ${checks} assertions passed`)
