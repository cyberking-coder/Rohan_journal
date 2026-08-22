import {
  ambiguityReport, closePosition, detectTimeframe, floatingPnl, indexAtOrBefore,
  openPosition, parseCandles, positionPnl, replay, resolveExit, step,
  toTradeRows, validateOrder,
} from '../src/lib/backtest.js'
import { computeAnalytics } from '../src/lib/analytics.js'

let fails = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol
    : JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`)
}
const throws = (label, fn) => {
  try { fn() } catch (e) { console.log(`PASS  ${label.padEnd(50)} rejected: ${e.message}`); return }
  fails++
  console.log(`FAIL  ${label.padEnd(50)} should have thrown`)
}

const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 0 })

console.log('— parsing candle files —')
const csv = `time,open,high,low,close,volume
2026-08-10T09:00:00Z,1.1000,1.1050,1.0980,1.1020,500
2026-08-10T10:00:00Z,1.1020,1.1080,1.1010,1.1070,600`
eq('CSV rows', parseCandles(csv).candles.length, 2)
eq('CSV close', parseCandles(csv).candles[1].c, 1.107)
eq('CSV time', new Date(parseCandles(csv).candles[0].t).toISOString(), '2026-08-10T09:00:00.000Z')

// MetaTrader: tab-separated, angle-bracket headers, dotted dates, and the
// date and time in two separate columns.
const mt5 = `<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>
2026.08.10\t09:00:00\t1.10000\t1.10500\t1.09800\t1.10200\t500
2026.08.10\t10:00:00\t1.10200\t1.10800\t1.10100\t1.10700\t600`
const mt = parseCandles(mt5)
eq('MT5 rows', mt.candles.length, 2)
// The classic MT5 trap: dropping the separate time column collapses every
// candle in a day onto midnight, and the whole replay is silently wrong.
eq('MT5 keeps time of day', new Date(mt.candles[0].t).toISOString(), '2026-08-10T09:00:00.000Z')
eq('MT5 second bar', new Date(mt.candles[1].t).toISOString(), '2026-08-10T10:00:00.000Z')

eq('JSON objects', parseCandles('[{"time":"2026-08-10T09:00:00Z","open":1,"high":2,"low":0.5,"close":1.5}]').candles.length, 1)
eq('JSON arrays', parseCandles('[[1786690800,1,2,0.5,1.5,100]]').candles[0].c, 1.5)
eq('wrapped in an object', parseCandles('{"candles":[[1786690800,1,2,0.5,1.5]]}').candles.length, 1)
eq('epoch seconds scaled to ms', parseCandles('[[1786690800,1,2,0.5,1.5]]').candles[0].t, 1786690800000)
eq('epoch ms left alone', parseCandles('[[1786690800000,1,2,0.5,1.5]]').candles[0].t, 1786690800000)
eq('headerless csv', parseCandles('2026-08-10T09:00:00Z,1,2,0.5,1.5').candles.length, 1)
eq('semicolon delimited', parseCandles('time;open;high;low;close\n2026-08-10T09:00:00Z;1;2;0.5;1.5').candles.length, 1)

// Order in the file is not guaranteed — some exports are newest-first, and
// replaying backwards would be nonsense.
const reversed = parseCandles(`time,open,high,low,close
2026-08-10T10:00:00Z,2,2,2,2
2026-08-10T09:00:00Z,1,1,1,1`)
eq('sorted chronologically', reversed.candles.map((c) => c.c), [1, 2])

// A concatenated export repeats bars; replaying one twice lets a stop trigger
// on a bar that never existed.
const dupes = parseCandles(`time,open,high,low,close
2026-08-10T09:00:00Z,1,1,1,1
2026-08-10T09:00:00Z,1,1,1,1`)
eq('duplicate timestamps dropped', dupes.candles.length, 1)
eq('and reported', dupes.duplicates, 1)

// A corrupt bar would fill at a price that never traded.
const corrupt = parseCandles(`time,open,high,low,close
2026-08-10T09:00:00Z,1.10,1.09,1.08,1.10
2026-08-10T10:00:00Z,1.10,1.12,1.08,1.11`)
eq('high-below-open rejected', corrupt.candles.length, 1)
eq('and counted', corrupt.skipped, 1)

throws('empty file', () => parseCandles(''))
throws('no OHLC columns', () => parseCandles('foo,bar\n1,2'))
throws('nothing usable', () => parseCandles('time,open,high,low,close\nrubbish,x,y,z,w'))
throws('broken json', () => parseCandles('[{'))

const hourly = Array.from({ length: 10 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 7, 10, 9 + i)).toISOString(), open: 1, high: 2, low: 0.5, close: 1.5,
}))
eq('timeframe detected', detectTimeframe(parseCandles(JSON.stringify(hourly)).candles), 'H1')
eq('too few candles', detectTimeframe([bar(1, 1, 1, 1, 1)]), null)

console.log('\n— order validation —')
eq('valid long', validateOrder({ side: 'Long', lots: 0.1, entry: 1.10, stopLoss: 1.09, takeProfit: 1.12 }), [])
// A stop on the wrong side of entry isn't a stop; the engine would close the
// position on the very next candle at a price the trader never intended.
eq('long stop above entry', validateOrder({ side: 'Long', lots: 0.1, entry: 1.10, stopLoss: 1.11 }).length, 1)
eq('short stop below entry', validateOrder({ side: 'Short', lots: 0.1, entry: 1.10, stopLoss: 1.09 }).length, 1)
eq('long target below entry', validateOrder({ side: 'Long', lots: 0.1, entry: 1.10, takeProfit: 1.09 }).length, 1)
eq('short target above entry', validateOrder({ side: 'Short', lots: 0.1, entry: 1.10, takeProfit: 1.11 }).length, 1)
eq('zero lots', validateOrder({ side: 'Long', lots: 0, entry: 1.10 }).length, 1)
eq('no direction', validateOrder({ lots: 0.1, entry: 1.10 }).length, 1)
// Both problems reported at once, not one per attempt.
eq('reports every problem', validateOrder({ side: 'Long', lots: 0, entry: 1.10, stopLoss: 1.2 }).length, 2)
eq('SL and TP are optional', validateOrder({ side: 'Long', lots: 0.1, entry: 1.10 }), [])

console.log('\n— fills —')
const long = openPosition({ symbol: 'EURUSD', side: 'Long', lots: 1, entry: 1.10, stopLoss: 1.09, takeProfit: 1.12, at: 1000 })
const short = openPosition({ symbol: 'EURUSD', side: 'Short', lots: 1, entry: 1.10, stopLoss: 1.11, takeProfit: 1.08, at: 1000 })

eq('no touch', resolveExit(long, bar(2000, 1.10, 1.115, 1.095, 1.105)), null)
eq('long stop', resolveExit(long, bar(2000, 1.10, 1.105, 1.085, 1.09)).reason, 'stop')
eq('long stop fills at the level', resolveExit(long, bar(2000, 1.10, 1.105, 1.085, 1.09)).price, 1.09)
eq('long target', resolveExit(long, bar(2000, 1.10, 1.125, 1.099, 1.12)).reason, 'target')
eq('short stop', resolveExit(short, bar(2000, 1.10, 1.115, 1.095, 1.11)).reason, 'stop')
eq('short target', resolveExit(short, bar(2000, 1.10, 1.105, 1.075, 1.08)).reason, 'target')

// THE one that decides whether a backtester tells the truth. A bar spanning
// both levels cannot say which came first — that lives in ticks the file
// doesn't carry. Assuming the target turns every ambiguous bar into a win and
// makes a losing strategy read as profitable.
const both = resolveExit(long, bar(2000, 1.10, 1.125, 1.085, 1.10))
eq('bar spanning both resolves to the stop', both.reason, 'stop')
eq('and is flagged ambiguous', both.ambiguous, true)
eq('short spanning both is also the stop', resolveExit(short, bar(2000, 1.10, 1.115, 1.075, 1.10)).reason, 'stop')
// An unambiguous fill must NOT be flagged, or the warning becomes noise.
eq('clean stop is not ambiguous', resolveExit(long, bar(2000, 1.10, 1.105, 1.085, 1.09)).ambiguous, false)
eq('clean target is not ambiguous', resolveExit(long, bar(2000, 1.10, 1.125, 1.099, 1.12)).ambiguous, false)

// A gap is the one case that ISN'T ambiguous: price was never at the level,
// so the fill is the open.
const gapDown = resolveExit(long, bar(2000, 1.08, 1.085, 1.075, 1.08))
eq('gap through the stop fills at the open', gapDown.price, 1.08)
eq('gap is not ambiguous', gapDown.ambiguous, false)
eq('gap flagged', gapDown.gapped, true)
const gapUp = resolveExit(long, bar(2000, 1.13, 1.135, 1.125, 1.13))
eq('gap through the target fills at the open', gapUp.price, 1.13)
eq('gapped target reason', gapUp.reason, 'target')

eq('no stop set', resolveExit(openPosition({ symbol: 'EURUSD', side: 'Long', lots: 1, entry: 1.10, takeProfit: 1.12, at: 1000 }), bar(2000, 1.10, 1.11, 1.00, 1.05)), null)

console.log('\n— stepping —')
// A position opened at a candle's close cannot be filled by that same candle:
// its high and low already happened.
const same = step([long], bar(1000, 1.10, 1.125, 1.085, 1.10))
eq('not filled by its own candle', same.open.length, 1)
eq('nothing closed', same.closed.length, 0)

const later = step([long], bar(2000, 1.10, 1.105, 1.085, 1.09))
eq('filled by a later candle', later.closed.length, 1)
eq('and removed from open', later.open.length, 0)
eq('P&L recorded', later.closed[0].pnl, -1000)
eq('ambiguity carried through', later.closed[0].ambiguous, false)

// Two positions, only one of which is hit.
const mixed = step([long, short], bar(2000, 1.10, 1.105, 1.085, 1.09))
eq('one closes, one survives', [mixed.closed.length, mixed.open.length], [1, 1])

console.log('\n— P&L —')
// 1.0 lot EURUSD = 100,000 units, so a 0.01 move is $1,000.
eq('long profit', positionPnl(long, 1.11), 1000)
eq('long loss', positionPnl(long, 1.09), -1000)
eq('short profit', positionPnl(short, 1.09), 1000)
eq('short loss', positionPnl(short, 1.11), -1000)
// Gold: 1.0 lot = 100oz, so a $1 move is $100.
const gold = openPosition({ symbol: 'XAUUSD', side: 'Long', lots: 1, entry: 2000, at: 1000 })
eq('gold contract size', positionPnl(gold, 2001), 100)
eq('fractional lots', positionPnl(openPosition({ symbol: 'EURUSD', side: 'Long', lots: 0.1, entry: 1.10, at: 1 }), 1.11), 100)
eq('floating across positions', floatingPnl([long, short], 1.11), 0)

console.log('\n— scoring reuses the real analytics engine —')
const closed = [
  closePosition(openPosition({ symbol: 'EURUSD', side: 'Long', lots: 1, entry: 1.10, at: Date.parse('2026-08-10T09:00:00Z') }),
    { price: 1.11, at: Date.parse('2026-08-10T11:00:00Z'), reason: 'target' }),
  closePosition(openPosition({ symbol: 'EURUSD', side: 'Long', lots: 1, entry: 1.10, at: Date.parse('2026-08-11T09:00:00Z') }),
    { price: 1.095, at: Date.parse('2026-08-11T11:00:00Z'), reason: 'stop' }),
]
const rows = toTradeRows(closed)
const scored = computeAnalytics(rows, rows)
eq('trade count', scored.tradeCount, 2)
eq('win rate', scored.winRate, 50)
eq('net P&L', scored.totalPnl, 500)
eq('profit factor', scored.profitFactor, 2)
// The whole reason for mapping onto the real trade shape: hold time only works
// if opened_at and closed_at both survive the mapping.
eq('hold time survives', scored.avgHoldMinutes, 120)

console.log('\n— ambiguity is reported, not hidden —')
const amb = [
  { ...closed[0], ambiguous: true, takeProfit: 1.12, pnl: -500, entry: 1.10, lots: 1, side: 'Long', symbol: 'EURUSD', contractSize: 100000 },
  { ...closed[1], ambiguous: false },
]
const report = ambiguityReport(amb)
eq('counted', report.count, 1)
eq('as a percentage', report.pct, 50)
// The swing says what the result would have been under the optimistic reading
// — the honest way to size the uncertainty rather than quietly picking one.
eq('swing to the optimistic reading', report.swing, 2500)
eq('no ambiguity, no swing', ambiguityReport([{ ...closed[1], ambiguous: false }]).swing, 0)
eq('empty is safe', ambiguityReport([]).pct, 0)

console.log('\n— deterministic replay from actions —')
// Ten H1 bars drifting up, with one dip on bar 4 deep enough to hit a stop.
const H1 = Array.from({ length: 10 }, (_, i) => bar(1000 + i * 3600000, 1.10 + i * 0.001, 1.10 + i * 0.001 + 0.0008, 1.10 + i * 0.001 - 0.0008, 1.10 + i * 0.001 + 0.0005))
H1[4] = bar(H1[4].t, H1[4].o, H1[4].o + 0.0005, 1.0980, 1.0985)

const openAt0 = { type: 'open', at: H1[0].t, order: { symbol: 'EURUSD', side: 'Long', lots: 1, stopLoss: 1.0990, takeProfit: 1.2 } }

const full = replay(H1, [openAt0])
eq('the stop is found', full.closed.length, 1)
eq('filled at the stop', full.closed[0].exit, 1.099)
eq('nothing left open', full.open.length, 0)

// Rewinding must reproduce the state at that point, not the final one.
const early = replay(H1, [openAt0], 2)
eq('before the stop, still open', early.open.length, 1)
eq('and nothing closed yet', early.closed.length, 0)

// The bug this replaces: rebuilding from fills alone silently dropped trades
// the trader closed by hand — the position just vanished on a scrub.
const manual = replay(H1, [
  { type: 'open', at: H1[0].t, order: { symbol: 'EURUSD', side: 'Long', lots: 1 } },
  { type: 'close', at: H1[2].t, id: null },
])
// The close action needs the id the open produced; without it nothing closes,
// which is why the page threads the real id through.
eq('an unmatched close is ignored', manual.open.length, 1)

const openedId = replay(H1, [{ type: 'open', at: H1[0].t, order: { symbol: 'EURUSD', side: 'Long', lots: 1 } }], 0).open[0].id
const withManual = replay(H1, [
  { type: 'open', at: H1[0].t, order: { symbol: 'EURUSD', side: 'Long', lots: 1 } },
  { type: 'close', at: H1[2].t, id: openedId },
])
eq('manual close survives a replay', withManual.closed.length, 1)
eq('closed by hand', withManual.closed[0].reason, 'manual')
eq('and is not still open', withManual.open.length, 0)
// Replaying twice gives the same answer, which is what makes scrubbing safe.
eq('replay is deterministic', JSON.stringify(replay(H1, [openAt0])), JSON.stringify(replay(H1, [openAt0])))

// An action is applied at the close of the bar containing it, so an order
// placed mid-bar on a coarser series still lands on that bar.
const midBar = replay(H1, [{ ...openAt0, at: H1[0].t + 60000 }], 1)
eq('mid-bar action lands on the next bar', midBar.open.length, 1)
eq('and enters at that bar close', midBar.open[0].entry, H1[1].c)

console.log('\n— keeping your place across timeframes —')
eq('exact match', indexAtOrBefore(H1, H1[3].t), 3)
// The whole point: the same moment is a different index in a different series,
// so jumping by index would move you months.
eq('between bars rounds back', indexAtOrBefore(H1, H1[3].t + 1000), 3)
eq('before the start clamps', indexAtOrBefore(H1, 0), 0)
eq('after the end clamps', indexAtOrBefore(H1, H1[9].t + 99999999), 9)
eq('empty series', indexAtOrBefore([], 1000), -1)
eq('single bar', indexAtOrBefore([H1[0]], H1[0].t + 500), 0)

// A four-times-finer series covering the same span: the same instant must
// resolve to the same moment, not the same index.
const M15 = Array.from({ length: 40 }, (_, i) => bar(1000 + i * 900000, 1.1, 1.101, 1.099, 1.1))
eq('H1 bar 3 is M15 bar 12', indexAtOrBefore(M15, H1[3].t), 12)
eq('same moment, different index', M15[indexAtOrBefore(M15, H1[3].t)].t, H1[3].t)

console.log(fails ? `\n${fails} FAILED` : '\nAll backtest assertions passed.')
process.exit(fails ? 1 : 0)
