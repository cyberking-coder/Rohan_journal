// ICT / SMC detection — Master PRD §56–59, under the §60 look-ahead rule.
//
// ── The one rule everything here is built around ───────────────────────────
// At bar T a strategy may see data timestamped at or before T. Nothing else.
// Not a future candle, not a swing point that needs later bars to confirm, not
// an FVG that gets filled tomorrow, and not the higher-timeframe candle
// currently forming.
//
// That rule is easy to state and easy to break by accident, because the
// natural way to write each of these detectors is to scan the whole array. A
// swing high is the obvious case: you cannot know bar 40 was a swing high
// until bar 43 has printed, so a detector that reports it "at bar 40" has
// leaked three bars of the future into the past. Every function here therefore
// takes an explicit `upto` index and reports, alongside each object, the bar
// at which it became knowable.
//
// The test suite verifies this structurally rather than by inspection: it runs
// every detector over every prefix of a series and asserts that nothing ever
// changes retroactively. If a detector peeks, the answer at bar 40 computed
// from 50 bars differs from the answer computed from 41, and the test fails.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slice(candles, upto) {
  const end = Math.min(
    Number.isFinite(upto) ? upto : (candles?.length ?? 0) - 1,
    (candles?.length ?? 0) - 1,
  )
  return { list: candles || [], end }
}

const mid = (c) => (c.h + c.l) / 2

// ---------------------------------------------------------------------------
// Swings — §58
// ---------------------------------------------------------------------------

/**
 * Swing highs and lows.
 *
 * A swing high at index i is a bar whose high exceeds the `strength` bars on
 * either side. The right-hand side is the problem: it does not exist yet at
 * bar i. So a swing is only emitted once bar `i + strength` has printed, and
 * carries both `index` (where the swing is) and `confirmedAt` (when you were
 * allowed to know).
 *
 * Ties are resolved by strict inequality on the right and non-strict on the
 * left, so a flat double top confirms once rather than twice or never.
 */
export function swings(candles, upto, strength = 2) {
  const { list, end } = slice(candles, upto)
  const out = []
  const s = Math.max(1, Math.floor(strength))

  for (let i = s; i + s <= end; i++) {
    const c = list[i]
    let high = true
    let low = true
    for (let k = 1; k <= s; k++) {
      if (!(c.h >= list[i - k].h) || !(c.h > list[i + k].h)) high = false
      if (!(c.l <= list[i - k].l) || !(c.l < list[i + k].l)) low = false
      if (!high && !low) break
    }
    if (high) out.push({ kind: 'high', index: i, price: c.h, at: c.t, confirmedAt: i + s })
    if (low) out.push({ kind: 'low', index: i, price: c.l, at: c.t, confirmedAt: i + s })
  }

  return out
}

// ---------------------------------------------------------------------------
// Fair value gaps — §57
// ---------------------------------------------------------------------------

/**
 * Fair value gaps, exactly as the PRD defines them:
 *
 *   bullish — candle 1 high < candle 3 low
 *   bearish — candle 1 low  > candle 3 high
 *
 * The gap becomes knowable when candle 3 closes, so `createdAt` is that index.
 * It cannot be dated to candle 2, which is where it is usually drawn.
 *
 * Fill and invalidation are tracked only as far as `upto`, so a gap that gets
 * filled later is still reported as open when the cursor sits before the fill
 * — which is what a replay needs, and the opposite of what a whole-array scan
 * would produce.
 */
export function fairValueGaps(candles, upto, { minSize = 0 } = {}) {
  const { list, end } = slice(candles, upto)
  const out = []

  for (let i = 2; i <= end; i++) {
    const a = list[i - 2]
    const c = list[i]

    let direction = null
    let top = null
    let bottom = null

    if (a.h < c.l) { direction = 'bullish'; bottom = a.h; top = c.l }
    else if (a.l > c.h) { direction = 'bearish'; bottom = c.h; top = a.l }
    if (!direction) continue

    const size = top - bottom
    // A one-tick gap is noise on most instruments and clutters the chart with
    // hundreds of objects. Zero by default so nothing is hidden unasked.
    if (size <= minSize) continue

    const gap = {
      id: `fvg-${c.t}-${direction}`,
      direction,
      top,
      bottom,
      size,
      midpoint: (top + bottom) / 2,
      index: i - 1,          // where it is drawn: the middle candle
      createdAt: i,          // when it became knowable: candle 3's close
      at: c.t,
      filledAt: null,
      invalidatedAt: null,
      status: 'open',
    }

    // Walk forward from the bar after creation, stopping at the cursor.
    for (let j = i + 1; j <= end; j++) {
      const b = list[j]
      // Fully traded through: the gap no longer exists as an imbalance.
      const through = gap.direction === 'bullish' ? b.l <= gap.bottom : b.h >= gap.top
      // Touched: price has come back into the gap without closing it.
      const touched = gap.direction === 'bullish' ? b.l <= gap.top : b.h >= gap.bottom

      if (through) { gap.invalidatedAt = j; gap.status = 'invalidated'; break }
      if (touched && gap.filledAt === null) { gap.filledAt = j; gap.status = 'filled' }
    }

    out.push(gap)
  }

  return out
}

