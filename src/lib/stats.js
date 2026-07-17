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

export function fmtMoney(v, digits = 0) {
  const n = Number(v) || 0
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function fmtPct(v, digits = 0) {
  if (!isFinite(v)) return '∞'
  return `${(Number(v) || 0).toFixed(digits)}%`
}
