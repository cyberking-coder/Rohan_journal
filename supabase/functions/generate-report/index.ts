// Supabase Edge Function — generates an AI performance report.
//
// Why this exists at all, rather than calling Claude from React:
//
//   1. The API key. Anything the browser can read is readable by a compromised
//      dependency, a browser extension, or anyone holding the laptop. The key
//      is a function secret and never leaves this process.
//   2. The quota. A limit enforced in React is decoration — the user can call
//      the REST endpoint directly. The count below runs against the database
//      before any tokens are spent, and `ai_reports` has no client insert
//      policy (see phase7.sql), so this is the only way a row gets written.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy generate-report
//
// The client sends the *summary* of its trades (see `summariseTrades` in
// src/lib/aiReport.js) rather than the function re-reading them: the caller's
// JWT is forwarded to Supabase for identity, but the trade rows the user is
// asking about are already in their hands. What is NOT trusted from the client
// is anything that decides cost or eligibility — the week bucket and the
// usage count are computed here.

import Anthropic from 'npm:@anthropic-ai/sdk@^0.71.0'
import { createClient } from 'npm:@supabase/supabase-js@^2.45.4'

const MODEL = 'claude-opus-5'
const WEEKLY_QUOTA = 3
const MAX_TRADES = 200
const DAY = 86400000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// Monday 00:00 UTC. Mirrors `weekStart` in src/lib/aiReport.js — the client
// copy draws the reset timer, this one decides. If you change the reset rule,
// change both; the client showing a different Monday than the server enforces
// is the failure mode to avoid.
function weekStartKey(ms: number): string {
  const d = new Date(ms)
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const back = (new Date(utc).getUTCDay() + 6) % 7
  return new Date(utc - back * DAY).toISOString().slice(0, 10)
}

// The report body. `strict` + a closed schema means the model cannot return a
// shape the UI doesn't render, so the page needs no defensive parsing beyond
// the archive's tolerance for old rows.
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'A short, specific headline for this review. Max 60 characters. No generic titles like "Trading Report".',
    },
    summary: {
      type: 'string',
      description: 'One or two sentences stating the single most important thing in this period.',
    },
    sections: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          body: {
            type: 'string',
            description: 'Two to five sentences. Cite specific symbols, dates or figures from the data.',
          },
          tone: { type: 'string', enum: ['positive', 'warning', 'critical', 'neutral'] },
        },
        required: ['heading', 'body', 'tone'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'sections'],
  additionalProperties: false,
}

const SYSTEM = `You review a retail forex trader's own journal and give them an honest performance read.

Rules:
- Work only from the data given. Never invent a trade, a figure or a date.
- Be specific. "You lost money on GBPJPY" is useless; "GBPJPY is 1-for-6 and -$412, your worst pair by a distance" is not.
- Read the journal notes, not just the P&L. The trader's own stated mistakes and emotions are the most valuable signal in the file.
- Say the uncomfortable thing when the data supports it. A review that only praises is worthless. Equally, do not manufacture criticism when a period was genuinely good.
- If the sample is small or the journal is mostly empty, say so plainly and scale your confidence down rather than over-reading noise.
- No disclaimers, no "consult a financial advisor", no filler. The trader asked for a read on their own trading.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'This deployment has no ANTHROPIC_API_KEY set, so reports cannot be generated.' }, 501)
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Sign in to generate a report.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Identity comes from the caller's JWT, verified by Supabase — never from
  // the request body. A client that could name its own user_id could read and
  // bill another user's quota.
  const authed = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await authed.auth.getUser()
  const user = userData?.user
  if (userErr || !user) return json({ error: 'Sign in to generate a report.' }, 401)

  // Writes bypass RLS deliberately: ai_reports has no insert policy, precisely
  // so that this is the only path that can create one.
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const now = Date.now()
  const week = weekStartKey(now)

  const { count, error: countErr } = await admin
    .from('ai_reports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('week_start', week)

  if (countErr) return json({ error: `Couldn't check your quota: ${countErr.message}` }, 500)

  const used = count ?? 0
  if (used >= WEEKLY_QUOTA) {
    // Monday 00:00 UTC of next week.
    const resetsAt = new Date(`${week}T00:00:00Z`).getTime() + 7 * DAY
    return json({ error: 'Weekly report limit reached.', quota: { used, limit: WEEKLY_QUOTA, resetsAt } }, 429)
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Malformed request body.' }, 400)
  }

  const summary = payload?.summary
  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.trades)) {
    return json({ error: 'Missing trade summary.' }, 400)
  }
  if (summary.trades.length < 5) {
    return json({ error: 'Not enough trades to review.' }, 400)
  }
  // A caller could post an arbitrarily large body; cap what actually reaches
  // the model so one request can't run up an unbounded bill.
  summary.trades = summary.trades.slice(-MAX_TRADES)

  const anthropic = new Anthropic({ apiKey })

  let message
  try {
    message = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        format: { type: 'json_schema', schema: REPORT_SCHEMA, strict: true },
      },
      messages: [{
        role: 'user',
        content: `Here is my closed trade history and journal. Write my performance review.\n\n${JSON.stringify(summary)}`,
      }],
    })
  } catch (err) {
    return json({ error: `The model call failed: ${(err as Error).message}` }, 502)
  }

  // Checked before reading content: on a refusal the content blocks are not
  // the report, and parsing them would produce nonsense.
  if (message.stop_reason === 'refusal') {
    return json({ error: 'The model declined to write this report.' }, 422)
  }

  const text = (message.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')

  let report: any
  try {
    report = JSON.parse(text)
  } catch {
    return json({ error: 'The model returned an unreadable report.' }, 502)
  }

  const { data: row, error: insertErr } = await admin
    .from('ai_reports')
    .insert({
      user_id: user.id,
      week_start: week,
      title: String(report.title || 'Performance review').slice(0, 120),
      summary: String(report.summary || ''),
      sections: report.sections || [],
      period_start: summary.periodStart || null,
      period_end: summary.periodEnd || null,
      trade_count: summary.trades.length,
      model: message.model || MODEL,
      input_tokens: message.usage?.input_tokens ?? null,
      output_tokens: message.usage?.output_tokens ?? null,
    })
    .select()
    .single()

  if (insertErr) return json({ error: `Couldn't save the report: ${insertErr.message}` }, 500)

  return json({
    report: row,
    quota: { used: used + 1, limit: WEEKLY_QUOTA },
  })
})
