import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--headless=new'] })
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })
const errs = []; p.on('pageerror', e => errs.push(String(e)))
await p.goto('http://localhost:4173/?view=community', { waitUntil: 'networkidle' })
await p.evaluate(() => {
  const rows=[]; for (let i=0;i<25;i++){ const win=i%5<3
    rows.push({id:'c'+i,symbol:'EURUSD',side:'Long',pnl:win?200:-100,fees:0,source:'mt5',
      closed_at:new Date(Date.UTC(2026,7,1+i%12,12,0)).toISOString(),
      traded_at:new Date(Date.UTC(2026,7,1+i%12,12,0)).toISOString()}) }
  localStorage.setItem('forex_greek_trades', JSON.stringify(rows))
})
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1400)
const txt = await p.evaluate(()=>document.body.textContent)
const j = txt.indexOf('TradersNeeds')
console.log(txt.slice(j>0?j:txt.indexOf('Traders'), (j>0?j:txt.indexOf('Traders'))+800))
console.log('--- $ in page body:', /\$/.test(txt.slice(txt.indexOf('Traders'))))
console.log('OVERFLOW:', await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))
console.log('ERRORS:', errs.slice(0,2))
await b.close()