// ---------------------------------------------------------------------------
// Market structure — BOS and CHOCH
// ---------------------------------------------------------------------------

/**
 * Break of structure and change of character.
 *
 * BOS   — price takes out the last swing in the direction of the trend.
 * CHOCH — the first break against it, which is what marks a possible turn.
 *
 * The distinction is entirely about the prevailing direction, so the engine
 * carries a bias and re-labels accordingly. A break is only recognised against
 * a swing that had already been *confirmed* at the time of the break, which is
 * the look-ahead trap here: using the swing's own index instead of its
 * confirmation index lets a break be detected before the level was knowable.
 */
export function structure(candles, upto, { strength = 2 } = {}) {
  const { list, end } = slice(candles, upto)
  const points = swings(candles, end, strength)
  const events = []

  let bias = null
  let lastHigh = null
  let lastLow = null

  for (let i = 0; i <= end; i++) {
    // Adopt any swing confirmed by this bar — never one confirmed later.
    for (const p of points) {
      if (p.confirmedAt !== i) continue
      if (p.kind === 'high') lastHigh = p
      else lastLow = p
    }

    const c = list[i]

    if (lastHigh && c.c > lastHigh.price && lastHigh.confirmedAt < i) {
      events.push({
        kind: bias === 'bearish' ? 'choch' : 'bos',
        direction: 'bullish',
        price: lastHigh.price,
        index: i,
        at: c.t,
        brokeSwingAt: lastHigh.at,
      })
      bias = 'bullish'
      lastHigh = null   // consumed: it cannot be broken twice
    } else if (lastLow && c.c < lastLow.price && lastLow.confirmedAt < i) {
      events.push({
        kind: bias === 'bullish' ? 'choch' : 'bos',
        direction: 'bearish',
        price: lastLow.price,
        index: i,
        at: c.t,
        brokeSwingAt: lastLow.at,
      })
      bias = 'bearish'
      lastLow = null
    }
  }

  return { events, bias }
}

// ---------------------------------------------------------------------------
// Liquidity — §58
// ---------------------------------------------------------------------------

/**
 * Liquidity levels: equal highs and lows, and the previous day's extremes.
 *
 * Equal highs are the ones traders actually watch — a cluster of stops sitting
 * above an obvious level. "Equal" needs a tolerance, expressed as a fraction of
 * the recent range rather than in price units, so it holds on gold and on
 * EURUSD without configuration.
 */
export function liquidityLevels(candles, upto, { strength = 2, tolerance = 0.0005 } = {}) {
  const { list, end } = slice(candles, upto)
  if (end < 1) return []

  const points = swings(candles, end, strength)
  const levels = []

  // Scale the tolerance to the instrument using the span actually seen so far.
  let hi = -Infinity
  let lo = Infinity
  for (let i = 0; i <= end; i++) { hi = Math.max(hi, list[i].h); lo = Math.min(lo, list[i].l) }
  const band = Math.max((hi - lo) * tolerance, 0)

  for (const kind of ['high', 'low']) {
    const of = points.filter((p) => p.kind === kind)
    const used = new Set()
    for (let a = 0; a < of.length; a++) {
      if (used.has(a)) continue
      const group = [of[a]]
      for (let b = a + 1; b < of.length; b++) {
        if (used.has(b)) continue
        if (Math.abs(of[b].price - of[a].price) <= band) { group.push(of[b]); used.add(b) }
      }
      if (group.length < 2) continue
      used.add(a)
      levels.push({
        type: kind === 'high' ? 'equal-highs' : 'equal-lows',
        price: group.reduce((s, p) => s + p.price, 0) / group.length,
        touches: group.length,
        // Knowable only once the LAST of the equal swings is confirmed.
        confirmedAt: Math.max(...group.map((p) => p.confirmedAt)),
        at: group[group.length - 1].at,
        sweptAt: null,
        status: 'open',
      })
    }
  }

  // Previous day's high and low. The current day's are excluded on purpose:
  // they are not final until the day closes, and treating a still-forming
  // extreme as a level is the look-ahead rule broken in slow motion.
  const days = new Map()
  for (let i = 0; i <= end; i++) {
    const key = Math.floor(list[i].t / 86400000)
    const d = days.get(key) || { h: -Infinity, l: Infinity, last: i }
    d.h = Math.max(d.h, list[i].h)
    d.l = Math.min(d.l, list[i].l)
    d.last = i
    days.set(key, d)
  }
  const keys = [...days.keys()].sort((a, b) => a - b)
  const today = Math.floor(list[end].t / 86400000)
  for (const key of keys) {
    if (key >= today) continue
    const d = days.get(key)
    levels.push({ type: 'pdh', price: d.h, confirmedAt: d.last, at: key * 86400000, sweptAt: null, status: 'open', touches: 1 })
    levels.push({ type: 'pdl', price: d.l, confirmedAt: d.last, at: key * 86400000, sweptAt: null, status: 'open', touches: 1 })
  }

  return markSweeps(levels, list, end)
}

