import { useState, useRef } from 'react'
import { IconTrash } from '@tabler/icons-react'

const REVEAL_WIDTH = 72
const SWIPE_OPEN_THRESHOLD = 36

// Generic swipe-right-to-reveal-delete wrapper, per Aidan's request
// (2026-10-29): swipe a row right, a red trash button appears on the
// left, tap it to delete. Used for the "? Party" tab's own curated-
// question list (swipe removes that question from the standing
// party_questions curation list -- the exact same effect its existing
// long-press "Remove from ? Party list" action already has) and
// completed/expired party rows (swipe hides that party from just this
// account's own list -- see hide_party(), migration
// 097_hide_completed_parties.sql).
//
// Horizontal-vs-vertical intent is gated the same way VoteCard/
// QuestionFlow already gate their own touch gestures elsewhere in this
// app: whichever axis moves further in the first few pixels of a drag
// wins, decided once per gesture and then stuck to. A vertical-leaning
// drag is left completely alone -- this never calls preventDefault() for
// that case, so the page's normal scroll keeps working underneath a
// list of these rows exactly as if this component weren't there.
//
// Tapping anywhere on the row while the trash button is revealed just
// closes it back up rather than letting the tap fall through to
// whatever the row's own onClick does (navigate, in both current call
// sites) -- the same "first tap dismisses, doesn't also act" pattern
// iOS's own swipe-to-delete rows use.
export default function SwipeToDelete({ onDelete, children, disabled = false }) {
  const [offset, setOffset] = useState(0)
  const dragging = useRef(false)
  const axis = useRef(null) // 'x' | 'y' | null -- decided once per gesture, then stuck to
  const start = useRef({ x: 0, y: 0 })
  const startOffset = useRef(0)

  function handleStart(clientX, clientY) {
    if (disabled) return
    start.current = { x: clientX, y: clientY }
    startOffset.current = offset
    axis.current = null
    dragging.current = true
  }

  function handleMove(e, clientX, clientY) {
    if (!dragging.current) return
    const dx = clientX - start.current.x
    const dy = clientY - start.current.y

    if (axis.current === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return // not enough movement yet to tell intent
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (axis.current === 'y') return // vertical drag -- leave it alone, let the page scroll

    e.preventDefault()
    const next = Math.min(Math.max(startOffset.current + dx, 0), REVEAL_WIDTH)
    setOffset(next)
  }

  function handleEnd() {
    if (!dragging.current) return
    dragging.current = false
    if (axis.current === 'x') {
      setOffset((cur) => (cur > SWIPE_OPEN_THRESHOLD ? REVEAL_WIDTH : 0))
    }
    axis.current = null
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '10px' }}>
      <button
        type="button"
        onClick={() => { setOffset(0); onDelete() }}
        aria-label="Delete"
        tabIndex={offset > 0 ? 0 : -1}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: `${REVEAL_WIDTH}px`,
          background: '#c21f1f',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <IconTrash size={20} color="white" />
      </button>
      <div
        onTouchStart={(e) => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => handleMove(e, e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={handleEnd}
        onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
        onMouseMove={(e) => handleMove(e, e.clientX, e.clientY)}
        onMouseUp={handleEnd}
        onMouseLeave={() => dragging.current && handleEnd()}
        onClickCapture={(e) => {
          if (offset > 0) {
            e.preventDefault()
            e.stopPropagation()
            setOffset(0)
          }
        }}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging.current ? 'none' : 'transform 0.2s ease',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  )
}
