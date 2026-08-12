import { ratingColor } from '../lib/journal'

// The spec's 1-10 rating control: a slider with a red-to-green gradient track
// and a live readout. Replaces the old 1-5 star widget so there is one rating
// for a trade rather than two competing ones.
export default function RatingSlider({ value, onChange, disabled }) {
  const set = value ?? 5
  const color = ratingColor(value)

  return (
    <div className="rating-slider" style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        {/* Gradient sits behind the native input so the track reads as a
            quality scale rather than a neutral bar. */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '50%', height: 6,
          transform: 'translateY(-50%)', borderRadius: 3, pointerEvents: 'none',
          background: 'linear-gradient(90deg, var(--red), var(--amber) 55%, var(--mint))',
          opacity: value == null ? 0.25 : 0.85,
        }} />
        <input
          type="range" min="1" max="10" step="1" value={set} disabled={disabled}
          onChange={(e) => onChange?.(Number(e.target.value))}
          aria-label="Trade rating out of 10"
          style={{
            position: 'relative', width: '100%', accentColor: color,
            background: 'transparent', cursor: disabled ? 'default' : 'pointer',
          }}
        />
      </div>

      <span className="mono" style={{
        fontSize: 15, fontWeight: 700, color, minWidth: 52, textAlign: 'right',
      }}>
        {value == null ? '—' : `${value}/10`}
      </span>

      {value != null && onChange && (
        <button onClick={() => onChange(null)} title="Clear rating"
          style={{ color: 'var(--text-3)', fontSize: 14, padding: 2 }}>✕</button>
      )}
    </div>
  )
}
