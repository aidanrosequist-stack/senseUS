import { useRef, useCallback } from 'react'

// Spread onto any element that also spreads useLongPress()'s handlers —
// without this, holding a finger down long enough to trigger the
// long-press often also triggers the platform's native text-selection
// (a blue highlight on Android/desktop, the copy/select/lookup callout
// on iOS) on whatever text is under the touch point, since a long-press
// is exactly the gesture browsers use for that too. The two behaviors
// compete and the native one is confusing here — it pops up general
// text tools on a card whose long-press is meant to open a completely
// different, card-specific action menu. This suppresses ONLY that
// automatic selection/callout; the action sheet itself still opens
// normally.
export const LONG_PRESS_NO_SELECT = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  MozUserSelect: 'none',
  WebkitTouchCallout: 'none',
}

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
