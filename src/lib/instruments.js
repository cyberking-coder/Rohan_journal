// Contract size = how many units of the underlying one standard (1.0) lot controls.
// P&L = priceMove × lots × contractSize.
//
// Gold (XAUUSD): 1.0 lot = 100 oz  -> $1.00 move = $100 per lot
//                0.1 lot = 10 oz   -> $1.00 move = $10
//                0.01 lot = 1 oz   -> $1.00 move = $1
// FX majors:     1.0 lot = 100,000 units -> 1 pip (0.0001) = $10 per lot
// Silver:        1.0 lot = 5,000 oz

const RULES = [
  { test: /(xau|gold|^gc$)/i, size: 100 },     // Gold
  { test: /(xag|silver|^si$)/i, size: 5000 },   // Silver
  { test: /(xpt|platinum)/i, size: 100 },       // Platinum
  { test: /(btc|eth|sol|xrp|doge|usdt)/i, size: 1 }, // Crypto (1 coin per lot)
  { test: /(us30|nas|ndx|spx|us500|ger|dax|dow)/i, size: 1 }, // Indices (1x)
]

// A 6-letter symbol made of two currency codes -> FX (100,000 units / lot).
const FX_CODES = /^(AUD|CAD|CHF|EUR|GBP|JPY|NZD|USD|SGD|HKD|MXN|ZAR|NOK|SEK|TRY)/i

export function contractSizeFor(symbol = '') {
  const s = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '')
  for (const r of RULES) if (r.test.test(s)) return r.size
  if (s.length === 6 && FX_CODES.test(s.slice(0, 3)) && FX_CODES.test(s.slice(3))) return 100000
  return 1
}

// Net dollar P&L from prices, lots and contract size.
export function computePnl({ entry, exit, lots, side, contractSize }) {
  const e = parseFloat(entry)
  const x = parseFloat(exit)
  const l = parseFloat(lots) || 0
  const c = parseFloat(contractSize) || 1
  if (!isFinite(e) || !isFinite(x)) return null
  const move = side === 'Long' ? x - e : e - x
  return Math.round(move * l * c * 100) / 100
}