/**
 * A sweep is a level taken and then rejected — price trades through it and
 * closes back the other side.
 *
 * Trading through and staying through is not a sweep, it is a break, and
 * conflating them is what turns this indicator into noise: every level is
 * eventually crossed.
 */
function markSweeps(levels, list, end) {
  for (const level of levels) {
    const above = level.type === 'equal-highs' || level.type === 'pdh'
    for (let j = level.confirmedAt + 1; j <= end; j++) {
      const b = list[j]
      const pierced = above ? b.h > level.price : b.l < level.price
      if (!pierced) continue
      const closedBack = above ? b.c < level.price : b.c > level.price
      if (closedBack) {
        level.sweptAt = j
        level.sweptTime = b.t
        level.status = 'swept'
      } else {
        level.status = 'broken'
        level.brokenAt = j
      }
      break
    }
  }
  return levels
}

// ---------------------------------------------------------------------------
// Premium / discount
// ---------------------------------------------------------------------------

/**
 * Where price sits in the dealing range, as ICT frames it: above the midpoint
 * is premium (where you want to be selling), below is discount.
 *
 * The range is taken from the confirmed swings, not from the raw high and low
 * of the window — the raw extremes include the bar currently forming, which
 * moves the "equilibrium" under the trader's feet as the candle ticks.
 */
export function premiumDiscount(candles, upto, { strength = 2, lookback = 100 } = {}) {
  const { list, end } = slice(candles, upto)
  if (end < 0) return null

  const from = Math.max(0, end - lookback)
  const points = swings(candles, end, strength).filter((p) => p.index >= from && p.confirmedAt <= end)
  const highs = points.filter((p) => p.kind === 'high')
  const lows = points.filter((p) => p.kind === 'low')
  if (!highs.length || !lows.length) return null

  const high = Math.max(...highs.map((p) => p.price))
  const low = Math.min(...lows.map((p) => p.price))
  if (!(high > low)) return null

  const price = list[end].c
  const equilibrium = (high + low) / 2
  const position = (price - low) / (high - low)

  return {
    high,
    low,
    equilibrium,
    price,
    position,
    zone: position > 0.5 ? 'premium' : position < 0.5 ? 'discount' : 'equilibrium',
    // The 0.62–0.79 retracement ICT calls optimal trade entry.
    inOTE: position >= 0.21 && position <= 0.38 ? 'bullish'
      : position >= 0.62 && position <= 0.79 ? 'bearish' : null,
  }
}

// ---------------------------------------------------------------------------
// Higher timeframe — §59
// ---------------------------------------------------------------------------

/**
 * Aggregate to a higher timeframe, emitting CLOSED candles only.
 *
 * This is the whole of §59 and the easiest place in the codebase to introduce
 * look-ahead without noticing. At 10:07 on a 5-minute chart the 4-hour candle
 * covering 08:00–12:00 has not closed; its high, low and close are all still
 * moving. Including it would let a strategy read four hours into the future,
 * and it would look completely reasonable on the chart.
 *
 * So the bucket containing the cursor is dropped. A strategy asking for 4H
 * bias at 10:07 gets the 04:00–08:00 candle, which is the most recent thing it
 * is entitled to know.
 */
