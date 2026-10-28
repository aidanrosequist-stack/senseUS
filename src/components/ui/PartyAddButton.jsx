import { IconCirclePlus, IconCircleCheckFilled } from '@tabler/icons-react'

// Shared "add to ? Party list" toggle — same interaction shape as
// PinButton (a single icon that swaps on click, e.stopPropagation() since
// every surface this sits on is itself clickable/long-press-triggering),
// but visually and semantically its own control: pinning is a private
// bookmark, this toggles a question's membership in party_questions, the
// standing curation list a "? Party" invite snapshots from (migration
// 095_question_parties.sql). A plain "+" (unadded) flipping to a filled
// checkmark (added) reads more clearly here than PinButton's own
// pin/pin-filled pair would — "added" should look like a confirmation, not
// just a darker version of the same glyph. Purple (#7C3AED) keeps it
// visually distinct from PinButton's blue, Aidan's own call deferred to
// here per his "I'm open to suggestions" — easy to swap later.
export default function PartyAddButton({ added, onToggle, size = 16, style }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-label={added ? 'Remove from ? Party list' : 'Add to ? Party list'}
      aria-pressed={added}
      title={added ? 'Remove from ? Party list' : 'Add to ? Party list'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'none',
        border: 'none',
        padding: '2px',
        cursor: 'pointer',
        color: added ? '#7C3AED' : '#9CA3AF',
        ...style,
      }}
    >
      {added ? <IconCircleCheckFilled size={size} /> : <IconCirclePlus size={size} />}
    </button>
  )
}
