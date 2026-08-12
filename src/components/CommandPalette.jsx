import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { VIEWS } from '../lib/views'

// ⌘K / Ctrl-K palette. Today it searches sections; as later phases land it's
// the natural place to add trades and symbols to the result set.
export default function CommandPalette({ open, onClose, onNavigate, onAdd }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)

  const actions = useMemo(() => [
    { id: 'action:add', label: 'Add trade', hint: 'Action', run: onAdd },
    ...VIEWS.map((v) => ({
      id: `view:${v.key}`,
      label: v.label,
      hint: v.ready ? 'Go to' : `Phase ${v.phase}`,
      detail: v.description,
      dimmed: !v.ready,
      run: () => onNavigate(v.key),
    })),
  ], [onNavigate, onAdd])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter((a) =>
      a.label.toLowerCase().includes(q) || (a.detail || '').toLowerCase().includes(q))
  }, [actions, query])

  // Reset each time it opens so it never reopens mid-search.
  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      // Focus after the entry animation has mounted the input.
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open])

  // Keep the highlighted row inside the result list as it shrinks.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(results.length - 1, 0)))
  }, [results.length])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (results.length ? (c + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[cursor]
      if (hit) { hit.run(); onClose() }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 90,
            background: 'rgba(4, 8, 7, 0.62)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '12vh 16px 16px',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560, overflow: 'hidden',
              background: 'var(--card)', border: '1px solid var(--stroke)',
              borderRadius: 16, boxShadow: 'var(--shadow)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
              borderBottom: '1px solid var(--stroke)',
            }}>
              <span style={{ color: 'var(--text-3)', fontSize: 15 }}>⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search sections and actions…"
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: 'var(--text)', fontSize: 15,
                }}
              />
              <kbd style={kbdStyle}>esc</kbd>
            </div>

            <div style={{ maxHeight: '48vh', overflowY: 'auto', padding: 8 }}>
              {results.length === 0 && (
                <div style={{ padding: '22px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                  Nothing matches “{query}”.
                </div>
              )}
              {results.map((r, i) => (
                <button
                  key={r.id}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => { r.run(); onClose() }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', borderRadius: 10, textAlign: 'left',
                    background: i === cursor ? 'var(--card-hover)' : 'transparent',
                    color: r.dimmed ? 'var(--text-2)' : 'var(--text)',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{r.label}</span>
                    {r.detail && (
                      <span style={{
                        display: 'block', fontSize: 11.5, color: 'var(--text-3)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{r.detail}</span>
                    )}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-3)', flexShrink: 0 }}>{r.hint}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const kbdStyle = {
  fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 6px', borderRadius: 5,
  border: '1px solid var(--stroke)', color: 'var(--text-3)', background: 'var(--card-2)',
}
