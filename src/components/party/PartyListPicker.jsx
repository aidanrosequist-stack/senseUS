import { useEffect, useRef, useState } from 'react'
import { IconSquare, IconSquareCheckFilled } from '@tabler/icons-react'

// Same visual shell as CardActionSheet (backdrop, bottom sheet, focus
// trap, Escape-to-close) but a checklist instead of one-shot actions —
// usePartyLists.smartToggle() opens this only once a question's "add to
// ?Party list" target is genuinely ambiguous (the caller has 2+ lists),
// so this never appears for the common 0-or-1-list case.
export default function PartyListPicker({ questionId, lists, listQuestionIds, onToggleList, onClose }) {
  const panelRef = useRef(null)
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

  async function handleRowClick(listId) {
    setError(null)
    const { error: toggleError } = await onToggleList(listId, questionId)
    if (toggleError) setError(toggleError.message || 'Something went wrong — try again.')
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add to a ?Party list"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          margin: '0 auto',
          background: '#FFFFFF',
          borderRadius: '16px 16px 0 0',
          padding: '1.5rem',
          paddingBottom: '2rem',
          fontFamily: 'Merriweather, serif',
          boxSizing: 'border-box',
          outline: 'none',
        }}
      >
        <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1rem', lineHeight: 1.4 }}>
          Add to which list?
        </div>

        {lists.map(list => {
          const checked = listQuestionIds.get(list.id)?.has(questionId) || false
          const count = listQuestionIds.get(list.id)?.size || 0
          const atCap = count >= 10 && !checked
          return (
            <button
              key={list.id}
              onClick={() => !atCap && handleRowClick(list.id)}
              disabled={atCap}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                textAlign: 'left',
                padding: '12px 0',
                background: 'none',
                border: 'none',
                borderTop: '0.5px solid #E5E7EB',
                fontSize: '14px',
                color: atCap ? '#9CA3AF' : '#1A1A1A',
                cursor: atCap ? 'default' : 'pointer',
                fontFamily: 'Merriweather, serif',
              }}
            >
              {checked ? <IconSquareCheckFilled size={20} color="#7C3AED" /> : <IconSquare size={20} color="#D1D5DB" />}
              <span style={{ flex: 1 }}>{list.name}</span>
              <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{count}/10</span>
            </button>
          )
        })}

        {error && (
          <p style={{ fontSize: '12px', color: '#991B1B', marginTop: '10px', marginBottom: 0 }}>{error}</p>
        )}

        <button
          onClick={onClose}
          style={{
            width: '100%',
            textAlign: 'center',
            padding: '14px 0',
            marginTop: '14px',
            background: '#F3F4F6',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            color: '#6B7280',
            cursor: 'pointer',
            fontFamily: 'Merriweather, serif',
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}
