import { useEffect, useRef } from 'react'

// Shared focus-management for the app's inline info modals (Profile's
// Resonance/Integrity popups, and anywhere else that opens a
// backdrop+panel like this). None of them moved focus into the panel on
// open, closed on Escape, or returned focus to whatever opened them —
// this fixes all three in one place. Pass the modal's own `open` boolean
// and its close handler; returns a ref to attach to the panel element
// (which should also get tabIndex={-1} so it's programmatically
// focusable without joining the normal Tab order).
export function useModalFocus(open, onClose) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `open` should re-trigger this; onClose is a fresh closure each render but re-running on that would refocus the panel unexpectedly
  }, [open])

  return panelRef
}
