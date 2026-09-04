import { useMemo } from 'react'

// Reuses the app's own established vote-tier/brand colors rather than
// introducing new ones just for this.
const COLORS = ['#6d8a1c', '#d9c01a', '#c2731f', '#c21f1f', '#2D3DCA', '#6da627']

// Lightweight, dependency-free celebratory burst — a handful of small
// colored pieces that fly outward and fall/fade over ~700ms (see the
// senseus-confetti-fall keyframe in index.css), then this component just
// sits there with nothing left visible (callers don't need to unmount it).
// Reused wherever a moment deserves more fanfare than a plain toast/banner
// — a freshly-earned badge (NotificationPopup), a first vote (ResultsCard).
// Purely decorative: aria-hidden, absolutely positioned to fill and center
// on the nearest positioned ancestor, no effect on layout or hit-testing.
export default function ConfettiBurst({ count = 14 }) {
  const pieces = useMemo(() => (
    Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6
      const distance = 40 + Math.random() * 30
      return {
        id: i,
        color: COLORS[i % COLORS.length],
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        rot: Math.round(Math.random() * 360 - 180),
        delay: Math.random() * 0.1,
        size: 5 + Math.round(Math.random() * 3),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- randomized once per mount, deliberately not re-rolled on re-renders while the burst is playing
  ), [])

  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      {pieces.map(p => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: `${p.size}px`,
            height: `${p.size}px`,
            borderRadius: '2px',
            background: p.color,
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
            '--rot': `${p.rot}deg`,
            animation: `senseus-confetti-fall 0.7s ease-out ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  )
}
