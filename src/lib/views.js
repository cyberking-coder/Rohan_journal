// Single source of truth for the app's navigation and routing.
//
// The spec routes every section through a `?view=<key>` query param, so the
// sidebar, the command palette, the mobile nav and the router all read from
// this one list. Sections that aren't built yet stay here with `ready: false`
// so they show up in the nav (and in search) behind a "coming soon" screen
// instead of being invisible until their phase lands.

export const VIEWS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: '◈',
    ready: true,
    description: 'P&L at a glance, equity curve and today’s news.',
  },
  {
    key: 'trades',
    label: 'Trades',
    icon: '⇅',
    ready: true,
    description: 'Full trade history, account switcher and broker sync actions.',
  },
  {
    key: 'journal',
    label: 'Journal',
    icon: '▤',
    ready: true,
    description: 'Log trades and review your reasoning.',
  },
  {
    key: 'analysis',
    label: 'Analysis',
    icon: '◑',
    ready: true,
    description: 'Performance analytics, sessions, symbols and streaks.',
  },
  {
    key: 'market',
    label: 'Market',
    icon: '◎',
    ready: true,
    description: 'Economic calendar with impact filters and countdowns.',
  },
  {
    key: 'ai-report',
    label: 'AI Report',
    icon: '✦',
    ready: true,
    description: 'AI-written performance reviews of your trading.',
  },
  {
    key: 'funded',
    label: 'Funded',
    icon: '◆',
    ready: true,
    description: 'Prop-firm challenge rules, drawdown limits and pass/fail.',
  },
  {
    key: 'backtesting',
    label: 'Backtesting',
    icon: '⧗',
    ready: true,
    description: 'Replay historical candles and test a strategy.',
  },
  {
    key: 'community',
    label: 'Community',
    icon: '◇',
    ready: true,
    description: 'Leaderboard and published setups, opt-in and anonymous.',
  },
  {
    key: 'tools',
    label: 'Tools',
    icon: '⚙',
    ready: true,
    description: 'Position size calculator, market hours and more.',
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: '◍',
    ready: true,
    description: 'Profile, broker accounts, preferences and billing.',
  },
]

export const DEFAULT_VIEW = 'dashboard'

// `shared` is deliberately absent from VIEWS: it is not a section of the app
// but a separate page for someone who isn't signed in, handled in App.jsx
// before the auth gate. Listing it here would put it in the sidebar and the
// command palette, where it means nothing without a code.

const BY_KEY = new Map(VIEWS.map((v) => [v.key, v]))

export function getView(key) {
  return BY_KEY.get(key) || null
}

export function isValidView(key) {
  return BY_KEY.has(key)
}
