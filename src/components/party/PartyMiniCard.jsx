import { useRef, useState } from 'react'
import { IconThumbUp, IconThumbDown, IconBulb } from '@tabler/icons-react'

// migration: 098/099 (?Party revamp, 2026-11-01) — the condensed voting row
// used on the party page's full scrollable question list (Party.jsx). Not
// a smaller VoteCard — a single-row design Aidan picked explicitly over a
// dedicated one-at-a-time vote page, after several mockup rounds together:
// question text, a row of 4 thumb-icon stance buttons (same colors/icons
// as VoteCard, no pill shape, no explicit "Neutral" button — leaving every
// question blank is allowed, so there's deliberately no 5th button for
// it), and a condensed Make Up My Mind button underneath.
//
// Tapping an already-selected stance again retracts the vote (back to
// blank/no-opinion) — same semantics Aidan asked to add to the regular
// VoteCard too (migration 099's retract_vote(), not the dead 'dec' value).
// Swiping left/right also casts a vote, mirroring VoteCard's own gesture,
// but deliberately without VoteCard's hold-to-vote/audio ceremony — these
// rows live inside a vertically-scrolling list, so the drag only commits
// once it's clearly horizontal-dominant and past threshold, and
// `touchAction: 'pan-y'` leaves normal vertical scrolling alone until then.
const STANCES = [
  { key: 'yes', bg: '#eef3e0', border: '#4d621d', circle: '#6d8a1c', label: 'Yes', icon: 'up', rotate: false, textColor: '#27500A' },
  { key: 'ly', bg: '#faf6d0', border: '#7a6b0e', circle: '#d9c01a', label: 'Lean Yes', icon: 'up', rotate: true, textColor: '#633806' },
  { key: 'ln', bg: '#f9ead8', border: '#7a4513', circle: '#c2731f', label: 'Lean No', icon: 'down', rotate: true, textColor: '#993C1D' },
  { key: 'no', bg: '#f9d8d8', border: '#7a1313', circle: '#c21f1f', label: 'No', icon: 'down', rotate: false, textColor: '#791F1F' },
]
const STANCE_BY_KEY = Object.fromEntries(STANCES.map(s => [s.key, s]))

const THRESH_LEAN = 24
const THRESH_FULL = 64

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern)
}

function zoneFromDx(dx) {
  if (dx < -THRESH_FULL) return 'no'
  if (dx < -THRESH_LEAN) return 'ln'
  if (dx > THRESH_FULL) return 'yes'
  if (dx > THRESH_LEAN) return 'ly'
  return null
}

