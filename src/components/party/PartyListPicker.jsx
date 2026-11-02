import { useEffect, useRef, useState } from 'react'
import { IconSquare, IconSquareCheckFilled, IconPlus } from '@tabler/icons-react'

// Same visual shell as CardActionSheet (backdrop, bottom sheet, focus
// trap, Escape-to-close) but a checklist instead of one-shot actions —
// usePartyLists.smartToggle() opens this only once a question's "add to
// ?Party list" target is genuinely ambiguous (the caller has 2+ lists),
// so this never appears for the common 0-or-1-list case.
//
// Per Aidan (2026-11-02): someone who's already past the 0-or-1-list
// fast path might still want a THIRD list for this specific question,
// not one of the existing ones -- previously the only way to do that was
// to back out, go create it in Activity's ?Party tab, then come back and
// reopen this picker. onCreateList closes that loop: it creates the list
// AND adds the current question to it in one step (the caller composes
// usePartyLists' createList + addToList, same as onToggleList already
// composes addToList/removeFromList) -- the new list then shows up
// checked automatically once lists/listQuestionIds re-render with it.
export default function PartyListPicker({ questionId, lists, listQuestionIds, onToggleList, onCreateList, onClose }) {
  const panelRef = useRef(null)
  const [error, setError] = useState(null)
  const [creatingList, setCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [creating, setCreating] = useState(false)

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

  async function handleCreateList() {
    const name = newListName.trim()
    if (!name) {
      setCreatingList(false)
      return
    }

    setError(null)
    setCreating(true)
    const { error: createError } = await onCreateList(name)
    setCreating(false)

    if (createError) {
      setError(createError.message || 'Something went wrong — try again.')
      return
    }

    setNewListName('')
    setCreatingList(false)
  }

  const anySelected = lists.some(list => listQuestionIds.get(list.id)?.has(questionId))

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

        {creatingList ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0', borderTop: '0.5px solid #E5E7EB' }}>
            <input
              autoFocus
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateList()
                if (e.key === 'Escape') { setCreatingList(false); setNewListName('') }
              }}
              placeholder="List name"
              disabled={creating}
              style={{ flex: 1, fontSize: '14px', color: '#1A1A1A', fontFamily: 'Merriweather, serif', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '8px 10px' }}
            />
            <button
              onClick={handleCreateList}
              disabled={creating}
              style={{ padding: '8px 14px', background: '#2D3DCA', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: creating ? 'default' : 'pointer', fontFamily: 'Merriweather, serif', opacity: creating ? 0.6 : 1 }}
            >
              Add
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingList(true)}
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
              fontWeight: 500,
              color: '#2D3DCA',
              cursor: 'pointer',
              fontFamily: 'Merriweather, serif',
            }}
          >
            <IconPlus size={20} color="#2D3DCA" />
            New list
          </button>
        )}

        {error && (
          <p style={{ fontSize: '12px', color: '#991B1B', marginTop: '10px', marginBottom: 0 }}>{error}</p>
        )}

        {/* Per Aidan's testing feedback (2026-11-02): this button was
            always styled grey regardless of state -- it was never
            actually disabled (it always closes the sheet), but looking
            inert after picking a list read as broken. Now flips to the
            same blue used for every other primary action once at least
            one list has this question, so its look matches what tapping
            it actually does. */}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            textAlign: 'center',
            padding: '14px 0',
            marginTop: '14px',
            background: anySelected ? '#2D3DCA' : '#F3F4F6',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            color: anySelected ? '#FFFFFF' : '#6B7280',
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
