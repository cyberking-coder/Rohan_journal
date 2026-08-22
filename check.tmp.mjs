import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--headless=new'] })
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })
const errs = []; p.on('pageerror', e => errs.push(String(e)))
p.on('console', m => m.type()==='error' && !/ERR_CONNECTION/.test(m.text()) && errs.push(m.text()))
const SET = 'http://localhost:4173/?view=settings&tab=preferences'
await p.goto(SET, { waitUntil: 'networkidle' })
await p.evaluate(() => {
  const mk = (i,pnl,h)=>({id:'x'+i,symbol:'EURUSD',side:'Long',pnl,fees:0,entry:1,exit:1,qty:0.1,
    traded_at:new Date(Date.UTC(2026,7,10+i,h,0)).toISOString()})
  localStorage.setItem('forex_greek_trades', JSON.stringify([mk(1,100,2),mk(2,-50,9),mk(3,200,14),mk(4,-30,23),mk(5,60,7)]))
  localStorage.removeItem('forex_greek_prefs')
})
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
await p.locator('button', { hasText: 'ICT kill zones' }).first().click(); await p.waitForTimeout(700)
await p.goto('http://localhost:4173/?view=analysis', { waitUntil: 'networkidle' }); await p.waitForTimeout(1400)
const a = await p.locator('body').innerText()
const j = a.indexOf('Session Performance')
console.log('ICT CARDS:\n' + a.slice(j, j+400))
// Now a partition with a deliberate gap, and check the warning appears
await p.goto(SET, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
await p.locator('button', { hasText: 'Classic' }).first().click(); await p.waitForTimeout(500)
const custom = p.locator('button', { hasText: 'Customise' }).first()
await custom.scrollIntoViewIfNeeded(); await custom.click(); await p.waitForTimeout(600)
const times = p.locator('input[style*="center"]')
await times.nth(1).fill('12:00'); await p.waitForTimeout(800)   // London ends 12:00, NY starts 13:00 -> gap
let t = await p.locator('body').innerText()
console.log('GAP WARNING:', (t.match(/[^\n]*isn.t covered[^\n]*/)||['NONE'])[0])
await times.nth(1).fill('14:00'); await p.waitForTimeout(800)   // now overlaps NY 13:00
t = await p.locator('body').innerText()
console.log('OVERLAP WARNING:', (t.match(/[^\n]*covered twice[^\n]*/)||['NONE'])[0])
console.log('OVERFLOW:', await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))
await p.setViewportSize({width:390,height:800}); await p.waitForTimeout(600)
console.log('MOBILE OVERFLOW:', await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))
console.log('ERRORS:', errs)
await b.close()
