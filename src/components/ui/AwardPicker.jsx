import { useEffect, useRef, useState } from 'react'
import AwardIcon from './AwardIcons'
import { AWARD_CATALOG } from '../../lib/awardInfo'

// Comment Awards — the "give an award" bottom sheet, opened from a
// comment's action row. Same bottom-sheet shape as CardActionSheet (fixed
// scrim, flex-end, 480px-capped panel, focus management, Escape-to-
// close), but with a grid of award buttons instead of a plain action
// list, since choosing an award is a one-tap visual pick, not a line of
// text to read.
//
// remainingPoints: the caller's current monthly balance (from
// get_remaining_award_points(), fetched once on page load — see
// Conversation.jsx). alreadyGiven: a Set of award_type ids this user has
// already given THIS comment (from userGivenAwards, built off the same
// get_comment_award_details() call the "who gave this" expand uses, or
// simply tracked locally after a successful give — see Conversation.jsx
// for how it's populated). onGive(awardType) must return a promise that
// resolves to the new remaining-points count on success, or throws with
// a message on failure (give_comment_award()'s own exception text) —
// this component surfaces that message rather than swallowing it.
export default function AwardPicker({ remainingPoints, alreadyGiven, onGive, onClose }) {
  const panelRef = useRef(null)
  const [givingId, setGivingId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    panelRef.current?.focus()

    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only, same reasoning as CardActionSheet
  }, [])

  async function handlePick(award) {
    if (givingId || alreadyGiven.has(award.id) || remainingPoints < award.cost) return
    setGivingId(award.id)
    setError(null)
    try {
      await onGive(award.id)
      onClose()
    } catch (err) {
      setError(err?.message || 'Could not give that award. Try again.')
      setGivingId(null)
    }
  }

  const bigOnes = AWARD_CATALOG.filter((a) => a.cost === 5)
  const everyday = AWARD_CATALOG.filter((a) => a.cost === 1)

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Give an award"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          margin: '0 auto',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: '#FFFFFF',
          borderRadius: '16px 16px 0 0',
          padding: '1.5rem',
          paddingBottom: '2rem',
          fontFamily: 'Merriweather, serif',
          boxSizing: 'border-box',
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A' }}>Give an award</div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>
            {remainingPoints} left this month
          </div>
        </div>
        <p style={{ fontSize: '12px', color: '#6B7280', margin: '0 0 16px', lineHeight: 1.4 }}>
          Free, shared monthly pool. Gold Star and Needs Work use your whole allowance; the rest cost 1. No rollover.
        </p>

        {error && (
          <div style={{ fontSize: '12px', color: '#7a1313', background: '#F9D8D8', borderRadius: '8px', padding: '8px 10px', marginBottom: '12px' }}>
            {error}
          </div>
        )}

        <AwardGroup
          title="The big ones"
          awards={bigOnes}
          remainingPoints={remainingPoints}
          alreadyGiven={alreadyGiven}
          givingId={givingId}
          onPick={handlePick}
        />
        <AwardGroup
          title="Everyday"
          awards={everyday}
          remainingPoints={remainingPoints}
          alreadyGiven={alreadyGiven}
          givingId={givingId}
          onPick={handlePick}
        />

        <button
          onClick={onClose}
          style={{
            width: '100%', textAlign: 'center', padding: '14px 0', marginTop: '8px',
            background: '#F3F4F6', border: 'none', borderRadius: '8px', fontSize: '14px',
            fontWeight: 500, color: '#6B7280', cursor: 'pointer', fontFamily: 'Merriweather, serif',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function AwardGroup({ title, awards, remainingPoints, alreadyGiven, givingId, onPick }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
        {awards.map((award) => {
          const given = alreadyGiven.has(award.id)
          const tooExpensive = remainingPoints < award.cost
          const disabled = given || tooExpensive || !!givingId
          return (
            <button
              key={award.id}
              onClick={() => onPick(award)}
              disabled={disabled}
              title={award.description}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                padding: '12px 6px', borderRadius: '12px',
                border: '0.5px solid #E5E7EB',
                background: given ? '#F3F4F6' : '#FFFFFF',
                cursor: disabled ? 'default' : 'pointer',
                opacity: tooExpensive && !given ? 0.45 : 1,
                position: 'relative',
              }}
            >
              <span style={{
                position: 'absolute', top: '4px', right: '6px', fontSize: '9px', fontWeight: 700,
                color: '#9CA3AF',
              }}>
                {award.cost}
              </span>
              <div style={{ opacity: givingId === award.id ? 0.5 : 1 }}>
                <AwardIcon id={award.id} size={award.cost === 5 ? 48 : 40} />
              </div>
              <span style={{ fontSize: '10.5px', fontWeight: 600, color: given ? '#9CA3AF' : '#1A1A1A', textAlign: 'center', lineHeight: 1.25 }}>
                {given ? 'Given' : award.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