export function higherTimeframe(candles, upto, minutes) {
  const { list, end } = slice(candles, upto)
  const ms = Math.max(1, Math.floor(minutes)) * 60000
  if (end < 0) return []

  const buckets = new Map()
  for (let i = 0; i <= end; i++) {
    const c = list[i]
    const key = Math.floor(c.t / ms) * ms
    const b = buckets.get(key)
    if (!b) buckets.set(key, { t: key, o: c.o, h: c.h, l: c.l, c: c.c, lastIndex: i })
    else {
      b.h = Math.max(b.h, c.h)
      b.l = Math.min(b.l, c.l)
      b.c = c.c
      b.lastIndex = i
    }
  }

  const currentKey = Math.floor(list[end].t / ms) * ms
  return [...buckets.values()]
    .filter((b) => b.t < currentKey)   // the forming bucket is not knowable
    .sort((a, b) => a.t - b.t)
}

/**
 * Directional bias from a higher timeframe.
 *
 * Deliberately simple — structure on the aggregated series, falling back to
 * the last closed candle's own direction when there isn't enough history for
 * a swing. An elaborate bias model would be guessing with more steps; what
 * matters for §59 is that the input is closed candles only.
 */
export function htfBias(candles, upto, minutes, { strength = 2 } = {}) {
  const bars = higherTimeframe(candles, upto, minutes)
  if (!bars.length) return { bias: null, reason: 'no closed higher-timeframe candle yet', bars: 0 }

  const st = structure(bars, bars.length - 1, { strength })
  if (st.bias) {
    const last = st.events[st.events.length - 1]
    return { bias: st.bias, reason: `${last.kind.toUpperCase()} ${last.direction}`, bars: bars.length, events: st.events }
  }

  const last = bars[bars.length - 1]
  return {
    bias: last.c > last.o ? 'bullish' : last.c < last.o ? 'bearish' : null,
    reason: 'no structural break yet — using the last closed candle',
    bars: bars.length,
    events: st.events,
  }
}

// ---------------------------------------------------------------------------
// One call for the whole picture
// ---------------------------------------------------------------------------

/**
 * Everything knowable at `upto`, in one object.
 *
 * `htf` is a list of minute values — [240, 60] for 4H and 1H. Passing them
 * here rather than calling higherTimeframe separately keeps the look-ahead
 * boundary in one place.
 */
export function analyse(candles, upto, { strength = 2, htf = [240], minFvgSize = 0 } = {}) {
  const { end } = slice(candles, upto)
  if (end < 0) return null

  const gaps = fairValueGaps(candles, end, { minSize: minFvgSize })
  const levels = liquidityLevels(candles, end, { strength })
  const st = structure(candles, end, { strength })

  return {
    at: candles[end].t,
    index: end,
    swings: swings(candles, end, strength),
    fvgs: gaps,
    openFvgs: gaps.filter((g) => g.status !== 'invalidated'),
    levels,
    sweeps: levels.filter((l) => l.status === 'swept'),
    structure: st.events,
    bias: st.bias,
    range: premiumDiscount(candles, end, { strength }),
    htf: htf.map((m) => ({ minutes: m, ...htfBias(candles, end, m, { strength }) })),
  }
}

/**
 * Does the current picture line up across timeframes?
 *
 * The §59 example in one function: higher-timeframe bias, a liquidity sweep
 * against it, and a fresh gap in the direction of the bias. Reported as the
 * pieces present rather than as a signal, because "three things agree" is a
 * reason to look, not an instruction to trade.
 */
export function confluence(picture, { within = 20 } = {}) {
  if (!picture) return { aligned: false, parts: [] }
  const bias = picture.htf[0]?.bias || picture.bias
  if (!bias) return { aligned: false, parts: [], bias: null }

  const recent = (i) => picture.index - i <= within

  const sweep = picture.sweeps.find((l) => recent(l.sweptAt)
    && (bias === 'bullish' ? l.type === 'equal-lows' || l.type === 'pdl'
      : l.type === 'equal-highs' || l.type === 'pdh'))

  const gap = picture.openFvgs.find((g) => recent(g.createdAt) && g.direction === bias)

  const inZone = picture.range
    && (bias === 'bullish' ? picture.range.zone === 'discount' : picture.range.zone === 'premium')

  const parts = [
    { name: 'HTF bias', met: true, detail: `${bias} on ${picture.htf[0]?.minutes ?? '?'}m` },
    { name: 'Liquidity swept', met: !!sweep, detail: sweep ? `${sweep.type} at ${sweep.price.toFixed(5)}` : 'none recently' },
    { name: 'Fair value gap', met: !!gap, detail: gap ? `${gap.direction} ${gap.bottom.toFixed(5)}–${gap.top.toFixed(5)}` : 'none open in the bias direction' },
    { name: 'Premium/discount', met: !!inZone, detail: picture.range ? picture.range.zone : 'no range yet' },
  ]

  return {
    bias,
    parts,
    met: parts.filter((p) => p.met).length,
    aligned: parts.every((p) => p.met),
  }
}
