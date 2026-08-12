import {
  INSTRUMENTS, calculatePositionSize, fmtLots, fmtPipSize, getInstrument,
} from '../src/lib/pips.js'
import {
  MARKET_SESSIONS, isMarketClosed, isSessionOpen, openSessions,
  sessionSegments, utcHour, volumeLevel,
} from '../src/lib/sessions.js'

let fails = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' ? Math.abs(got - want) <= tol : got === want
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} got ${got}${ok ? '' : `  want ${want}`}`)
}

console.log('— position size: the example the spec verified on the live app —')
// Balance $10,000, risk 1%, stop 20 pips, XAUUSD (pip value $10/lot) -> 0.5 lots
const gold = calculatePositionSize({ balance: 10000, riskPercent: 1, stopLossPips: 20, pipValue: 10 })
eq('Risk amount', gold.riskAmount, 100)
eq('Standard lots', gold.standardLots, 0.5)
eq('Mini lots', gold.miniLots, 5)
eq('Micro lots', gold.microLots, 50)
eq('Loss at stop = risk amount', gold.lossAtStop, 100)
eq('Units', gold.units, 50000)

console.log('— the formula holds across inputs —')
const a = calculatePositionSize({ balance: 5000, riskPercent: 2, stopLossPips: 25, pipValue: 10 })
eq('$5k / 2% / 25 pips', a.standardLots, 0.4)
const b = calculatePositionSize({ balance: 25000, riskPercent: 0.5, stopLossPips: 50, pipValue: 6.7 })
eq('JPY pair sizing', Number(b.standardLots.toFixed(4)), 0.3731)
// Loss at stop must always equal the intended risk, whatever the inputs.
for (const [bal, r, sl, pv] of [[1000, 1, 10, 10], [77777, 3.7, 13, 6.5], [250, 5, 3, 50]]) {
  const res = calculatePositionSize({ balance: bal, riskPercent: r, stopLossPips: sl, pipValue: pv })
  eq(`Loss@stop==risk (${bal}/${r}%)`, Number(res.lossAtStop.toFixed(6)), Number(res.riskAmount.toFixed(6)))
}

console.log('— invalid input returns null, never NaN/Infinity —')
eq('Zero stop loss', calculatePositionSize({ balance: 1000, riskPercent: 1, stopLossPips: 0, pipValue: 10 }), null)
eq('Zero pip value', calculatePositionSize({ balance: 1000, riskPercent: 1, stopLossPips: 10, pipValue: 0 }), null)
eq('Empty balance', calculatePositionSize({ balance: '', riskPercent: 1, stopLossPips: 10, pipValue: 10 }), null)
eq('Negative balance', calculatePositionSize({ balance: -500, riskPercent: 1, stopLossPips: 10, pipValue: 10 }), null)
eq('Text balance', calculatePositionSize({ balance: 'abc', riskPercent: 1, stopLossPips: 10, pipValue: 10 }), null)

console.log('— instrument config —')
eq('XAUUSD pip value (spec)', getInstrument('XAUUSD').pipValue, 10)
eq('EURUSD pip value', getInstrument('EURUSD').pipValue, 10)
eq('EURUSD pip size', getInstrument('EURUSD').pipSize, 0.0001)
eq('Unknown symbol', getInstrument('NOPE'), null)
// The live app lists BTCUSD and ETHUSD twice; ours must not.
const symbols = INSTRUMENTS.map((i) => i.symbol)
eq('No duplicate symbols', new Set(symbols).size, symbols.length)
eq('Every instrument has a pip value', INSTRUMENTS.every((i) => i.pipValue > 0), true)
eq('Every instrument has a pip size', INSTRUMENTS.every((i) => i.pipSize > 0), true)
eq('Pip size formatting', fmtPipSize(0.0001), '0.0001')
eq('Pip size formatting (whole)', fmtPipSize(1), '1')
eq('Lot formatting', fmtLots(0.5), '0.50')

console.log('— market sessions —')
const at = (day, h) => new Date(Date.UTC(2026, 7, day, h, 0, 0)) // Aug 2026: 10th = Monday
eq('utcHour', utcHour(at(10, 14)), 14)
eq('London open at 10:00 UTC', isSessionOpen(MARKET_SESSIONS.find((s) => s.id === 'london'), 10), true)
eq('London shut at 18:00 UTC', isSessionOpen(MARKET_SESSIONS.find((s) => s.id === 'london'), 18), false)
// Sydney wraps past midnight, which is where a naive range check breaks.
const sydney = MARKET_SESSIONS.find((s) => s.id === 'sydney')
eq('Sydney open at 23:00', isSessionOpen(sydney, 23), true)
eq('Sydney open at 03:00', isSessionOpen(sydney, 3), true)
eq('Sydney shut at 12:00', isSessionOpen(sydney, 12), false)
eq('Sydney draws 2 segments', sessionSegments(sydney).length, 2)
eq('London draws 1 segment', sessionSegments(MARKET_SESSIONS.find((s) => s.id === 'london')).length, 1)

console.log('— weekend handling —')
eq('Mon 14:00 open', isMarketClosed(at(10, 14)), false)
eq('Sat 14:00 closed', isMarketClosed(at(15, 14)), true)
eq('Sun 12:00 closed', isMarketClosed(at(16, 12)), true)
eq('Sun 23:00 open (Sydney)', isMarketClosed(at(16, 23)), false)
eq('Fri 23:00 closed', isMarketClosed(at(14, 23)), true)
eq('No sessions on Saturday', openSessions(at(15, 14)).length, 0)

console.log('— volume heuristic —')
eq('London+NY overlap = High', volumeLevel(at(10, 15)).level, 'High')
eq('Weekend = Closed', volumeLevel(at(15, 15)).level, 'Closed')
// 11:00 UTC on a weekday: London only.
eq('London only = Medium', volumeLevel(at(10, 11)).level, 'Medium')

console.log(fails ? `\n${fails} FAILED` : '\nAll assertions passed.')
process.exit(fails ? 1 : 0)
