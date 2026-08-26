import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, Panel } from '../components/common'
import { TagRow } from '../components/TagPicker'
import { useAuth } from '../lib/AuthContext'
import { isSupabaseConfigured } from '../lib/supabase'
import { useCommunity, useCommunityFeed } from '../lib/useCommunity'
import {
  MIN_DAYS, MIN_TRADES, REPORT_REASONS, describeProvenance, eligibility, withRanks,
} from '../lib/community'

/**
 * Community — Phase 10.
 *
 * The page is built around one idea: someone should be able to look at all of
 * this before deciding whether to be part of it. Browsing needs no opt-in;
 * appearing anywhere does. A community feature that asks you to join before it
 * shows you what joining means has the order backwards.
 */
export default function Community({ trades = [] }) {
  const { user } = useAuth()
  const { profile, setups, ready, error, saveProfile, leave, saveSetup, removeSetup } =
    useCommunity(user?.id)
  const [period, setPeriod] = useState(30)
  const { board, feed, ready: feedReady, error: feedError, report } = useCommunityFeed(period)

  const [editing, setEditing] = useState(false)
  const [composing, setComposing] = useState(null)

  const standing = useMemo(() => eligibility(trades), [trades])
  const entries = useMemo(() => withRanks(board?.entries || []), [board])

  // Two different reasons this page can be empty, and telling them apart
  // matters: one is "you haven't run a migration", the other is "there is no
  // server at all". Pointing someone at a SQL file when their real problem is
  // that they're in demo mode sends them looking in the wrong place.
  if (!ready && !feedReady) {
    return (
      <>
        <PageHeader eyebrow="Community" title="Traders" />
        <Panel title={isSupabaseConfigured ? 'Not set up yet' : 'Needs an account'}>
          {isSupabaseConfigured ? (
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
              {feedError || (
                <>
                  Run{' '}
                  <code style={{ background: 'var(--card-2)', padding: '2px 6px', borderRadius: 5 }}>
                    supabase/community.sql
                  </code>{' '}
                  in the Supabase SQL editor, then reload.
                </>
              )}
            </p>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, maxWidth: 560 }}>
              This build has no Supabase project configured, so it’s running on local demo
              data. A community needs other people in it — there’s nothing here to join
              until the app is connected to a project and you’ve signed in.
            </p>
          )}
        </Panel>

        {/* Shown even here, because it is computed entirely from local trades
            and is the part someone can act on today. */}
        <Panel title="Where you'd stand" delay={0.05} style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
            <Line label="Closed trades" value={`${standing.trades} / ${MIN_TRADES}`} />
            <Line label="Trading days" value={`${standing.tradingDays} / ${MIN_DAYS}`} />
            <Line label="Expectancy"
              value={standing.expectancyR === null ? '—' : `${standing.expectancyR >= 0 ? '+' : '−'}${Math.abs(standing.expectancyR).toFixed(2)}R`} />
            <Line label="Provenance" value={describeProvenance(standing).short} />
          </div>
          {!standing.eligible && (
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 13, lineHeight: 1.65 }}>
              You’d need {standing.missing.join(', and ')} to qualify for the leaderboard.
            </p>
          )}
        </Panel>
      </>
    )
  }

  return (
    <>
      <PageHeader eyebrow="Community" title="Traders">
        {profile
          ? <button onClick={() => setEditing(true)} style={ghost}>Your profile</button>
          : <button className="btn-primary" onClick={() => setEditing(true)}>Join</button>}
      </PageHeader>

      {(error || feedError) && (
        <div className="card" style={{ padding: 13, marginBottom: 14, color: 'var(--red)', fontSize: 12.5 }}>
          {error || feedError}
        </div>
      )}

      {/* Said once, at the top, before anything else. Someone arriving here
          should know what is and isn't public without having to work it out
          from the absence of their own name. */}
      {!profile && (
        <div className="card" style={{ padding: 15, marginBottom: 15 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
            You’re not listed anywhere
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.7, maxWidth: 620 }}>
            Nothing of yours appears on this page unless you join and switch it on. Joining
            publishes a handle you choose — never your email, your account size or your
            balance. Results are shown in R multiples for everyone, so nobody can tell
            whether you trade a $2,000 account or a $200,000 one.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 15, alignItems: 'start' }}>
        <Panel
          title="Leaderboard"
          right={
            <div style={{ display: 'flex', gap: 3, background: 'var(--card-2)', borderRadius: 8, padding: 2 }}>
              {[30, 90, 365].map((d) => (
                <button key={d} onClick={() => setPeriod(d)}
                  style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: period === d ? 'var(--card-hover)' : 'transparent',
                    color: period === d ? 'var(--text)' : 'var(--text-3)',
                  }}>{d === 365 ? '1y' : `${d}d`}</button>
              ))}
            </div>
          }
        >
          {entries.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.7 }}>
              Nobody qualifies for this period yet. It takes {MIN_TRADES} closed trades
              across {MIN_DAYS} trading days — thresholds that exist so the top of this
              list isn’t whoever had four lucky trades.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 380, borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: 'var(--text-3)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ textAlign: 'left', padding: '0 6px 8px 0', fontWeight: 600 }}>#</th>
                    <th style={{ textAlign: 'left', padding: '0 6px 8px', fontWeight: 600 }}>Trader</th>
                    <th style={{ textAlign: 'right', padding: '0 8px 8px', fontWeight: 600 }}>Expectancy</th>
                    <th style={{ textAlign: 'right', padding: '0 8px 8px', fontWeight: 600 }}>Win %</th>
                    <th style={{ textAlign: 'right', padding: '0 0 8px 8px', fontWeight: 600 }}>Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <motion.tr key={e.handle}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      style={{ borderTop: '1px solid var(--stroke)' }}>
                      <td style={{ padding: '9px 6px 9px 0', color: 'var(--text-3)' }}>{e.rank}</td>
                      <td style={{ padding: '9px 6px' }}>
                        <span style={{ fontWeight: 600 }}>{e.handle}</span>
                        {e.verified && (
                          <span title="Every trade in this sample came from a synced broker account"
                            style={{ marginLeft: 6, fontSize: 9.5, color: 'var(--mint)' }}>✓ synced</span>
                        )}
                      </td>
                      {/* R multiples, never currency. */}
                      <td className="mono" style={{ padding: '9px 8px', textAlign: 'right', color: e.expectancy_r >= 0 ? 'var(--mint)' : 'var(--red)' }}>
                        {e.expectancy_r >= 0 ? '+' : '−'}{Math.abs(e.expectancy_r).toFixed(2)}R
                      </td>
                      <td className="mono" style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--text-2)' }}>
                        {e.win_rate}%
                      </td>
                      <td className="mono" style={{ padding: '9px 0 9px 8px', textAlign: 'right', color: 'var(--text-3)' }}>
                        {e.trades}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 13, lineHeight: 1.6 }}>
            Ranked by expectancy per trade in R — how much is made per unit risked. Money
            is never shown, so account size can’t be inferred. Entries without the synced
            mark are self-reported and can’t be checked.
          </p>
        </Panel>

        <Panel title="Where you stand">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
            <Line label="Closed trades" value={`${standing.trades} / ${MIN_TRADES}`} />
            <Line label="Trading days" value={`${standing.tradingDays} / ${MIN_DAYS}`} />
            <Line label="Expectancy"
              value={standing.expectancyR === null ? '—' : `${standing.expectancyR >= 0 ? '+' : '−'}${Math.abs(standing.expectancyR).toFixed(2)}R`} />
            <Line label="Win rate" value={`${standing.winRate}%`} />
            <Line label="Provenance" value={describeProvenance(standing).short} />
          </div>

          {!standing.eligible && (
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 13, lineHeight: 1.65 }}>
              Not eligible yet — you need {standing.missing.join(', and ')}.
            </p>
          )}
          {standing.eligible && !profile?.on_leaderboard && (
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 13, lineHeight: 1.65 }}>
              You qualify. You’ll only appear if you switch the leaderboard on in your
              profile.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Shared Setups" delay={0.06} style={{ marginTop: 15 }}
        right={profile?.publishes && (
          <button onClick={() => setComposing({ published: true })} style={ghost}>Publish a setup</button>
        )}>
        {feed.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.7 }}>
            Nothing published yet. A setup is a written thesis with the author’s own numbers
            attached — what they look for, and how it has actually gone.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {feed.map((s) => <SetupCard key={s.id} setup={s} onReport={report} />)}
          </div>
        )}
      </Panel>

      {profile && setups.length > 0 && (
        <Panel title="Your Setups" delay={0.08} style={{ marginTop: 15 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {setups.map((s) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap',
                padding: '10px 13px', borderRadius: 10, background: 'var(--card-2)',
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 160 }}>{s.title}</span>
                <span style={{
                  fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase',
                  color: s.published ? 'var(--mint)' : 'var(--text-3)',
                }}>{s.removed ? 'removed' : s.published ? 'published' : 'draft'}</span>
                <button onClick={() => setComposing(s)} style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Edit</button>
                <button onClick={() => removeSetup(s.id)} style={{ fontSize: 11.5, color: 'var(--red)' }}>Delete</button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {editing && (
        <ProfileForm
          profile={profile} eligible={standing.eligible}
          onClose={() => setEditing(false)}
          onSave={async (v) => { const r = await saveProfile(v); if (r) setEditing(false) }}
          onLeave={async () => { if (await leave()) setEditing(false) }}
          error={error}
        />
      )}

      {composing && (
        <SetupForm
          initial={composing} stats={standing}
          onClose={() => setComposing(null)}
          onSave={async (v) => { const r = await saveSetup(v); if (r) setComposing(null) }}
          error={error}
        />
      )}
    </>
  )
}

const ghost = {
  padding: '7px 13px', borderRadius: 9, fontSize: 12, fontWeight: 600,
  border: '1px solid var(--stroke)', color: 'var(--text-2)', background: 'transparent',
}

function Line({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="mono" style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------

function SetupCard({ setup, onReport }) {
  const [reporting, setReporting] = useState(false)
  const [done, setDone] = useState(null)
  const prov = describeProvenance(setup)

  return (
    <div style={{ padding: 15, borderRadius: 12, background: 'var(--card-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{setup.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
            {setup.author}
            {setup.timeframe && ` · ${setup.timeframe}`}
            {setup.symbols?.length > 0 && ` · ${setup.symbols.join(', ')}`}
          </div>
        </div>
        <span title={prov.text} style={{
          fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase',
          alignSelf: 'flex-start', padding: '3px 9px', borderRadius: 20,
          color: prov.tone === 'good' ? 'var(--mint)' : 'var(--text-3)',
          border: `1px solid ${prov.tone === 'good' ? 'rgba(62,227,154,0.3)' : 'var(--stroke)'}`,
        }}>{prov.short}</span>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7, margin: '11px 0' }}>
        {setup.thesis}
      </p>

      {setup.tags?.length > 0 && <TagRow tags={setup.tags} max={6} />}

      <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 11.5, color: 'var(--text-3)', flexWrap: 'wrap' }}>
        <span>{setup.stat_trades} trades</span>
        {setup.stat_win_rate !== null && <span>{setup.stat_win_rate}% win rate</span>}
        {setup.stat_profit_factor !== null && <span>PF {setup.stat_profit_factor}</span>}
        {setup.stat_expectancy_r !== null && (
          <span>{setup.stat_expectancy_r >= 0 ? '+' : '−'}{Math.abs(setup.stat_expectancy_r).toFixed(2)}R / trade</span>
        )}
      </div>

      {/* The reason the numbers above are safe to show at all. Repeated per
          card rather than once per page, because a card is what gets read. */}
      <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 9, lineHeight: 1.55 }}>
        {prov.text}
      </div>

      <div style={{ marginTop: 10 }}>
        {done ? (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {done.already ? 'You already reported this.' : 'Reported — thanks.'}
          </span>
        ) : reporting ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {Object.entries(REPORT_REASONS).map(([key, label]) => (
              <button key={key}
                onClick={async () => { setDone(await onReport(setup.id, key)); setReporting(false) }}
                style={{ ...ghost, padding: '4px 9px', fontSize: 11 }}>{label}</button>
            ))}
            <button onClick={() => setReporting(false)} style={{ fontSize: 11, color: 'var(--text-3)' }}>cancel</button>
          </div>
        ) : (
          <button onClick={() => setReporting(true)} style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Report
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ProfileForm({ profile, eligible, onClose, onSave, onLeave, error }) {
  const [handle, setHandle] = useState(profile?.handle || '')
  const [bio, setBio] = useState(profile?.bio || '')
  const [onBoard, setOnBoard] = useState(!!profile?.on_leaderboard)
  const [publishes, setPublishes] = useState(!!profile?.publishes)
  const [confirmLeave, setConfirmLeave] = useState(false)

  return (
    <Modal onClose={onClose} title={profile ? 'Your community profile' : 'Join the community'}>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 18, lineHeight: 1.65 }}>
        Your handle is the only thing other traders see. Your email, your account size and
        your balances are never published, and results are shown in R multiples so nobody
        can work out how much you trade.
      </p>

      <Field label="Handle" hint="Letters, numbers and underscores. 3–20 characters.">
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="trader_99" />
      </Field>

      <Field label="Bio" hint="Optional. One line about how you trade.">
        <input value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} />
      </Field>

      {/* Two switches, not one. "I'll share a write-up" and "rank me against
          strangers" are different appetites, and bundling them forces the more
          exposed choice on someone who only wanted the other. */}
      <Toggle
        checked={onBoard} onChange={setOnBoard}
        label="Show me on the leaderboard"
        hint={eligible
          ? 'Publishes your handle, win rate, trade count and expectancy in R.'
          : `You don’t qualify yet (${MIN_TRADES} trades across ${MIN_DAYS} days). You can switch this on now and appear once you do.`}
      />
      <Toggle
        checked={publishes} onChange={setPublishes}
        label="Let me publish setups"
        hint="Each setup is still published individually — this only unlocks the ability."
      />

      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 22, flexWrap: 'wrap' }}>
        <div>
          {profile && (confirmLeave ? (
            <button onClick={onLeave}
              style={{ ...ghost, color: 'var(--red)', borderColor: 'rgba(255,90,90,0.3)' }}>
              Yes, delete my profile and setups
            </button>
          ) : (
            <button onClick={() => setConfirmLeave(true)} style={{ fontSize: 12, color: 'var(--red)' }}>
              Leave the community
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ fontSize: 13, color: 'var(--text-3)', padding: '9px 14px' }}>Cancel</button>
          <button className="btn-primary"
            onClick={() => onSave({ handle, bio, onLeaderboard: onBoard, publishes })}>
            {profile ? 'Save' : 'Join'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SetupForm({ initial, stats, onClose, onSave, error }) {
  const [f, setF] = useState({
    id: initial?.id,
    title: initial?.title || '',
    thesis: initial?.thesis || '',
    tags: (initial?.tags || []).join(', '),
    symbols: (initial?.symbols || []).join(', '),
    timeframe: initial?.timeframe || '',
    published: initial?.published ?? true,
  })

  return (
    <Modal onClose={onClose} title={initial?.id ? 'Edit setup' : 'Publish a setup'}>
      <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="London sweep into FVG" /></Field>
      <Field label="The idea" hint="What you look for, and why.">
        <textarea value={f.thesis} onChange={(e) => setF({ ...f, thesis: e.target.value })}
          style={{ minHeight: 110, resize: 'vertical' }} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Field label="Tags" hint="Comma separated."><input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="fvg, liquidity-sweep" /></Field>
        <Field label="Symbols"><input value={f.symbols} onChange={(e) => setF({ ...f, symbols: e.target.value })} placeholder="EURUSD, XAUUSD" /></Field>
        <Field label="Timeframe"><input value={f.timeframe} onChange={(e) => setF({ ...f, timeframe: e.target.value })} placeholder="M15" /></Field>
      </div>

      {/* Shown before publishing, not after. These numbers are the claim being
          made, and they are frozen at this moment — so the author should see
          exactly what they are attaching. */}
      <div style={{ marginTop: 16, padding: 13, borderRadius: 10, background: 'var(--card-2)' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
          Your numbers, attached as a snapshot
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-2)', flexWrap: 'wrap' }}>
          <span>{stats.trades} trades</span>
          <span>{stats.winRate}% win rate</span>
          {stats.profitFactor !== null && <span>PF {stats.profitFactor}</span>}
          {stats.expectancyR !== null && <span>{stats.expectancyR.toFixed(2)}R / trade</span>}
          <span>{describeProvenance(stats).short}</span>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.55 }}>
          Taken from every closed trade in your journal, right now, and frozen. They won’t
          change later — the write-up says how it went over these trades. No currency
          figures are published.
        </p>
      </div>

      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button onClick={onClose} style={{ fontSize: 13, color: 'var(--text-3)', padding: '9px 14px' }}>Cancel</button>
        <button onClick={() => onSave({
          ...f,
          published: false,
          tags: f.tags.split(','),
          symbols: f.symbols.split(','),
          stats,
        })} style={ghost}>Save draft</button>
        <button className="btn-primary" onClick={() => onSave({
          ...f,
          published: true,
          tags: f.tags.split(','),
          symbols: f.symbols.split(','),
          stats,
        })}>Publish</button>
      </div>
    </Modal>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '5vh 16px', overflowY: 'auto',
    }}>
      <motion.div className="card" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        style={{ padding: 24, width: '100%', maxWidth: 560 }}>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: 18, fontWeight: 700, marginBottom: 14 }}>{title}</h3>
        {children}
      </motion.div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 13 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
    </label>
  )
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.5 }}>{hint}</span>}
      </span>
    </label>
  )
}
