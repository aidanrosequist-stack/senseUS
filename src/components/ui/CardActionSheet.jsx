import { useEffect, useRef } from 'react'

// A shared bottom-sheet menu, opened by long-pressing a card anywhere in
// the app. Each surface passes in its own list of relevant actions —
// Explore/Shifts might offer Share + View, Comments offers two separate
// share options, History/Revisit add Change vote — rather than this
// component assuming a fixed set of buttons every time.
//
// actions: [{ label: string, onClick: () => void, danger?: boolean }]
export default function CardActionSheet({ title, actions, onClose }) {
  const panelRef = useRef(null)

  // Focus management: move focus into the sheet when it opens (nothing
  // did before, so a keyboard/screen-reader user got no indication
  // anything had changed), close on Escape same as the backdrop click
  // already does, and hand focus back to whatever triggered this sheet
  // when it closes rather than leaving it lost.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount/unmount only, same as any modal-open effect; onClose is stable enough here and re-running this on every parent re-render would refocus the panel unexpectedly
  }, [])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Actions'}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          // The scrim itself is meant to dim the full browser window —
          // that's normal modal behavior even inside a centered-column
          // layout. But this panel's own width: 100% was measured
          // against that same full-viewport fixed parent, so on desktop
          // it stretched edge-to-edge instead of matching the app's
          // 480px column like every other surface. Capping it here
          // (same width/centering #root already applies at ≥768px)
          // keeps the sheet itself confined to the app card without
          // changing the scrim's fixed, scroll-independent positioning.
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
        {title && (
          <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1rem', lineHeight: 1.4 }}>
            {title}
          </div>
        )}
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={() => { action.onClick(); onClose() }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '14px 0',
              background: 'none',
              border: 'none',
              borderTop: '0.5px solid #E5E7EB',
              fontSize: '14px',
              color: action.danger ? '#7a1313' : '#1A1A1A',
              cursor: 'pointer',
              fontFamily: 'Merriweather, serif',
            }}
          >
            {action.label}
          </button>
        ))}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            textAlign: 'center',
            padding: '14px 0',
            marginTop: '8px',
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
          Cancel
        </button>
      </div>
    </div>
  )
}