export default function PartyMiniCard({ question, myChoice, onVote, onRetract, onMakeUpMyMind, readOnly = false }) {
  const [dragDx, setDragDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startPos = useRef({ x: 0, y: 0 })
  const horizontalLock = useRef(null) // null = undecided yet, true/false once a gesture commits to a direction

  const answered = STANCE_BY_KEY[myChoice]

  function handleTapStance(key) {
    if (readOnly) return
    vibrate(key === 'yes' || key === 'no' ? 30 : 12)
    if (myChoice === key) {
      onRetract()
    } else {
      onVote(key)
    }
  }

  function handleStart(x, y) {
    if (readOnly) return
    startPos.current = { x, y }
    horizontalLock.current = null
    setDragging(true)
  }

  function handleMove(x, y, e) {
    if (readOnly || !dragging) return
    const dx = x - startPos.current.x
    const dy = y - startPos.current.y

    if (horizontalLock.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      horizontalLock.current = Math.abs(dx) > Math.abs(dy)
    }

    if (horizontalLock.current) {
      if (e?.cancelable) e.preventDefault()
      setDragDx(dx)
    }
  }

  function handleEnd() {
    if (readOnly) return
    if (horizontalLock.current) {
      const zone = zoneFromDx(dragDx)
      if (zone && zone !== myChoice) {
        vibrate(zone === 'yes' || zone === 'no' ? 30 : 12)
        onVote(zone)
      } else if (zone && zone === myChoice) {
        vibrate(12)
        onRetract()
      }
    }
    setDragging(false)
    setDragDx(0)
    horizontalLock.current = null
  }

  const dragTint = dragging && horizontalLock.current ? STANCE_BY_KEY[zoneFromDx(dragDx)]?.bg : null

  // Per Aidan's testing feedback (2026-11-02): a 5px left-edge-only border
  // read as too subtle to notice scrolling through the list. Now a full
  // border wrapping the whole card, in the stance's `circle` color (the
  // medium-saturation accent already used for the icon badge) rather than
  // the much darker `border` color — less harsh wrapped all the way
  // around at that saturation — plus the same light `bg` wash as a
  // permanent fill once answered, not just during an active drag.
  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: dragTint || (answered ? answered.bg : '#FFFFFF'),
        border: answered ? `2px solid ${answered.circle}` : '0.5px solid #E5E7EB',
        borderRadius: '10px',
        padding: '12px 14px',
        transition: dragging ? 'none' : 'background 0.18s ease, border-color 0.18s ease',
        touchAction: 'pan-y',
        userSelect: 'none',
      }}
      onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
      onMouseMove={(e) => dragging && handleMove(e.clientX, e.clientY, e)}
      onMouseUp={handleEnd}
      onMouseLeave={() => dragging && handleEnd()}
      onTouchStart={(e) => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchMove={(e) => handleMove(e.touches[0].clientX, e.touches[0].clientY, e)}
      onTouchEnd={handleEnd}
    >
      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '20px', background: '#E6F1FB', color: '#0C447C' }}>
          {question.question_category}
        </span>
      </div>
      <div style={{ fontSize: '14px', fontWeight: 500, lineHeight: 1.35, fontFamily: 'Merriweather, serif', color: '#1A1A1A', marginBottom: '10px' }}>
        {question.question_text}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '8px' }}>
        {STANCES.map(({ key, bg, border, circle, label, icon, rotate, textColor }) => {
          const selected = myChoice === key
          return (
            <button
              key={key}
              onClick={() => handleTapStance(key)}
              disabled={readOnly}
              aria-label={selected ? `Remove your ${label} vote` : `Vote ${label}`}
              aria-pressed={selected}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                background: selected ? bg : '#F9FAFB',
                border: `1.5px solid ${selected ? border : '#E5E7EB'}`,
                borderRadius: '8px',
                padding: '7px 2px',
                cursor: readOnly ? 'default' : 'pointer',
                opacity: readOnly && !selected ? 0.55 : 1,
              }}
            >
              <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: selected ? circle : '#D1D5DB', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: rotate ? 'rotate(45deg)' : 'none' }}>
                {icon === 'up' ? <IconThumbUp size={13} color="white" /> : <IconThumbDown size={13} color="white" />}
              </span>
              <span style={{ fontSize: '9px', fontWeight: 500, color: selected ? textColor : '#6B7280', textAlign: 'center' }}>{label}</span>
            </button>
          )
        })}
      </div>

      <button
        onClick={() => !readOnly && onMakeUpMyMind()}
        disabled={readOnly || !!answered}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          background: answered ? '#F3F4F6' : '#E6F1FB',
          border: `1.5px solid ${answered ? '#D1D5DB' : '#0C447C'}`,
          color: answered ? '#9CA3AF' : '#0C447C',
          borderRadius: '7px',
          padding: '6px',
          fontSize: '12px',
          fontWeight: 400,
          cursor: (readOnly || answered) ? 'default' : 'pointer',
          fontFamily: 'Merriweather, serif',
        }}
      >
        <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: answered ? '#D1D5DB' : '#378ADD', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <IconBulb size={11} color="white" />
        </span>
        Make Up My Mind
      </button>
    </div>
  )
}
