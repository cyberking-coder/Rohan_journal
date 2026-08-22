import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--headless=new'] })
const p = await b.newPage()
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message))
await p.goto('http://localhost:4173/?view=funded', { waitUntil: 'networkidle' })
await p.evaluate(() => {
  localStorage.setItem('forex_greek_funded', JSON.stringify([{
    id: 'local-1', label: 'FP 100k', firm: 'FundingPips', phase: 'Phase 1',
    brokerAccountId: null, startingBalance: 100000, profitTarget: 8000,
    dailyLossLimit: 5000, maxLoss: 10000, minTradingDays: 4,
    consistencyLimit: 0.4, drawdownType: 'static', dayResetOffsetMinutes: 0,
    startedAt: '', archived: false,
  }]))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const card = await p.locator('section.card').first().innerText()
console.log('CARD:\n' + card)
console.log('H-OVERFLOW:', await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(500)
console.log('MOBILE-OVERFLOW:', await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
console.log('ERRORS:', errs)
await b.close()
