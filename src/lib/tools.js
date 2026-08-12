// The Tools grid is config-driven so future tools are a data change, not a
// layout change. Tools open at `?view=tools&tool=<id>`.
//
// The live app has two unnamed empty "coming soon" slots; they're left out
// here because a card with no title tells the user nothing.

export const TOOLS = [
  {
    id: 'position-size',
    name: 'Position Size Calculator',
    badge: 'Popular',
    icon: '⚖',
    description: 'Calculate optimal lot size based on your risk tolerance and stop-loss distance.',
    ready: true,
  },
  {
    id: 'market-hours',
    name: 'Forex Market Hours',
    badge: 'Live',
    icon: '◷',
    description: 'Track real-time trading sessions and find the best times to trade forex pairs.',
    ready: true,
  },
  {
    id: 'trader-pov',
    name: 'Trader POV',
    icon: '◉',
    description: 'View a trader’s shared dashboard and deep-dive performance in read-only mode.',
    ready: false,
    phase: 9,
  },
  {
    id: 'ai-trade-analyser',
    name: 'AI Trade Analyser',
    icon: '✦',
    description: 'Get AI-powered analysis and detailed reports on your trading performance.',
    ready: false,
    phase: 7,
  },
  {
    id: 'demo-trading',
    name: 'Demo Trading',
    icon: '◫',
    description: 'Practise trading strategies risk-free with virtual funds.',
    ready: false,
    phase: 8,
  },
]

export function getTool(id) {
  return TOOLS.find((t) => t.id === id) || null
}

export const AVAILABLE_COUNT = TOOLS.filter((t) => t.ready).length
export const COMING_SOON_COUNT = TOOLS.filter((t) => !t.ready).length
