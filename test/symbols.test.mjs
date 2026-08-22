// Symbol mapping.
//
// Two failure modes, and they pull in opposite directions:
//
//   under-matching — "XAUUSD.s" finds nothing, so gold gets the default forex
//                    pip size of 0.0001 instead of 0.1 and every pip figure on
//                    it is wrong by a factor of a thousand.
//   over-matching  — an eager stripper turns EURUSDT into EURUSD, and a crypto
//                    pair is priced as a currency pair.
//
// Under-matching is loud enough to be noticed eventually. Over-matching never
// is: a wrong answer gets used. So roughly half of what follows is about
// symbols that must NOT be mapped.

import assert from 'node:assert/strict'
import { ALIASES, canonical, groupBySymbol, isFxPair, isRecognised } from '../src/lib/symbols.js'
import { INSTRUMENTS, KNOWN_SYMBOLS, getInstrument } from '../src/lib/pips.js'
import { contractSizeFor } from '../src/lib/instruments.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }

const K = KNOWN_SYMBOLS

// ── the obvious cases ──────────────────────────────────────────────────────
{
  eq(canonical('XAUUSD', K), 'XAUUSD', 'an exact name is left alone')
  eq(canonical('xauusd', K), 'XAUUSD', 'case is normalised')
  eq(canonical('  XAUUSD  ', K), 'XAUUSD', 'whitespace too')

  // The suffixes that actually appear on prop-firm and ECN accounts.
  for (const name of ['XAUUSD.s', 'XAUUSD.m', 'XAUUSD-ECN', 'XAUUSD_raw',
    'XAUUSD.pro', 'XAUUSDm', 'XAUUSD.cash', 'XAUUSD.micro', 'XAUUSD.zero']) {
    eq(canonical(name, K), 'XAUUSD', `${name} is gold`)
  }

  eq(canonical('EURUSD.pro', K), 'EURUSD', 'suffixed forex')
  eq(canonical('GBPJPY.raw', K), 'GBPJPY', 'a cross too')
  eq(canonical('US30.cash', K), 'US30', 'an index')

  // Two decorations at once, which is what a reseller's feed looks like.
  eq(canonical('XAUUSD.pro.m', K), 'XAUUSD', 'two suffixes')
  eq(canonical('FXEURUSD', K), 'EURUSD', 'a venue prefix')
}

// ── aliases ────────────────────────────────────────────────────────────────
{
  eq(canonical('GOLD', K), 'XAUUSD', 'gold by name')
  eq(canonical('SILVER', K), 'XAGUSD', 'silver by name')
  eq(canonical('NAS100', K), 'US100', 'the Nasdaq under another name')
  eq(canonical('USTEC', K), 'US100', 'and another')
  eq(canonical('SPX500', K), 'US500', 'the S&P')
  eq(canonical('DAX40', K), 'GER40', 'the DAX')
  eq(canonical('DOW', K), 'US30', 'the Dow')
  eq(canonical('BTCUSDT', K), 'BTCUSD', 'a stablecoin-quoted pair is the same CFD')

  // An alias with a suffix on top — the realistic prop-firm case.
  eq(canonical('GOLD.s', K), 'XAUUSD', 'an aliased name can be suffixed too')
  eq(canonical('NAS100.pro', K), 'US100', 'and an index alias')

  // Every alias must point at something real, or the map quietly resolves to
  // a symbol with no instrument behind it.
  for (const [from, to] of Object.entries(ALIASES)) {
    ok(K.has(to), `alias ${from} → ${to} points at a known instrument`)
    ok(!K.has(from), `alias ${from} does not shadow a real symbol`)
  }
}

