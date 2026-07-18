// Analytics helpers computed client-side from the trade list.

export const RANGES = {
  week: { label: 'This Week', days: 7 },
  month: { label: '1 Month', days: 30 },
  quarter: { label: '3 Months', days: 90 },
  all: { label: 'All Time', days: Infinity },
}

export function filterByRange(trades, rangeKey) {
  const days = RANGES[rangeKey]?.days ?? Infinity
  if (days === Infinity) return trades
  const cutoff = Date.now() - days * 86400000
  return trades.filter((t) => new Date(t.traded_at).getTime() >= cutoff)
}

export function net(t) {
  return (Number(t.pnl) || 0) - (Number(t.fees) || 0)
}

export function computeStats(trades) {
  const n = trades.length
  const wins = trades.filter((t) => net(t) > 0)
  const losses = trades.filter((t) => net(t) < 0)
  const gross = trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0)
  const fees = trades.reduce((s, t) => s + (Number(t.fees) || 0), 0)
  const netTotal = gross - fees
  const grossWin = wins.reduce((s, t) => s + net(t), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + net(t), 0))
  const avgWin = wins.length ? grossWin / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const winRate = n ? (wins.length / n) * 100 : 0
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0
  const avgRR = n ? trades.reduce((s, t) => s + (Number(t.rr) || 0), 0) / n : 0
  const expectancy = n ? netTotal / n : 0
  const avgRating = n ? trades.reduce((s, t) => s + (Number(t.rating) || 0), 0) / n : 0

  return {
    n, wins: wins.length, losses: losses.length,
    gross, fees, netTotal, avgWin, avgLoss, winRate,
    profitFactor, avgRR, expectancy, avgRating,
    bestTrade: n ? Math.max(...trades.map(net)) : 0,
    worstTrade: n ? Math.min(...trades.map(net)) : 0,
  }
}

export function equityCurve(trades) {
  const sorted = [...trades].sort((a, b) => new Date(a.traded_at) - new Date(b.traded_at))
  let gross = 0, netAcc = 0
  return sorted.map((t, i) => {
    gross += Number(t.pnl) || 0
    netAcc += net(t)
    return {
      i,
      date: new Date(t.traded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      gross: Math.round(gross),
      net: Math.round(netAcc),
    }
  })
}

// last N days daily P&L for bar chart
export function dailyPnl(trades, days = 30) {
  const map = new Map()
  for (let d = days - 1; d >= 0; d--) {
    const dt = new Date()
    dt.setHours(0, 0, 0, 0)
    dt.setDate(dt.getDate() - d)
    map.set(dt.toISOString().slice(0, 10), 0)
  }
  trades.forEach((t) => {
    const key = new Date(t.traded_at).toISOString().slice(0, 10)
    if (map.has(key)) map.set(key, map.get(key) + net(t))
  })
  return [...map.entries()].map(([date, pnl]) => ({
    date: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    pnl: Math.round(pnl),
  }))
}

// calendar heatmap grouped by day for the given number of days
export function calendarData(trades, days = 133) {
  const map = new Map()
  trades.forEach((t) => {
    const key = new Date(t.traded_at).toISOString().slice(0, 10)
    const cur = map.get(key) || { pnl: 0, count: 0 }
    cur.pnl += net(t)
    cur.count += 1
    map.set(key, cur)
  })
  const cells = []
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const info = map.get(key)
    cells.push({ date: key, dow: d.getDay(), pnl: info?.pnl || 0, count: info?.count || 0 })
  }
  return cells
}

export function bySession(trades) {
  const map = new Map()
  trades.forEach((t) => {
    const k = t.session || 'Unknown'
    const cur = map.get(k) || { session: k, pnl: 0, count: 0, wins: 0 }
    cur.pnl += net(t)
    cur.count += 1
    if (net(t) > 0) cur.wins += 1
    map.set(k, cur)
  })
  return [...map.values()]
    .map((s) => ({ ...s, pnl: Math.round(s.pnl), winRate: s.count ? (s.wins / s.count) * 100 : 0 }))
    .sort((a, b) => b.pnl - a.pnl)
}

export function byKey(trades, key) {
  const map = new Map()
  trades.forEach((t) => {
    const k = t[key] || 'Unknown'
    const cur = map.get(k) || { name: k, pnl: 0, count: 0, wins: 0 }
    cur.pnl += net(t)
    cur.count += 1
    if (net(t) > 0) cur.wins += 1
    map.set(k, cur)
  })
  return [...map.values()]
    .map((s) => ({ ...s, pnl: Math.round(s.pnl), winRate: s.count ? (s.wins / s.count) * 100 : 0 }))
    .sort((a, b) => b.pnl - a.pnl)
}

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function byDayOfWeek(trades) {
  const map = new Map()
  trades.forEach((t) => {
    const d = new Date(t.traded_at).getDay()
    const cur = map.get(d) || { day: d, name: DOW_NAMES[d], pnl: 0, count: 0, wins: 0 }
    cur.pnl += net(t)
    cur.count += 1
    if (net(t) > 0) cur.wins += 1
    map.set(d, cur)
  })
  return [...map.values()]
    .map((s) => ({ ...s, pnl: Math.round(s.pnl), winRate: s.count ? (s.wins / s.count) * 100 : 0 }))
    .sort((a, b) => b.pnl - a.pnl)
}

export function biggestTrades(trades) {
  if (!trades.length) return { win: null, loss: null }
  let win = trades[0], loss = trades[0]
  trades.forEach((t) => {
    if (net(t) > net(win)) win = t
    if (net(t) < net(loss)) loss = t
  })
  return { win: net(win) > 0 ? win : null, loss: net(loss) < 0 ? loss : null }
}

