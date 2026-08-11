import { useRef, useCallback } from 'react'

// A shared long-press gesture, usable on any card across the app —
// Explore thumbnails, Shifts, Comments, Revisit, History, etc.
// Works for both touch and mouse, so it behaves the same on the native
// app wrapper, mobile web, and desktop.
export function useLongPress(onLongPress, ms = 500) {
  const timerRef = useRef(null)
  const triggeredRef = useRef(false)

  const start = useCallback((e) => {
    triggeredRef.current = false
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true
      onLongPress(e)
    }, ms)
  }, [onLongPress, ms])

  const clear = useCallback(() => {
    clearTimeout(timerRef.current)
  }, [])

  // wasLongPress() lets the card's own onClick check whether this
  // press was already handled as a long-press, so a normal tap can
  // still do its usual thing (like navigating) without also firing
  // right after the action sheet opens.
  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: clear,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    wasLongPress: () => triggeredRef.current,
  }
}
