// Deterministic-ish demo trade generator used when Supabase is not configured,
// so the UI is fully explorable out of the box.

const SYMBOLS = ['ES', 'NQ', 'EURUSD', 'BTCUSD', 'AAPL', 'TSLA', 'GBPUSD', 'GC']
const STRATEGIES = ['Breakout', 'FBD', 'Gapper', 'Reversal', 'Trend Pullback']
const SESSIONS = ['London', 'New York', 'Asia', 'Overlap']
const SIDES = ['Long', 'Short']

function rnd(seed) {
  // mulberry32
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function generateDemoTrades(count = 260) {
  const trades = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const r = (n) => rnd(i * 97 + n * 13)
    const daysBack = Math.floor(r(1) * 165)
    const d = new Date(now)
    d.setDate(d.getDate() - daysBack)
    d.setHours(6 + Math.floor(r(2) * 12), Math.floor(r(3) * 60), 0, 0)

    const side = SIDES[Math.floor(r(4) * SIDES.length)]
    const win = r(5) > 0.59
    const rr = 0.8 + r(6) * 2.6
    const risk = 60 + Math.floor(r(7) * 240)
    const pnl = win ? Math.round(risk * rr) : -Math.round(risk * (0.7 + r(8) * 0.5))
    const fees = 2 + Math.round(r(9) * 6)

    trades.push({
      id: `demo-${i}`,
      symbol: SYMBOLS[Math.floor(r(10) * SYMBOLS.length)],
      side,
      strategy: STRATEGIES[Math.floor(r(11) * STRATEGIES.length)],
      session: SESSIONS[Math.floor(r(12) * SESSIONS.length)],
      entry: +(100 + r(13) * 400).toFixed(2),
      exit: +(100 + r(14) * 400).toFixed(2),
      qty: 1 + Math.floor(r(15) * 5),
      pnl,
      fees,
      rr: +rr.toFixed(2),
      rating: 1 + Math.floor(r(16) * 5),
      notes: '',
      traded_at: d.toISOString(),
    })
  }
  return trades.sort((a, b) => new Date(a.traded_at) - new Date(b.traded_at))
}
