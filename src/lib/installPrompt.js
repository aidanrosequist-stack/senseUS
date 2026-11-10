// "Add senseUS to your home screen" support (2026-11-10).
//
// senseUS is installable as a web app (public/manifest.webmanifest): it
// gets its own home-screen icon and opens full-screen, without the app
// stores. This module works out whether to suggest that, and how:
//
// - Android (Chrome, Samsung Internet, Edge): the browser fires
//   `beforeinstallprompt` once the site is installable. We hold on to
//   that event so our own card can open the browser's real install
//   dialog on tap. It can fire very early (even on /login), before the
//   card exists, which is why this listens from app start (main.jsx
//   imports this file) rather than inside the component.
// - iPhone/iPad: Apple gives websites no install API. The card shows
//   instructions instead (Share, then "Add to Home Screen").
// - Facebook/Instagram/TikTok in-app browsers: installing isn't possible
//   there at all, so nothing is suggested.
// - Already installed, or running inside the native Capacitor app (which
//   loads this same site): nothing is suggested either.
//
// Nothing here is sent anywhere. The visit-day count and the "Not now"
// timestamp live only in this browser's localStorage, read and written
// defensively since storage can be unavailable (private mode, etc.).

const DISMISS_KEY = 'senseus-install-dismissed-at'
const DAYS_KEY = 'senseus-install-visit-days'
const DISMISS_DAYS = 30
const MIN_VISIT_DAYS = 2 // never on someone's first day

let deferredPrompt = null
let installed = false
const listeners = new Set()

function notify() {
  listeners.forEach(fn => fn())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Stop Chrome's own small automatic install bar; our card replaces it.
    event.preventDefault()
    deferredPrompt = event
    notify()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferredPrompt = null
    notify()
  })
  recordVisitDay()
}

function readStorage(key) {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeStorage(key, value) {
  try { window.localStorage.setItem(key, value) } catch { /* storage unavailable: fine */ }
}

function recordVisitDay() {
  const today = new Date().toISOString().slice(0, 10)
  let days
  try { days = JSON.parse(readStorage(DAYS_KEY) || '[]') } catch { days = [] }
  if (!Array.isArray(days)) days = []
  if (!days.includes(today)) {
    days = [...days, today].slice(-MIN_VISIT_DAYS)
    writeStorage(DAYS_KEY, JSON.stringify(days))
  }
}

function visitDayCount() {
  try {
    const days = JSON.parse(readStorage(DAYS_KEY) || '[]')
    return Array.isArray(days) ? days.length : 0
  } catch {
    return 0
  }
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.())
}

function isInAppBrowser() {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|Twitter|LinkedInApp/i.test(window.navigator.userAgent)
}

function isIOS() {
  const ua = window.navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
}

function isPhoneSized() {
  return window.matchMedia?.('(max-width: 767px)').matches
}

function recentlyDismissed() {
  const at = Number(readStorage(DISMISS_KEY))
  return Boolean(at) && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
}

// 'android' (a real install button), 'ios' (instructions), or null (don't
// suggest anything).
export function getInstallMode() {
  if (typeof window === 'undefined') return null
  if (installed || isStandalone() || isNativeApp() || isInAppBrowser()) return null
  if (!isPhoneSized() || recentlyDismissed() || visitDayCount() < MIN_VISIT_DAYS) return null
  if (deferredPrompt) return 'android'
  if (isIOS()) return 'ios'
  return null
}

export function subscribeToInstallChanges(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Opens the browser's own install dialog (Android only). Resolves to
// 'accepted' or 'dismissed'. The saved event can only be used once.
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable'
  const event = deferredPrompt
  deferredPrompt = null
  event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'accepted') installed = true
  // Declining the browser's own dialog counts as "Not now" too, so the
  // card doesn't come straight back when the browser re-offers install.
  else writeStorage(DISMISS_KEY, String(Date.now()))
  notify()
  return outcome
}

export function dismissInstallSuggestion() {
  writeStorage(DISMISS_KEY, String(Date.now()))
  notify()
}
