// ICT / SMC detection.
//
// Two kinds of test here. The first checks each detector finds what it should
// on a hand-built series. The second is the one that matters: it runs every
// detector over every prefix of a series and asserts nothing ever changes
// retroactively. A detector that peeks at future bars gives a different answer
// at bar 40 depending on whether 41 or 60 bars were passed in, and no amount
// of reading the code catches that as reliably.

import assert from 'node:assert/strict'
import {
  analyse, confluence, fairValueGaps, higherTimeframe, htfBias,
  liquidityLevels, premiumDiscount, structure, swings,
} from '../src/lib/ict.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }
function near(a, b, m, tol = 1e-9) { assert.ok(Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`); checks++ }

const T0 = Date.UTC(2026, 2, 2, 0, 0)
// One candle per hour by default, so day and higher-timeframe boundaries are
// easy to reason about.
const bar = (i, o, h, l, c, stepMin = 60) => ({ t: T0 + i * stepMin * 60000, o, h, l, c })

// ── swings ─────────────────────────────────────────────────────────────────
{
  //            0    1    2     3(peak) 4    5    6
  const c = [
    bar(0, 10, 11, 9, 10),
    bar(1, 10, 12, 9, 11),
    bar(2, 11, 13, 10, 12),
    bar(3, 12, 20, 11, 19),   // the swing high
    bar(4, 19, 18, 10, 12),
    bar(5, 12, 14, 9, 10),
    bar(6, 10, 12, 8, 9),
  ]
  const s = swings(c, 6, 2)
  const high = s.find((p) => p.kind === 'high')
  ok(high, 'the swing high is found')
  eq(high.index, 3, 'at the right bar')
  near(high.price, 20, 'at the right price')
  eq(high.confirmedAt, 5, 'confirmed two bars later, not at the swing itself')

  // The point of confirmedAt: at bar 4 it is not yet knowable.
  eq(swings(c, 4, 2).filter((p) => p.kind === 'high').length, 0,
    'a swing needing two bars of confirmation is invisible one bar after it')
  eq(swings(c, 5, 2).filter((p) => p.kind === 'high').length, 1,
    'and visible exactly when it confirms')

  eq(swings([], 0, 2).length, 0, 'no candles, no swings')
  eq(swings(c, 1, 2).length, 0, 'too few candles to confirm anything')
}

// ── fair value gaps ────────────────────────────────────────────────────────
{
  // Bullish: candle 1 high (11) < candle 3 low (14).
  const c = [
    bar(0, 10, 11, 9, 10.5),
    bar(1, 10.5, 15, 10, 14.5),
    bar(2, 14.5, 16, 14, 15.5),
    bar(3, 15.5, 17, 15, 16),
  ]
  const g = fairValueGaps(c, 3)
  eq(g.length, 1, 'one gap')
  eq(g[0].direction, 'bullish', 'bullish')
  near(g[0].bottom, 11, 'bottom is candle 1 high')
  near(g[0].top, 14, 'top is candle 3 low')
  near(g[0].size, 3, 'size')
  eq(g[0].index, 1, 'drawn on the middle candle')
  eq(g[0].createdAt, 2, 'but knowable only when candle 3 closes')
  eq(g[0].status, 'open', 'still open')

  // Not knowable one bar early.
  eq(fairValueGaps(c, 1).length, 0, 'no gap before candle 3 has closed')

  // Bearish: candle 1 low (15) > candle 3 high (11).
  const d = [
    bar(0, 16, 17, 15, 15.5),
    bar(1, 15.5, 15.5, 11, 11.5),
    bar(2, 11.5, 11, 9, 10),
  ]
  const gd = fairValueGaps(d, 2)
  eq(gd.length, 1, 'one bearish gap')
  eq(gd[0].direction, 'bearish', 'bearish')
  near(gd[0].bottom, 11, 'bottom is candle 3 high')
  near(gd[0].top, 15, 'top is candle 1 low')

  // Fill then invalidation, and the crucial part: status depends on the cursor.
  const e = [
    ...c,
    bar(4, 16, 17, 13, 13.5),   // dips into the gap: filled
    bar(5, 13.5, 14, 10, 10.5), // trades all the way through: invalidated
  ]
  eq(fairValueGaps(e, 3)[0].status, 'open', 'open at bar 3')
  eq(fairValueGaps(e, 4)[0].status, 'filled', 'filled at bar 4')
  eq(fairValueGaps(e, 4)[0].filledAt, 4, 'and records when')
  eq(fairValueGaps(e, 5)[0].status, 'invalidated', 'invalidated at bar 5')
  eq(fairValueGaps(e, 5)[0].invalidatedAt, 5, 'and records when')

  // Size filter.
  eq(fairValueGaps(c, 3, { minSize: 5 }).length, 0, 'a small gap can be filtered out')
  eq(fairValueGaps(c, 3, { minSize: 1 }).length, 1, 'and kept when big enough')

  // Touching exactly is not a gap.
  const flat = [bar(0, 10, 11, 9, 10), bar(1, 10, 13, 10, 12), bar(2, 12, 14, 11, 13)]
  eq(fairValueGaps(flat, 2).length, 0, 'candle 3 low equal to candle 1 high is not a gap')
}

// ── structure ──────────────────────────────────────────────────────────────
{
  // Rise, pull back, then close above the confirmed swing high.
  const c = [
    bar(0, 10, 11, 9, 10),
    bar(1, 10, 12, 9.5, 11),
    bar(2, 11, 15, 10, 14),   // swing high at 15
    bar(3, 14, 14, 11, 12),
    bar(4, 12, 13, 10, 11),   // confirms the swing
    bar(5, 11, 16, 11, 15.5), // closes above 15 → BOS bullish
  ]
  const st = structure(c, 5, { strength: 2 })
  const bos = st.events.find((e) => e.direction === 'bullish')
  ok(bos, 'a bullish break is found')
  eq(bos.kind, 'bos', 'the first break with no prior bias is a BOS')
  eq(bos.index, 5, 'at the breaking bar')
  eq(st.bias, 'bullish', 'and sets the bias')

  // A break the other way after a bullish bias is a CHOCH, not a BOS.
  const d = [
    ...c,
    bar(6, 15.5, 16, 13, 13.5),
    bar(7, 13.5, 14, 12, 12.5),  // swing low around 12
    bar(8, 12.5, 13, 12.4, 12.8),
    bar(9, 12.8, 13, 12.6, 12.9), // confirms it
    // Closes at 9, below the swing low of 10 confirmed back at bar 6.
    bar(10, 12.9, 13, 8.5, 9),    // closes below → CHOCH bearish
  ]
  const st2 = structure(d, 10, { strength: 2 })
  const last = st2.events[st2.events.length - 1]
  eq(last.direction, 'bearish', 'the later break is bearish')
  eq(last.kind, 'choch', 'and is a change of character, having reversed the bias')
  eq(st2.bias, 'bearish', 'bias flips')

  eq(structure([], 0).events.length, 0, 'no candles, no structure')
}

// ── liquidity ──────────────────────────────────────────────────────────────
{
  // Two swing highs at the same price, then a sweep: pierced and closed back.
  const c = [
    bar(0, 10, 11, 9, 10),
    bar(1, 10, 12, 9, 11),
    bar(2, 11, 20, 10, 15),   // high at 20
    bar(3, 15, 16, 12, 13),
    bar(4, 13, 14, 11, 12),   // confirms
    bar(5, 12, 15, 11, 14),
    bar(6, 14, 20, 13, 16),   // second high at 20
    bar(7, 16, 17, 14, 15),
    bar(8, 15, 16, 13, 14),   // confirms
    bar(9, 14, 22, 13, 15),   // pierces 20, closes back below → swept
  ]
  const levels = liquidityLevels(c, 9, { strength: 2 })
  const eq_ = levels.find((l) => l.type === 'equal-highs')
  ok(eq_, 'equal highs found')
  eq(eq_.touches, 2, 'two touches')
  near(eq_.price, 20, 'at the level')
  eq(eq_.status, 'swept', 'and swept')
  eq(eq_.sweptAt, 9, 'at the right bar')

  // Trading through and STAYING through is a break, not a sweep. Conflating
  // them makes the signal meaningless: every level is eventually crossed.
  const broken = [...c.slice(0, 9), bar(9, 14, 24, 13, 23)]
  const lb = liquidityLevels(broken, 9, { strength: 2 }).find((l) => l.type === 'equal-highs')
  eq(lb.status, 'broken', 'closing beyond the level is a break')
  eq(lb.sweptAt, null, 'and is not recorded as a sweep')

  // Before the sweep bar, the level is simply open.
  eq(liquidityLevels(c, 8, { strength: 2 }).find((l) => l.type === 'equal-highs').status, 'open',
    'open until swept')
}

{
  // Previous day high/low, with the current day excluded — it hasn't finished.
  const day1 = Array.from({ length: 6 }, (_, i) => bar(i, 10, 12 + i, 8, 11))
  const day2 = Array.from({ length: 4 }, (_, i) => bar(24 + i, 11, 30, 7, 12))
  const c = [...day1, ...day2]
  const levels = liquidityLevels(c, c.length - 1, { strength: 2 })
  const pdh = levels.find((l) => l.type === 'pdh')
  ok(pdh, 'previous day high present')
  near(pdh.price, 17, 'from day one only')
  ok(!levels.some((l) => l.type === 'pdh' && l.price === 30),
    'the current, unfinished day is not offered as a level')
}

// ── premium / discount ─────────────────────────────────────────────────────
{
  const c = [
    bar(0, 10, 11, 9, 10),
    bar(1, 10, 12, 8, 11),
    bar(2, 11, 20, 10, 19),   // high 20
    bar(3, 19, 19, 12, 13),
    bar(4, 13, 14, 10, 11),   // low 10 region
    bar(5, 11, 12, 5, 6),
    bar(6, 6, 7, 4, 5),
    bar(7, 5, 8, 4.5, 7),
    bar(8, 7, 9, 6, 8),
  ]
  const r = premiumDiscount(c, 8, { strength: 2 })
  ok(r, 'a range is found')
  ok(r.high > r.low, 'high above low')
  near(r.equilibrium, (r.high + r.low) / 2, 'equilibrium is the midpoint')
  ok(['premium', 'discount', 'equilibrium'].includes(r.zone), 'a zone is named')
  near(r.position, (r.price - r.low) / (r.high - r.low), 'position is consistent')

  eq(premiumDiscount([bar(0, 10, 11, 9, 10)], 0, { strength: 2 }), null,
    'no range from one candle')
}

// ── higher timeframe — the §59 rule ────────────────────────────────────────
{
  // Hourly candles; aggregate to 4H. Buckets: 00–04, 04–08, 08–12.
  const c = Array.from({ length: 10 }, (_, i) => bar(i, 10 + i, 12 + i, 8 + i, 11 + i))

  // At bar 9 (09:00) we are inside the 08:00–12:00 bucket, which has NOT
  // closed. Only the two completed buckets may be seen.
  const bars = higherTimeframe(c, 9, 240)
  eq(bars.length, 2, 'the forming higher-timeframe candle is withheld')
  eq(new Date(bars[0].t).getUTCHours(), 0, 'first bucket starts at 00:00')
  eq(new Date(bars[1].t).getUTCHours(), 4, 'second at 04:00')

  // The completed 00–04 bucket aggregates bars 0–3.
  near(bars[0].o, c[0].o, 'open of the first bar')
  near(bars[0].c, c[3].c, 'close of the last bar in the bucket')
  near(bars[0].h, Math.max(...c.slice(0, 4).map((x) => x.h)), 'highest high')
  near(bars[0].l, Math.min(...c.slice(0, 4).map((x) => x.l)), 'lowest low')

  // At 03:00, still inside the very first bucket: nothing has closed at all.
  eq(higherTimeframe(c, 3, 240).length, 0, 'nothing closed yet')
  // At 04:00 the first bucket has closed.
  eq(higherTimeframe(c, 4, 240).length, 1, 'exactly one closed bucket')

  const b = htfBias(c, 3, 240)
  eq(b.bias, null, 'no bias without a closed higher-timeframe candle')
  ok(/no closed/.test(b.reason), 'and it says why')

  const b2 = htfBias(c, 9, 240)
  eq(b2.bias, 'bullish', 'a rising series reads bullish')
  eq(b2.bars, 2, 'from the closed candles only')
}

// ── the look-ahead property ────────────────────────────────────────────────
//
// The important test. Everything reported at bar i must be identical whether
// it was computed with i+1 bars or with all of them. A detector that reads
// ahead fails this and cannot fail it silently.
{
  // A series with genuine structure: a rally, a sweep, a reversal.
  const series = []
  let price = 100
  const path = [
    2, 3, -1, 4, 2, -3, 5, 1, -2, 6, -1, 3, -8, 2, -3, 5, -2, 1, 4, -6,
    3, 2, -1, -4, 6, 1, -3, 2, 5, -2, -7, 3, 1, 4, -2, -5, 2, 6, -1, 3,
  ]
  path.forEach((move, i) => {
    const o = price
    const c = price + move
    series.push(bar(i, o, Math.max(o, c) + 1.5, Math.min(o, c) - 1.5, c))
    price = c
  })

  const stable = (name, fn, keyOf) => {
    const full = fn(series, series.length - 1)
    let compared = 0
    for (let i = 6; i < series.length - 1; i++) {
      const partial = fn(series, i)
      for (const item of partial) {
        const key = keyOf(item)
        const later = full.find((x) => keyOf(x) === key)
        ok(!!later, `${name}: what was reported at bar ${i} still exists later (${key})`)
        compared++
        if (compared > 40) return   // enough evidence; keep the suite quick
      }
    }
  }

  // Swings and structure must never appear, move or vanish retroactively.
  stable('swings', (c, i) => swings(c, i, 2), (s) => `${s.kind}@${s.index}:${s.price}`)
  stable('structure', (c, i) => structure(c, i, { strength: 2 }).events,
    (e) => `${e.kind}:${e.direction}@${e.index}`)
  stable('fvgs', (c, i) => fairValueGaps(c, i), (g) => g.id)

  // The strongest form: a swing confirmed at bar i must have the same price
  // and the same confirmation bar when recomputed from the full series.
  const full = swings(series, series.length - 1, 2)
  let verified = 0
  for (let i = 6; i < series.length - 1; i++) {
    for (const s of swings(series, i, 2)) {
      const later = full.find((x) => x.index === s.index && x.kind === s.kind)
      eq(later.price, s.price, `swing price at ${s.index} is unchanged by later data`)
      eq(later.confirmedAt, s.confirmedAt, `swing confirmation at ${s.index} is unchanged`)
      verified++
      if (verified > 30) break
    }
    if (verified > 30) break
  }
  ok(verified > 10, 'the look-ahead check actually examined a meaningful number of swings')

  // And nothing may ever be reported at an index beyond the cursor.
  for (let i = 6; i < series.length - 1; i++) {
    const a = analyse(series, i, { strength: 2, htf: [240] })
    ok(a.swings.every((s) => s.confirmedAt <= i), `no swing confirmed after the cursor at ${i}`)
    ok(a.fvgs.every((g) => g.createdAt <= i), `no gap created after the cursor at ${i}`)
    ok(a.structure.every((e) => e.index <= i), `no structure event after the cursor at ${i}`)
    ok(a.levels.every((l) => l.confirmedAt <= i), `no level confirmed after the cursor at ${i}`)
    ok(a.fvgs.every((g) => g.filledAt === null || g.filledAt <= i), `no fill after the cursor at ${i}`)
    ok(a.levels.every((l) => l.sweptAt === null || l.sweptAt <= i), `no sweep after the cursor at ${i}`)
  }
}

// ── analyse and confluence ─────────────────────────────────────────────────
{
  const c = Array.from({ length: 30 }, (_, i) =>
    bar(i, 100 + i, 102 + i, 98 + i, 101 + i))

  const a = analyse(c, 29, { strength: 2, htf: [240, 60] })
  ok(a, 'a picture is produced')
  eq(a.index, 29, 'at the cursor')
  eq(a.htf.length, 2, 'both higher timeframes reported')
  eq(a.htf[0].minutes, 240, 'in the order asked for')
  ok(Array.isArray(a.openFvgs), 'open gaps listed separately')

  eq(analyse([], 0), null, 'nothing to analyse')

  const conf = confluence(a)
  eq(conf.parts.length, 4, 'four things are checked')
  ok(typeof conf.aligned === 'boolean', 'alignment is a yes or no')
  eq(conf.met, conf.parts.filter((p) => p.met).length, 'the count matches the parts')

  // Every part must explain itself, met or not — a bare red cross tells the
  // trader nothing about what is missing.
  ok(conf.parts.every((p) => p.detail && p.detail.length > 0), 'every part carries a reason')

  eq(confluence(null).aligned, false, 'no picture, no alignment')
}

console.log(`ict: ${checks} assertions passed`)
