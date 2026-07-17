// Tracks the pointer and updates the hovered .card's spotlight position
// via CSS custom properties (--mx / --my). Purely cosmetic, cheap, passive.

let raf = 0
let lastEvent = null

function apply() {
  raf = 0
  if (!lastEvent) return
  const el = document.elementFromPoint(lastEvent.clientX, lastEvent.clientY)
  const card = el && el.closest ? el.closest('.card') : null
  if (!card) return
  const r = card.getBoundingClientRect()
  card.style.setProperty('--mx', `${lastEvent.clientX - r.left}px`)
  card.style.setProperty('--my', `${lastEvent.clientY - r.top}px`)
}

export function initCardGlow() {
  if (typeof window === 'undefined') return
  window.addEventListener(
    'pointermove',
    (e) => {
      lastEvent = e
      if (!raf) raf = requestAnimationFrame(apply)
    },
    { passive: true }
  )
}