// Turns the numbers into plain-language coaching: what's working,
// where to improve, and what to keep doing.
export function buildInsights(trades) {
  const out = { strengths: [], improvements: [], keep: [], note: null }
  if (trades.length < 4) {
    out.note = 'Log a few more trades in this range to unlock coaching insights.'
    return out
  }

  const s = computeStats(trades)
  const minN = trades.length >= 12 ? 3 : 2
  const withAvg = (g) => ({ ...g, avg: g.count ? g.pnl / g.count : 0 })
  const strat = byKey(trades, 'strategy').filter((g) => g.count >= minN).map(withAvg)
  const sess = bySession(trades).map((g) => ({ ...g, name: g.session })).filter((g) => g.count >= minN).map(withAvg)
  const sym = byKey(trades, 'symbol').filter((g) => g.count >= minN).map(withAvg)
  const dow = byDayOfWeek(trades).filter((g) => g.count >= minN).map(withAvg)

  const best = (arr) => (arr.length && arr[0].pnl > 0 ? arr[0] : null)
  const worst = (arr) => {
    const w = arr[arr.length - 1]
    return arr.length && w && w.pnl < 0 ? w : null
  }
  const m = (v) => fmtMoney(v)

  // Strengths — do more of these
  const bStrat = best(strat)
  if (bStrat) out.strengths.push(`Your sharpest setup is **${bStrat.name}** — ${m(bStrat.pnl)} across ${bStrat.count} trades at ${bStrat.winRate.toFixed(0)}% win rate. Size up here.`)
  const bSess = best(sess)
  if (bSess) out.strengths.push(`You trade best during the **${bSess.name}** session (${m(bSess.pnl)}, ${bSess.winRate.toFixed(0)}% win). Prioritise these hours.`)
  const bSym = best(sym)
  if (bSym) out.strengths.push(`**${bSym.name}** is your most profitable instrument (${m(bSym.pnl)} over ${bSym.count} trades).`)
  const bDay = best(dow)
  if (bDay) out.strengths.push(`**${bDay.name}s** are your strongest day (${m(bDay.pnl)}).`)

  // Improvements — fix or cut these
  const wStrat = worst(strat)
  if (wStrat) out.improvements.push(`**${wStrat.name}** is bleeding — ${m(wStrat.pnl)} over ${wStrat.count} trades (${wStrat.winRate.toFixed(0)}% win). Backtest it or drop it.`)
  const wSess = worst(sess)
  if (wSess) out.improvements.push(`The **${wSess.name}** session costs you money (${m(wSess.pnl)}). Consider sitting it out.`)
  const wSym = worst(sym)
  if (wSym) out.improvements.push(`Cut or reduce size on **${wSym.name}** — it's down ${m(wSym.pnl)}.`)
  const wDay = worst(dow)
  if (wDay) out.improvements.push(`**${wDay.name}s** are a net loss (${m(wDay.pnl)}). Trade lighter or skip.`)
  if (s.winRate < 40 && s.profitFactor < 1)
    out.improvements.push(`Win rate is ${s.winRate.toFixed(0)}% with a profit factor below 1 — tighten entries or widen targets.`)
  if (s.avgLoss > s.avgWin && s.avgWin > 0)
    out.improvements.push(`Your average loss (${m(s.avgLoss)}) is bigger than your average win (${m(s.avgWin)}). Cut losers faster or let winners run.`)

  // Keep doing — it's working
  if (s.expectancy > 0)
    out.keep.push(`You're **net profitable** with a positive expectancy of ${m(s.expectancy)} per trade — keep executing the same plan.`)
  if (s.profitFactor >= 1.5)
    out.keep.push(`Profit factor of ${s.profitFactor.toFixed(2)} is strong (you make $${s.profitFactor.toFixed(2)} for every $1 lost). Don't change what works.`)
  if (s.avgRR >= 2)
    out.keep.push(`Average R:R of ${s.avgRR.toFixed(2)} is healthy — your risk discipline is paying off.`)
  if (s.avgRating >= 3.5)
    out.keep.push(`You rate your execution highly (${s.avgRating.toFixed(1)}/5 avg) and results back it up — trust your process.`)
  if (!out.keep.length && s.netTotal > 0)
    out.keep.push(`Overall you're green (${m(s.netTotal)}) in this range — stay consistent.`)

  return out
}

export function fmtMoney(v, digits = 0) {
  const n = Number(v) || 0
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function fmtPct(v, digits = 0) {
  if (!isFinite(v)) return '∞'
  return `${(Number(v) || 0).toFixed(digits)}%`
}

// Accepts "1:2", "1:2.5", "2", 2 -> returns reward-per-1-risk as a number.
export function parseRR(v) {
  if (typeof v === 'number') return v
  const str = String(v ?? '').trim()
  if (!str) return 0
  if (str.includes(':')) {
    const [a, b] = str.split(':').map((x) => parseFloat(x))
    if (a > 0 && isFinite(b)) return b / a
    return 0
  }
  const n = parseFloat(str)
  return isFinite(n) ? n : 0
}

// Displays a stored reward-to-risk number as "1:2" / "1:2.5".
export function fmtRR(v) {
  const n = Number(v) || 0
  if (n <= 0) return '—'
  const x = Math.round(n * 100) / 100
  return `1:${x % 1 === 0 ? x.toFixed(0) : x.toFixed(2).replace(/0$/, '')}`
}
