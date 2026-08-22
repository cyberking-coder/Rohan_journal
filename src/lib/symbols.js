// Symbol mapping — Master PRD §34–40 (the part that does not need a data
// vendor).
//
// ── Why this exists ────────────────────────────────────────────────────────
// Every broker names the same instrument differently. Gold is XAUUSD at one,
// XAUUSD.s at another, GOLD at a third, XAUUSD-ECN at a fourth. Prop firms are
// the worst offenders because they resell someone else's feed and suffix
// everything.
//
// Without a mapping the app looks up "XAUUSD.s", finds nothing, and falls back
// to the default forex pip size of 0.0001 — for an instrument whose pip is
// 0.1. Every pip figure, every position size and every modelled spread on that
// symbol is then wrong by a factor of a thousand, and nothing on screen looks
// broken. This is the failure mode this file exists to prevent.
//
// ── The rule that shapes the matching ──────────────────────────────────────
// Never map two genuinely different instruments onto one. EURUSD and EURUSDT
// differ by one character and are a currency pair and a crypto pair; folding
// them together would be worse than not matching at all, because a wrong
// answer is used and a missing one is noticed. So stripping is limited to
// recognised decorations, and anything left unresolved stays unresolved.

// Punctuation and casing brokers add freely. Removing these cannot change
// which instrument is meant.
function bare(symbol) {
  return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Account-type suffixes, longest first so ".PRO" is not left as "P" after
// ".PRO" fails and "PRO" matches part of it.
const SUFFIXES = [
  'MICRO', 'CASH', 'SPOT', 'ECN', 'RAW', 'PRO', 'STD', 'ZERO', 'PLUS',
  'MINI', 'EDGE', 'FIX', 'IC', 'FT', 'RF', 'SB',
  'M', 'S', 'C', 'I', 'Z', 'E', 'R', 'X', 'P', 'A', 'V', 'K',
]

// Prefixes, rarer but real — some feeds prepend a venue code.
const PREFIXES = ['FX', 'CFD', 'SPOT']

/**
 * Names that are not decorated forms of the canonical symbol but different
 * words for the same thing.
 *
 * Kept separate from suffix stripping because no amount of character removal
 * turns GOLD into XAUUSD — this is a dictionary, and it has to be.
 */
export const ALIASES = {
  GOLD: 'XAUUSD',
  XAU: 'XAUUSD',
  GOLDUSD: 'XAUUSD',
  SILVER: 'XAGUSD',
  XAG: 'XAGUSD',
  SILVERUSD: 'XAGUSD',

  // Indices, where naming is at its most inconsistent.
  DOW: 'US30', DJ30: 'US30', DJI: 'US30', WALLSTREET: 'US30', WS30: 'US30',
  YM: 'US30', USA30: 'US30',
  NAS100: 'US100', NASDAQ: 'US100', USTEC: 'US100', NDX: 'US100', NQ: 'US100',
  TECH100: 'US100', USATEC: 'US100', USA100: 'US100',
  SPX500: 'US500', SPX: 'US500', SP500: 'US500', ES: 'US500', USA500: 'US500',
  DAX: 'GER40', DAX40: 'GER40', DE40: 'GER40', GER30: 'GER40', DE30: 'GER40',
  FTSE: 'UK100', FTSE100: 'UK100', UK: 'UK100',

  // Crypto: the stablecoin-quoted pair is the same instrument for a CFD
  // trader's purposes, and brokers use the forms interchangeably.
  BTCUSDT: 'BTCUSD', XBTUSD: 'BTCUSD', BITCOIN: 'BTCUSD',
  ETHUSDT: 'ETHUSD', ETHEREUM: 'ETHUSD',
  SOLUSDT: 'SOLUSD',
  XRPUSDT: 'XRPUSD',
  DOGEUSDT: 'DOGEUSD',
  ADAUSDT: 'ADAUSD',
  LTCUSDT: 'LTCUSD',
  MATICUSDT: 'MATICUSD',
}

const FX = /^(EUR|USD|GBP|JPY|AUD|NZD|CAD|CHF|SEK|NOK|DKK|SGD|HKD|MXN|ZAR|TRY|PLN|CZK|HUF|CNH)$/

/**
 * Is this string a plain six-character currency pair?
 *
 * Used as a stopping condition: once a name is a valid pair there is nothing
 * left to strip, and stripping further would turn EURUSD into EURUS.
 */
export function isFxPair(s) {
  return s.length === 6 && FX.test(s.slice(0, 3)) && FX.test(s.slice(3))
}

/**
 * Reduce a broker's name to the canonical one.
 *
 * @param known optional set of canonical symbols. When supplied, stripping
 *   stops as soon as it produces something known — which is what stops the
 *   single-letter suffixes from eating real symbols.
 */
export function canonical(symbol, known = null) {
  const raw = bare(symbol)
  if (!raw) return null

  const isKnown = (s) => (known ? known.has(s) : false)

  // Exact match wins before anything is touched.
  if (isKnown(raw)) return raw
  if (ALIASES[raw]) return ALIASES[raw]
  // A plain pair is already canonical. Checked before stripping so EURUSD is
  // never reduced further by the single-letter suffix rules.
  if (isFxPair(raw)) return raw

  for (const p of PREFIXES) {
    if (raw.startsWith(p) && raw.length > p.length + 2) {
      const rest = raw.slice(p.length)
      if (isKnown(rest) || ALIASES[rest] || isFxPair(rest)) return ALIASES[rest] || rest
    }
  }

  for (const suf of SUFFIXES) {
    if (!raw.endsWith(suf)) continue
    const stem = raw.slice(0, raw.length - suf.length)
    // A stem shorter than three characters is not an instrument; it is what is
    // left after eating one.
    if (stem.length < 3) continue
    if (isKnown(stem)) return stem
    if (ALIASES[stem]) return ALIASES[stem]
    if (isFxPair(stem)) return stem
  }

  // Two decorations at once — "XAUUSD.PRO.M" arrives as XAUUSDPROM. One more
  // pass, no further, because each additional pass multiplies the chance of
  // mangling a symbol that was simply unknown.
  for (const suf of SUFFIXES) {
    if (!raw.endsWith(suf)) continue
    const stem = raw.slice(0, raw.length - suf.length)
    if (stem.length < 4) continue
    for (const suf2 of SUFFIXES) {
      if (!stem.endsWith(suf2)) continue
      const stem2 = stem.slice(0, stem.length - suf2.length)
      if (stem2.length < 3) continue
      if (isKnown(stem2)) return stem2
      if (ALIASES[stem2]) return ALIASES[stem2]
      if (isFxPair(stem2)) return stem2
    }
  }

  // Unresolved. Returning the bare form rather than null keeps grouping and
  // display working — two trades on "WEIRDSYM.a" and "WEIRDSYM.b" still land
  // together — while callers that need a real instrument still get nothing
  // from `getInstrument` and can say so.
  return raw
}

/**
 * Did the mapping actually recognise the instrument, or merely tidy the
 * string?
 *
 * The distinction matters: a recognised symbol has a trustworthy pip size, an
 * unrecognised one has a guess. Anything quoting money off the back of it
 * should be able to tell which it has.
 */
export function isRecognised(symbol, known) {
  const c = canonical(symbol, known)
  return !!c && (known ? known.has(c) : false)
}

/**
 * Group a list of broker symbols by what they actually are.
 *
 * Useful on its own: a trader with EURUSD.pro and EURUSD.m from two prop firms
 * should see one row in their symbol breakdown, not two.
 */
export function groupBySymbol(symbols, known) {
  const groups = new Map()
  for (const s of symbols || []) {
    const c = canonical(s, known)
    if (!c) continue
    if (!groups.has(c)) groups.set(c, [])
    if (!groups.get(c).includes(s)) groups.get(c).push(s)
  }
  return groups
}
