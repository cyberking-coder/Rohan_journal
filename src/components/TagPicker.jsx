import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CATALOGUE, normaliseTag, tagInfo } from '../lib/tags'

/**
 * Picks tags for a trade.
 *
 * The design constraint is that this gets used at the end of a trade, when the
 * trader wants to close the form and walk away — so it has to be faster than
 * skipping it. Typing two letters and pressing Enter is one tag; nothing to
 * open, no list to scroll.
 *
 * Mistake tags are visually separated from concepts, because the moment you
 * make picking "revenge trade" feel the same as picking "FVG" is the moment
 * people stop picking it.
 */
export default function TagPicker({ value = [], onChange, suggestions = [] }) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  const selected = value || []
  const has = (slug) => selected.includes(slug)

  const add = (raw) => {
    const slug = normaliseTag(raw)
    if (!slug || has(slug)) { setQuery(''); return }
    if (selected.length >= 12) return
    onChange([...selected, slug])
    setQuery('')
  }

  const drop = (slug) => onChange(selected.filter((s) => s !== slug))

  // Everything known, plus whatever this user has actually used — so their own
  // vocabulary is one keystroke away on the second trade, not just the first.
  const pool = useMemo(() => {
    const seen = new Set(CATALOGUE.map((c) => c.slug))
    const extra = suggestions
      .filter((s) => !seen.has(s.slug))
      .map((s) => ({ slug: s.slug, label: s.label, category: s.category }))
    return [...CATALOGUE, ...extra]
  }, [suggestions])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return pool
      .filter((c) => !has(c.slug))
      .filter((c) => c.label.toLowerCase().includes(q) || c.slug.includes(q))
      .slice(0, 8)
  }, [query, pool, selected])

  const exactExists = matches.some((m) => m.slug === normaliseTag(query))

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // The top match wins, so the fast path is type-a-bit-then-Enter. Falling
      // back to the raw text is what lets a new tag be created without
      // reaching for a separate "add" affordance.
      add(matches[0]?.slug || query)
    } else if (e.key === 'Backspace' && !query && selected.length) {
      drop(selected[selected.length - 1])
    } else if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
    }
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
          background: 'var(--input-bg)', border: '1px solid var(--stroke)',
          borderRadius: 11, padding: '8px 10px', minHeight: 42, cursor: 'text',
        }}
      >
        {selected.map((slug) => <Chip key={slug} slug={slug} onRemove={() => drop(slug)} />)}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          // Delayed so a click on a suggestion lands before the list closes.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={selected.length ? '' : 'FVG, liquidity sweep, moved stop…'}
          style={{
            flex: '1 1 120px', minWidth: 120, border: 'none', outline: 'none',
            background: 'transparent', color: 'var(--text)', fontSize: 12.5, padding: '3px 2px',
          }}
        />
      </div>

      {focused && query.trim() && (
        <motion.div
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="card"
          style={{ marginTop: 6, padding: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}
        >
          {matches.map((m) => (
            <button key={m.slug} type="button" onMouseDown={() => add(m.slug)}
              style={suggestionStyle(m.category)}>
              {m.label}
            </button>
          ))}
          {!exactExists && normaliseTag(query) && (
            <button type="button" onMouseDown={() => add(query)}
              style={{ ...suggestionStyle('custom'), borderStyle: 'dashed' }}>
              + “{query.trim()}”
            </button>
          )}
          {!matches.length && !normaliseTag(query) && (
            <span style={{ fontSize: 11.5, color: 'var(--text-3)', padding: '4px 6px' }}>
              Nothing to add
            </span>
          )}
        </motion.div>
      )}

      {!focused && !selected.length && (
        <QuickRow onPick={add} />
      )}
    </div>
  )
}

// The handful worth one click when the field is empty. Kept short on purpose:
// a wall of thirty buttons is scrolled past, not read.
const QUICK = ['fvg', 'liquidity-sweep', 'order-block', 'bos', 'choch', 'moved-stop', 'fomo', 'no-setup']

function QuickRow({ onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
      {QUICK.map((slug) => {
        const info = tagInfo(slug)
        return (
          <button key={slug} type="button" onClick={() => onPick(slug)}
            style={{ ...suggestionStyle(info.category), fontSize: 10.5, opacity: 0.75 }}>
            {info.label}
          </button>
        )
      })}
    </div>
  )
}

export function Chip({ slug, onRemove, small }) {
  const info = tagInfo(slug)
  const c = colorFor(info.category)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: c.bg, color: c.fg, border: `1px solid ${c.line}`,
      borderRadius: 20, padding: small ? '2px 8px' : '3px 9px',
      fontSize: small ? 10.5 : 11.5, fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      {info.label}
      {onRemove && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove() }}
          aria-label={`Remove ${info.label}`}
          style={{ color: c.fg, opacity: 0.65, fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
      )}
    </span>
  )
}

// Mistakes read red, concepts read blue, custom reads neutral. The colour is
// the whole reason a wall of tags is scannable.
export function colorFor(category) {
  if (category === 'mistake') {
    return { bg: 'rgba(255,90,90,0.10)', fg: 'var(--red)', line: 'rgba(255,90,90,0.28)' }
  }
  if (category === 'concept') {
    return { bg: 'rgba(107,167,255,0.10)', fg: '#7fb2ff', line: 'rgba(107,167,255,0.28)' }
  }
  return { bg: 'var(--card-2)', fg: 'var(--text-2)', line: 'var(--stroke)' }
}

function suggestionStyle(category) {
  const c = colorFor(category)
  return {
    background: c.bg, color: c.fg, border: `1px solid ${c.line}`,
    borderRadius: 20, padding: '4px 10px', fontSize: 11.5, fontWeight: 500,
  }
}

/** Read-only row of a trade's tags, for tables and cards. */
export function TagRow({ tags = [], max = 4, small = true }) {
  if (!tags.length) return null
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {shown.map((s) => <Chip key={s} slug={s} small={small} />)}
      {rest > 0 && <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>+{rest}</span>}
    </span>
  )
}
