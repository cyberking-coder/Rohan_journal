import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--headless=new'] })
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })
const errs = []; p.on('pageerror', e => errs.push(String(e)))
p.on('console', m => m.type()==='error' && !/ERR_CONNECTION/.test(m.text()) && errs.push(m.text()))
await p.goto('http://localhost:4173/?view=analysis', { waitUntil: 'networkidle' })
await p.evaluate(() => {
  const mk=(i,sym,pnl)=>({id:'x'+i,symbol:sym,side:'Long',pnl,fees:0,entry:1,exit:1,qty:0.1,
    traded_at:new Date(Date.UTC(2026,7,10+i%8,12,0)).toISOString()})
  localStorage.setItem('forex_greek_trades', JSON.stringify([
    mk(1,'EURUSD.pro',300), mk(2,'EURUSD.m',-100), mk(3,'EURUSD',200),
    mk(4,'XAUUSD.s',150), mk(5,'GOLD',-50)]))
})
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
const txt = await p.evaluate(()=>document.body.textContent)
const j = txt.indexOf('Top Symbols')
console.log('TOP SYMBOLS:\n' + (j<0?'[MISSING]':txt.slice(j, j+180)))
console.log('has EURUSD.pro as separate row:', /EURUSD\.PRO|EURUSDPRO/.test(txt))
console.log('ERRORS:', errs.slice(0,2))
await b.close()
