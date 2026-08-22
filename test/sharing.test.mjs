import {
  DEFAULT_SECTIONS, EXPIRY_OPTIONS, SHARE_SECTIONS, expiryFrom, isShareCode,
  normaliseCode, sectionLabels, shareStatus, shareUrl, shareWarnings,
} from '../src/lib/sharing.js'

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`)
}

const CODE = 'VIEW-2345-6789-ABCD-EFGH'
const NOW = Date.parse('2026-08-13T12:00:00Z')

console.log('— code handling —')
eq('a real code', isShareCode(CODE), true)
eq('lowercase accepted', isShareCode(CODE.toLowerCase()), true)
// People paste the whole link far more often than the code.
eq('pasted URL', normaliseCode(`https://app.example.com/?view=shared&code=${CODE}`), CODE)
eq('URL with more params', normaliseCode(`https://x.com/?a=1&code=${CODE}&b=2`), CODE)
eq('surrounding spaces', normaliseCode(`  ${CODE}  `), CODE)
eq('internal spaces', normaliseCode('VIEW-2345 -6789- ABCD-EFGH'), CODE)
eq('empty', normaliseCode(''), '')
eq('null is safe', normaliseCode(null), '')

eq('too short is rejected', isShareCode('VIEW-2345'), false)
eq('wrong prefix', isShareCode('SHARE-2345-6789-ABCD-EFGH'), false)
eq('junk', isShareCode('not a code'), false)
// The alphabet excludes lookalikes on purpose, so a code containing them was
// mistyped rather than merely unusual.
eq('excluded letter I', isShareCode('VIEW-I345-6789-ABCD-EFGH'), false)
eq('excluded digit 0', isShareCode('VIEW-0345-6789-ABCD-EFGH'), false)
eq('excluded letter O', isShareCode('VIEW-O345-6789-ABCD-EFGH'), false)

eq('url shape', shareUrl(CODE, 'https://app.example.com'),
   `https://app.example.com/?view=shared&code=${CODE}`)

console.log('\n— expiry —')
eq('24 hours', expiryFrom('24h', NOW), '2026-08-14T12:00:00.000Z')
eq('7 days', expiryFrom('7d', NOW), '2026-08-20T12:00:00.000Z')
eq('never is null', expiryFrom('never', NOW), null)
eq('unknown key is null', expiryFrom('nonsense', NOW), null)
eq('every option is offered', EXPIRY_OPTIONS.length, 4)

console.log('\n— status —')
eq('live', shareStatus({ revoked: false, expires_at: null }, NOW).key, 'live')
eq('revoked', shareStatus({ revoked: true, expires_at: null }, NOW).key, 'revoked')
eq('expired', shareStatus({ revoked: false, expires_at: '2026-08-12T12:00:00Z' }, NOW).key, 'expired')
eq('expiring soon', shareStatus({ revoked: false, expires_at: '2026-08-13T20:00:00Z' }, NOW).key, 'expiring')
eq('not soon', shareStatus({ revoked: false, expires_at: '2026-08-30T12:00:00Z' }, NOW).key, 'live')
// Revoked beats expired: the owner acted, and that's what they should be told.
eq('revoked wins over expired',
   shareStatus({ revoked: true, expires_at: '2026-08-01T12:00:00Z' }, NOW).key, 'revoked')
eq('missing share', shareStatus(null, NOW).key, 'unknown')

console.log('\n— sections —')
eq('default is not the journal', DEFAULT_SECTIONS.includes('journal'), false)
eq('labels resolve', sectionLabels(['overview', 'trades']), ['Overview', 'Trade history'])
eq('unknown keys ignored', sectionLabels(['overview', 'nonsense']), ['Overview'])
eq('every section documented', SHARE_SECTIONS.every((s) => s.key && s.label && s.description), true)

console.log('\n— warnings before sharing —')
// Sharing performance is one thing; sharing what you wrote about yourself is
// another, and people conflate them until it's said out loud.
eq('journal is called out',
   shareWarnings({ sections: ['journal'], expiry: '7d', hideAmounts: true }).length, 1)
// The trap: AI reports quote the journal, so turning the journal off doesn't
// actually withhold the notes.
eq('reports leak the journal',
   shareWarnings({ sections: ['reports'], expiry: '7d', hideAmounts: true })[0]
     .includes('AI reports quote your journal'), true)
eq('no warning when the journal is already on',
   shareWarnings({ sections: ['journal', 'reports'], expiry: '7d', hideAmounts: true }).length, 1)
eq('a permanent link is called out',
   shareWarnings({ sections: [], expiry: 'never', hideAmounts: true })[0].includes('never expires'), true)
eq('showing amounts is called out',
   shareWarnings({ sections: [], expiry: '7d', hideAmounts: false })[0].includes('account size'), true)
eq('the careful combination warns about nothing',
   shareWarnings({ sections: ['overview'], expiry: '7d', hideAmounts: true }), [])

console.log(fails ? `\n${fails} FAILED` : '\nAll sharing assertions passed.')
process.exit(fails ? 1 : 0)
