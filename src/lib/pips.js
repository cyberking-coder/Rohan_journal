import { canonical } from './symbols.js'
// Pip configuration for the Position Size Calculator.
//
// Kept separate from `instruments.js` (which is about contract sizes for P&L
// on already-closed trades) because this answers a different question: how
// much is one pip of movement worth on one standard lot, in USD.
//
// ── On accuracy ────────────────────────────────────────────────────────────
// Pip value is only a fixed constant when the pair is quoted in USD. For
// anything quoted in another currency (JPY, CHF, CAD, AUD, GBP crosses) the
// USD value moves with the exchange rate, so those entries are marked
// `approx: true` and carry the rate they were computed at. They are close
// enough to size a trade, and the calculator's "custom pip value" override
// exists for traders who want their broker's exact figure.
//
// Live rate lookup would make these exact — that arrives with the market data
// feed in phase 6.

const STANDARD_LOT = 100000

export const INSTRUMENT_CATEGORIES = ['forex', 'metal', 'index', 'crypto']

// pipValue is per 1.0 standard lot, in USD.
export const INSTRUMENTS = [
  // ── Metals ───────────────────────────────────────────────────────────────
  // Gold: 1.0 lot = 100 oz. A $0.10 move = $10 per lot, which matches the pip
  // value the spec verified against the live app.
  { symbol: 'XAUUSD', name: 'Gold', category: 'metal', pipSize: 0.1, pipValue: 10 },
  // Silver: 1.0 lot = 5,000 oz, so a $0.01 move = $50 per lot.
  { symbol: 'XAGUSD', name: 'Silver', category: 'metal', pipSize: 0.01, pipValue: 50 },

  // ── Forex quoted in USD — pip value is exact ─────────────────────────────
  { symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'forex', pipSize: 0.0001, pipValue: 10 },
  { symbol: 'GBPUSD', name: 'Pound / US Dollar', category: 'forex', pipSize: 0.0001, pipValue: 10 },
  { symbol: 'AUDUSD', name: 'Aussie / US Dollar', category: 'forex', pipSize: 0.0001, pipValue: 10 },
  { symbol: 'NZDUSD', name: 'Kiwi / US Dollar', category: 'forex', pipSize: 0.0001, pipValue: 10 },

  // ── Forex quoted in another currency — pip value moves with the rate ─────
  { symbol: 'USDJPY', name: 'US Dollar / Yen', category: 'forex', pipSize: 0.01, pipValue: 6.7, approx: 'at USD/JPY ≈ 150' },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', category: 'forex', pipSize: 0.0001, pipValue: 11.2, approx: 'at USD/CHF ≈ 0.89' },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', category: 'forex', pipSize: 0.0001, pipValue: 7.3, approx: 'at USD/CAD ≈ 1.37' },
  { symbol: 'EURGBP', name: 'Euro / Pound', category: 'forex', pipSize: 0.0001, pipValue: 12.7, approx: 'at GBP/USD ≈ 1.27' },
  { symbol: 'EURJPY', name: 'Euro / Yen', category: 'forex', pipSize: 0.01, pipValue: 6.7, approx: 'at USD/JPY ≈ 150' },
  { symbol: 'GBPJPY', name: 'Pound / Yen', category: 'forex', pipSize: 0.01, pipValue: 6.7, approx: 'at USD/JPY ≈ 150' },
  { symbol: 'AUDJPY', name: 'Aussie / Yen', category: 'forex', pipSize: 0.01, pipValue: 6.7, approx: 'at USD/JPY ≈ 150' },
  { symbol: 'EURAUD', name: 'Euro / Aussie', category: 'forex', pipSize: 0.0001, pipValue: 6.5, approx: 'at AUD/USD ≈ 0.65' },
  { symbol: 'GBPAUD', name: 'Pound / Aussie', category: 'forex', pipSize: 0.0001, pipValue: 6.5, approx: 'at AUD/USD ≈ 0.65' },

  // ── Indices — 1 point per lot, but contract specs vary by broker ─────────
  { symbol: 'US30', name: 'Dow Jones 30', category: 'index', pipSize: 1, pipValue: 1, approx: 'typical CFD spec' },
  { symbol: 'US100', name: 'Nasdaq 100', category: 'index', pipSize: 1, pipValue: 1, approx: 'typical CFD spec' },
  { symbol: 'US500', name: 'S&P 500', category: 'index', pipSize: 1, pipValue: 1, approx: 'typical CFD spec' },
  { symbol: 'GER40', name: 'DAX 40', category: 'index', pipSize: 1, pipValue: 1.1, approx: 'quoted in EUR, typical CFD spec' },
  { symbol: 'UK100', name: 'FTSE 100', category: 'index', pipSize: 1, pipValue: 1.27, approx: 'quoted in GBP, typical CFD spec' },

  // ── Crypto — 1 coin per lot on major pairs ──────────────────────────────
  { symbol: 'BTCUSD', name: 'Bitcoin', category: 'crypto', pipSize: 1, pipValue: 1, approx: '1 coin per lot' },
  { symbol: 'ETHUSD', name: 'Ethereum', category: 'crypto', pipSize: 1, pipValue: 1, approx: '1 coin per lot' },
  { symbol: 'SOLUSD', name: 'Solana', category: 'crypto', pipSize: 0.1, pipValue: 0.1, approx: '1 coin per lot' },
  { symbol: 'BNBUSD', name: 'BNB', category: 'crypto', pipSize: 0.1, pipValue: 0.1, approx: '1 coin per lot' },
  { symbol: 'LTCUSD', name: 'Litecoin', category: 'crypto', pipSize: 0.01, pipValue: 0.01, approx: '1 coin per lot' },
  { symbol: 'AVAXUSD', name: 'Avalanche', category: 'crypto', pipSize: 0.01, pipValue: 0.01, approx: '1 coin per lot' },
  { symbol: 'LINKUSD', name: 'Chainlink', category: 'crypto', pipSize: 0.01, pipValue: 0.01, approx: '1 coin per lot' },
  { symbol: 'DOTUSD', name: 'Polkadot', category: 'crypto', pipSize: 0.01, pipValue: 0.01, approx: '1 coin per lot' },
  // Low-priced coins are usually quoted per 1,000+ units — broker specs vary
  // widely here, so treat these as a starting point, not gospel.
  { symbol: 'XRPUSD', name: 'XRP', category: 'crypto', pipSize: 0.0001, pipValue: 0.1, approx: '1,000 coins per lot — verify with your broker' },
  { symbol: 'ADAUSD', name: 'Cardano', category: 'crypto', pipSize: 0.0001, pipValue: 0.1, approx: '1,000 coins per lot — verify with your broker' },
  { symbol: 'DOGEUSD', name: 'Dogecoin', category: 'crypto', pipSize: 0.00001, pipValue: 0.01, approx: '1,000 coins per lot — verify with your broker' },
  { symbol: 'MATICUSD', name: 'Polygon', category: 'crypto', pipSize: 0.0001, pipValue: 0.1, approx: '1,000 coins per lot — verify with your broker' },
]

