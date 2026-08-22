import { useMemo, useState } from 'react'
import {
  MODES, PRESETS, fmtMinute, parseMinute, resolveSessions, segments, span, validate,
} from '../lib/sessionConfig'

/**
 * Edits the session definitions the Analysis module buckets trades into.
 *
 * PRD §43 asks that these not be hard-coded. The thing that makes an editor
 * like this actually usable, rather than a form you fill in and hope about, is
 * the preview bar: you can see the gap or the overlap before saving, and the
 * warnings say what each one will do to the numbers rather than just refusing.
 */
export default function SessionEditor({ config, onChange }) {
  const resolved = useMemo(() => resolveSessions(config), [config])
  const issues = useMemo(() => validate(resolved), [resolved])
  const [editing, setEditing] = useState(() => Array.isArray(config?.sessions) && config.sessions.length > 0)

  const usePreset = (key) => {
    setEditing(false)
    onChange({ preset: key, mode: PRESETS[key].mode, sessions: null })
  }

  // Editing starts from whatever is on screen, so "customise" never blanks the
  // list and make the user rebuild it from nothing.
  const startEditing = () => {
    setEditing(true)
    onChange({ preset: 'custom', mode: resolved.mode, sessions: resolved.sessions.map(strip) })
  }

  const patch = (i, field, value) => {
    const next = resolved.sessions.map(strip)
    next[i] = { ...next[i], [field]: value }
    onChange({ preset: 'custom', mode: resolved.mode, sessions: next })
  }

  const removeAt = (i) => {
    const next = resolved.sessions.map(strip).filter((_, j) => j !== i)
    onChange({ preset: 'custom', mode: resolved.mode, sessions: next })
  }

  const addOne = () => {
    const next = resolved.sessions.map(strip)
    // Starts where the last one ended, which in a partition is the only place
    // a new window can go without immediately creating a gap.
    const from = next.length ? next[next.length - 1].end : 0
    next.push({ id: `session-${next.length + 1}`, label: 'New session', start: from, end: (from + 120) % 1440 })
    onChange({ preset: 'custom', mode: resolved.mode, sessions: next })
  }

  const setMode = (mode) => onChange({
    preset: 'custom', mode, sessions: resolved.sessions.map(strip),
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.values(PRESETS).map((p) => {
          const on = !editing && resolved.id === p.id
          return (
            <button key={p.id} onClick={() => usePreset(p.id)} title={p.note}
              style={pill(on)}>{p.label}</button>
          )
        })}
        <button onClick={startEditing} style={pill(editing)}>Customise…</button>
      </div>

      {!editing && resolved.note && (
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 12 }}>
          {resolved.note}
        </p>
      )}

      <PreviewBar sessions={resolved.sessions} />

      {issues.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {issues.map((it, i) => (
            <div key={i} style={{
              fontSize: 11.5, lineHeight: 1.55, padding: '8px 11px', borderRadius: 9,
              background: 'rgba(232,177,58,0.09)', border: '1px solid rgba(232,177,58,0.26)',
              color: 'var(--amber, #e8b13a)',
            }}>{it.message}</div>
          ))}
        </div>
      )}

      {editing && (
        <>
          <div style={{ display: 'flex', gap: 4, marginTop: 14, marginBottom: 10, background: 'var(--card-2)', borderRadius: 9, padding: 3, width: 'fit-content' }}>
            {Object.entries(MODES).map(([k, v]) => (
              <button key={k} onClick={() => setMode(k)} title={v.hint}
                style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
                  background: resolved.mode === k ? 'var(--card-hover)' : 'transparent',
                  color: resolved.mode === k ? 'var(--text)' : 'var(--text-3)',
                }}>{v.label}</button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.55 }}>
            {MODES[resolved.mode].hint}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resolved.sessions.map((s, i) => (
              <div key={`${s.id}-${i}`} style={{
                display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                padding: '9px 11px', borderRadius: 10, background: 'var(--card-2)',
                borderLeft: `2px solid ${s.tint}`,
              }}>
                <input value={s.label} onChange={(e) => patch(i, 'label', e.target.value)}
                  style={{ ...input, flex: '1 1 130px', minWidth: 110 }} />
                <TimeBox value={s.start} onChange={(v) => patch(i, 'start', v)} />
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>→</span>
                <TimeBox value={s.end} onChange={(v) => patch(i, 'end', v)} />
                <span style={{ fontSize: 10.5, color: 'var(--text-3)', minWidth: 46 }}>
                  {fmtDuration(span(s))}
                </span>
                <button onClick={() => removeAt(i)}
                  style={{ fontSize: 11, color: 'var(--red)', marginLeft: 'auto' }}>remove</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            <button onClick={addOne} style={pill(false)}>+ Add session</button>
            <button onClick={() => usePreset('classic')} style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
              Reset to classic
            </button>
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.6 }}>
            Times are UTC. A session whose end is earlier than its start wraps past
            midnight, which is how the Asian session is written.
          </p>
        </>
      )}
    </div>
  )
}

function strip(s) {
  return { id: s.id, label: s.label, start: s.start, end: s.end }
}

/**
 * Time input that only commits a valid time.
 *
 * Typing is held in local state so a half-typed "0" doesn't momentarily become
 * midnight and redraw every bar on the page under the user's fingers.
 */
function TimeBox({ value, onChange }) {
  const [text, setText] = useState(null)
  const shown = text === null ? fmtMinute(value) : text
  const bad = text !== null && parseMinute(text) === null

  return (
    <input
      value={shown}
      onChange={(e) => {
        setText(e.target.value)
        const m = parseMinute(e.target.value)
        if (m !== null) onChange(m)
      }}
      onBlur={() => setText(null)}
      style={{
        ...input, width: 64, textAlign: 'center', fontFamily: 'var(--mono)',
        borderColor: bad ? 'var(--red)' : 'var(--stroke)',
      }}
    />
  )
}

function PreviewBar({ sessions }) {
  return (
    <div>
      <div style={{ position: 'relative', height: 30, borderRadius: 8, overflow: 'hidden', background: 'var(--card-2)' }}>
        {sessions.map((s) => segments(s).map(({ start, end }, i) => (
          <div key={`${s.id}-${i}`} title={`${s.label} ${fmtMinute(s.start)}–${fmtMinute(s.end)}`}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%`,
              background: s.tint, opacity: 0.28, borderRight: '1px solid var(--stroke)',
            }} />
        )))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9.5, color: 'var(--text-3)' }}>
        {[0, 6, 12, 18, 24].map((h) => <span key={h}>{String(h % 24).padStart(2, '0')}:00</span>)}
      </div>
    </div>
  )
}

function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

const input = {
  background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)',
  borderRadius: 8, padding: '7px 9px', fontSize: 12.5, outline: 'none',
}

function pill(on) {
  return {
    padding: '6px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600,
    border: `1px solid ${on ? 'var(--mint)' : 'var(--stroke)'}`,
    color: on ? 'var(--mint)' : 'var(--text-3)',
    background: on ? 'rgba(47,212,138,0.09)' : 'transparent',
  }
}