// ── what must NOT be mapped ────────────────────────────────────────────────
{
  // The one-character difference that matters most.
  ok(canonical('EURUSDT', K) !== 'EURUSD', 'EURUSDT is not folded into EURUSD')
  eq(getInstrument('EURUSDT'), null, 'and finds no instrument rather than a wrong one')

  // A real pair must never be reduced by the single-letter suffix rules.
  for (const pair of ['EURUSD', 'GBPUSD', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD']) {
    eq(canonical(pair, K), pair, `${pair} survives intact`)
  }

  // Unknown symbols come back tidied but unrecognised, never guessed at.
  eq(getInstrument('WEIRDSYM'), null, 'an unknown symbol has no instrument')
  eq(getInstrument('WEIRDSYM.x'), null, 'nor does a suffixed unknown one')
  eq(isRecognised('WEIRDSYM.x', K), false, 'and it says it is unrecognised')
  eq(isRecognised('XAUUSD.s', K), true, 'while a mapped one says it is recognised')

  // The distinction the callers depend on: tidying is not recognising.
  eq(canonical('WEIRDSYM.x', K), 'WEIRDSYMX', 'an unknown name is tidied, not resolved')

  // Stripping must never produce a stub.
  ok((canonical('ABC', K) || '').length >= 3, 'a three-letter name is not eaten')
  eq(canonical('', K), null, 'empty is nothing')
  eq(canonical(null, K), null, 'null is nothing')
  eq(canonical('...', K), null, 'punctuation alone is nothing')
}

// ── the bugs this was built to fix ─────────────────────────────────────────
{
  // Gold with a broker suffix: pip size was falling back to 0.0001, a factor
  // of a thousand out, silently.
  eq(getInstrument('XAUUSD.s')?.pipSize, 0.1, 'suffixed gold has gold’s pip size')
  eq(getInstrument('XAUUSD')?.pipSize, 0.1, 'as does plain gold')
  eq(getInstrument('GOLD')?.pipSize, 0.1, 'and gold by name')

  // Suffixed forex: contract size was falling to 1 instead of 100,000, making
  // P&L computed from prices 100,000 times too small.
  eq(contractSizeFor('EURUSD.pro'), 100000, 'suffixed forex has a real contract size')
  eq(contractSizeFor('EURUSD'), 100000, 'as does plain forex')
  eq(contractSizeFor('XAUUSD.s'), 100, 'and suffixed gold')
  eq(contractSizeFor('GOLD'), 100, 'and gold by name')

  // Every instrument must survive a suffix. A regression here is invisible on
  // screen and wrong in every number.
  for (const inst of INSTRUMENTS) {
    for (const suffix of ['.s', '.m', '-ECN', '.pro', '_raw']) {
      const found = getInstrument(inst.symbol + suffix)
      eq(found?.symbol, inst.symbol, `${inst.symbol}${suffix} resolves to ${inst.symbol}`)
      eq(found?.pipSize, inst.pipSize, `${inst.symbol}${suffix} keeps its pip size`)
    }
  }
}

// ── fx pair detection ──────────────────────────────────────────────────────
{
  eq(isFxPair('EURUSD'), true, 'a pair')
  eq(isFxPair('GBPJPY'), true, 'a cross')
  eq(isFxPair('EURUS'), false, 'too short')
  eq(isFxPair('EURUSDT'), false, 'too long')
  eq(isFxPair('XAUUSD'), false, 'gold is not a currency pair')
  eq(isFxPair('ABCDEF'), false, 'six letters is not enough to be a pair')
}

// ── grouping ───────────────────────────────────────────────────────────────
{
  // A trader with two prop accounts sees one symbol, not two.
  const groups = groupBySymbol(['EURUSD.pro', 'EURUSD.m', 'EURUSD', 'XAUUSD.s', 'GOLD'], K)
  eq(groups.get('EURUSD').length, 3, 'three broker names for one pair')
  eq(groups.get('XAUUSD').length, 2, 'and two for gold')
  eq(groups.size, 2, 'two instruments in total')

  eq(groupBySymbol([], K).size, 0, 'nothing from nothing')
  eq(groupBySymbol(null, K).size, 0, 'null is handled')
  // Duplicates in the input do not duplicate in the group.
  eq(groupBySymbol(['EURUSD', 'EURUSD'], K).get('EURUSD').length, 1, 'deduplicated')
}

console.log(`symbols: ${checks} assertions passed`)
