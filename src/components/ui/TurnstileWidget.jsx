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

    if (window.turnstile) {
      renderWidget()
      return
    }

    const existingScript = document.querySelector(
      'script[src*="challenges.cloudflare.com/turnstile"]'
    )
    if (existingScript) {
      existingScript.addEventListener('load', renderWidget)
      return () => existingScript.removeEventListener('load', renderWidget)
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.defer = true
    script.onload = renderWidget
    document.head.appendChild(script)

    return () => {
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