export const DEFAULT_INSTRUMENT = 'XAUUSD'

const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]))

// The set of names this app knows. Passed to `canonical` so that stripping a
// suffix stops the moment it produces something real, rather than continuing
// until it has eaten a genuine symbol.
export const KNOWN_SYMBOLS = new Set(INSTRUMENTS.map((i) => i.symbol))

/**
 * Look up an instrument by any name a broker might use for it.
 *
 * Before this went through `canonical`, "XAUUSD.s" found nothing and every
 * caller fell back to the default forex pip size of 0.0001 — for an instrument
 * whose pip is 0.1. Position sizes, pip values and modelled spreads on that
 * symbol were all wrong by a factor of a thousand, with nothing on screen to
 * suggest it. Prop-firm accounts, which suffix everything, were the ones
 * affected.
 */
export function getInstrument(symbol) {
  const direct = BY_SYMBOL.get(symbol)
  if (direct) return direct
  const c = canonical(symbol, KNOWN_SYMBOLS)
  return (c && BY_SYMBOL.get(c)) || null
}

// Grouped for the dropdown's <optgroup>s.
export const INSTRUMENT_GROUPS = [
  { label: 'Metals', category: 'metal' },
  { label: 'Forex', category: 'forex' },
  { label: 'Indices', category: 'index' },
  { label: 'Crypto', category: 'crypto' },
].map((g) => ({ ...g, items: INSTRUMENTS.filter((i) => i.category === g.category) }))

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

export const LOT_UNITS = {
  standard: STANDARD_LOT,
  mini: STANDARD_LOT / 10,
  micro: STANDARD_LOT / 100,
}

/**
 * Position size from risk tolerance and stop distance.
 *
 *   risk_amount   = balance × (risk% / 100)
 *   position_size = risk_amount / (stop_loss_pips × pip_value_per_lot)
 *
 * Returns null when the inputs can't produce a meaningful answer, so the UI
 * can stay in its empty state rather than rendering Infinity or NaN.
 */
export function calculatePositionSize({ balance, riskPercent, stopLossPips, pipValue }) {
  const b = Number(balance)
  const r = Number(riskPercent)
  const sl = Number(stopLossPips)
  const pv = Number(pipValue)

  if (![b, r, sl, pv].every(Number.isFinite)) return null
  if (b <= 0 || r <= 0 || sl <= 0 || pv <= 0) return null

  const riskAmount = b * (r / 100)
  const standardLots = riskAmount / (sl * pv)

  return {
    riskAmount,
    standardLots,
    miniLots: standardLots * 10,
    microLots: standardLots * 100,
    // What the stop actually costs at this size. Equal to riskAmount by
    // construction — shown as a sanity check that the sizing is right.
    lossAtStop: standardLots * sl * pv,
    units: standardLots * STANDARD_LOT,
  }
}

// Lot sizes are conventionally shown to 2 decimals (brokers accept 0.01 steps).
export function fmtLots(v) {
  if (!Number.isFinite(v)) return '—'
  if (v >= 100) return v.toFixed(0)
  if (v >= 1) return v.toFixed(2)
  // Very small sizes need more precision to be useful at all.
  return v.toFixed(v < 0.01 ? 4 : 2)
}

// Pip sizes span 0.00001 to 1, so a fixed precision won't do.
export function fmtPipSize(v) {
  if (!Number.isFinite(v)) return '—'
  if (v >= 1) return v.toFixed(0)
  const decimals = Math.max(0, Math.round(-Math.log10(v)))
  return v.toFixed(decimals)
}
