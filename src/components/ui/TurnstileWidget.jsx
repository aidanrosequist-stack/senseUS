import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'

// Reusable Cloudflare Turnstile widget. Managed mode runs invisibly in the
// background in the vast majority of cases — it only ever surfaces a
// simple checkbox (never image puzzles) on the rare request it can't
// verify automatically.
//
// Usage:
//   const turnstileRef = useRef(null)
//   const [token, setToken] = useState(null)
//   <TurnstileWidget
//     ref={turnstileRef}
//     siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
//     onVerify={setToken}
//     onExpire={() => setToken(null)}
//   />
//   // after a failed submit, reset so the person gets a fresh token:
//   turnstileRef.current?.reset()

const TurnstileWidget = forwardRef(function TurnstileWidget(
  { siteKey, onVerify, onExpire, onError },
  ref
) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
      }
    },
  }))

  useEffect(() => {
    if (!siteKey) return

    function renderWidget() {
      if (containerRef.current && window.turnstile && widgetIdRef.current === null) {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onVerify,
          'expired-callback': onExpire,
          'error-callback': onError,
        })
      }
    }

    // Three branches load the widget differently (script already ready,
    // script tag already loading, script not yet requested), but every
    // branch needs the same teardown: remove any widget this effect
    // actually registered, and stop listening for a load event we might
    // not get to handle before unmount. Previously only two of the three
    // branches returned a cleanup at all, so the `if (window.turnstile)`
    // branch — which is what runs on every remount after the very first
    // one anywhere in the app's lifetime — leaked a widget registration
    // each time (Login/Register visited more than once per session).
    let existingScript = null

    if (window.turnstile) {
      renderWidget()
    } else {
      existingScript = document.querySelector(
        'script[src*="challenges.cloudflare.com/turnstile"]'
      )
      if (existingScript) {
        existingScript.addEventListener('load', renderWidget)
      } else {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        script.async = true
        script.defer = true
        script.onload = renderWidget
        document.head.appendChild(script)
      }
    }

    return () => {
      if (existingScript) {
        existingScript.removeEventListener('load', renderWidget)
      }
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  if (!siteKey) return null

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}
    />
  )
})

export default TurnstileWidget
