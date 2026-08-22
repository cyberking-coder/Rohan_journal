import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--headless=new'] })
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } })
const errs = []; p.on('pageerror', e => errs.push(String(e)))
await p.goto('http://localhost:4173/?view=backtesting', { waitUntil: 'networkidle' })
await p.evaluate(() => {
  const rows = []
  for (let i=0;i<60;i++){ const win = i % 5 < 2
    rows.push({ id:'l'+i, symbol:'EURUSD', side:'Long', pnl: win?180:-260, fees:0, entry:1.1, exit:1.1, qty:0.1,
      opened_at:new Date(Date.UTC(2026,6,1+i%20,10,0)).toISOString(),
      closed_at:new Date(Date.UTC(2026,6,1+i%20,12,0)).toISOString(),
      traded_at:new Date(Date.UTC(2026,6,1+i%20,12,0)).toISOString() }) }
  localStorage.setItem('forex_greek_trades', JSON.stringify(rows))
  localStorage.removeItem('forex_greek_backtests')
})
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
await p.locator('input[type="file"]').first().setInputFiles('/tmp/eurusd.csv'); await p.waitForTimeout(1400)
const place = p.locator('button', { hasText: /Place order/i }).first()
const nextBtn = () => p.locator('button', { hasText: /^›$|Next|Step/ }).first()
for (let k=0;k<6;k++){ await place.scrollIntoViewIfNeeded(); await place.click(); await p.waitForTimeout(150)
  for (let i=0;i<8;i++){ await nextBtn().click(); await p.waitForTimeout(20) }
  const c = p.locator('button', { hasText: /^Close$/i }).first()
  if (await c.count()) { await c.scrollIntoViewIfNeeded(); await c.click(); await p.waitForTimeout(150) } }
await p.locator('button', { hasText: /^Save session$/ }).first().click(); await p.waitForTimeout(1300)
const txt = await p.evaluate(()=>document.body.textContent)
const j = txt.indexOf('Backtest vs Live')
console.log(txt.slice(j, j+560))
console.log('ALL-CLEAR PRESENT:', txt.includes('matches what you tested'))
console.log('ERRORS:', errs.slice(0,2))
await b.close()
