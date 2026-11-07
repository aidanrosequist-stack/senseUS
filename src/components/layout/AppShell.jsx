import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Header, { HEADER_HEIGHT_PX } from './Header'
import BottomNav, { BOTTOM_NAV_HEIGHT_PX } from './BottomNav'

// Shared chrome for every logged-in app page (Vote, Explore, Activity,
// Profile, Conversation, Compare, MakeUpMyMind, Notifications).
//
// This is the fix for the header/footer remounting on every navigation:
// previously each page imported and rendered its own <Header />/<BottomNav />,
// so React Router tore both down and rebuilt them on every single route
// change (the OLD position: fixed on BottomNav just made that invisible —
// it still happened underneath; the remount was the actual bug, not
// `fixed` itself — worth saying plainly since BottomNav is `fixed` again
// below, for an unrelated reason, now that this component already fixes
// the remount). Because this component sits on a *parent* route with an
// <Outlet /> for the page content, React Router keeps it mounted across
// navigation between any of the child routes below — only the outlet's
// content swaps. Header and BottomNav are each created once per app
// session, not once per click.
//
// <main>'s own padding is the single, centralized place every page's
// available height comes from on MOBILE (2026-11-01, replacing ~21
// occurrences of the same calc() duplicated across 10 page files — see
// each page's own comment at its outer div). It reserves exactly
// Header's and BottomNav's real heights, and height:100svh +
// box-sizing:border-box means those two paddings are subtracted FROM
// 100svh rather than added on top of it, so a page's own `height: '100%'`
// lands on exactly the visible space between them. This is also what
// makes Header/BottomNav using `position: fixed` safe there: fixed
// elements reserve no flow space at all, so without this padding a
// fixed header/footer would simply overlap page content instead of
// sitting above/below it.
//
// UPDATED 2026-11-02: the `senseus-app-main` class (index.css) makes
// THIS element the actual scroll container on mobile now, not the
// document. A page whose content needs more room than this still grows
// past it (this height is a floor via each page's own `minHeight: '100%'`
// or `height: '100%'`, not a hard clip) but now scrolls inside this
// box's own overflow instead of scrolling the whole page. See
// index.css's html/body comment for why: a mobile browser's address-bar
// collapse/expand is tied to the document itself scrolling, and that's
// what kept making the fixed header/footer visibly resettle mid-gesture
// (reported three times) no matter how exactly `fixed`/viewport-unit
// math was tuned — removing the document-level scroll removes the
// trigger, not just the symptom.
//
// UPDATED AGAIN 2026-11-02 (Aidan: "I can't scroll in /admin"): the
// html/body `overflow: hidden` that makes the trick above work was
// written directly onto a bare `html, body` selector in index.css back
// on 2026-11-01 — which locks EVERY route's document scroll on mobile,
// not just the ten under this shell. /admin (and every other route
// outside this shell — /login, /register, the static marketing pages,
// /q/:number) has no `senseus-app-main`-style scroll container of its
// own, so with the real document locked and nothing else to scroll
// inside, mobile Admin simply couldn't scroll at all once that rule
// shipped. Fixed by scoping the lock to a class (`senseus-shell-mobile`)
// this component now toggles on <html> and <body> itself, only while a
// page under this shell is actually mounted — see index.css's own
// updated comment on that selector for the other half of this fix.
//
// Vote is the one exception: its swipeable card deliberately wants a
// real, non-scrolling, exactly-one-viewport box at every breakpoint, not
// auto growth — `senseus-app-main--fixed` (index.css) gives it that with
// a different formula appropriate to sticky (not fixed) chrome.
export default function AppShell() {
  useEffect(() => {
    document.documentElement.classList.add('senseus-shell-mobile')
    document.body.classList.add('senseus-shell-mobile')
    return () => {
      document.documentElement.classList.remove('senseus-shell-mobile')
      document.body.classList.remove('senseus-shell-mobile')
    }
  }, [])

  // Keyed on path rather than, say, a per-route config object passed
  // down from App.jsx, because this is the only page under this shell
  // that needs it — not worth a bigger mechanism for one exception.
  const isFixedHeightPage = useLocation().pathname === '/vote'

  return (
    <>
      <Header />
      <main
        className={`senseus-app-main${isFixedHeightPage ? ' senseus-app-main--fixed' : ''}`}
        style={{
          // Bridged in as custom properties, not used directly here, so
          // index.css's >=768px media query can still reach them — see
          // that file's own comment on .senseus-app-main for the bug this
          // fixes. Single source of truth stays Header's/BottomNav's own
          // exported HEIGHT_PX constants; nothing here hardcodes a number.
          '--header-height': `${HEADER_HEIGHT_PX}px`,
          '--bottom-nav-height': `${BOTTOM_NAV_HEIGHT_PX}px`,
        }}
      >
        <Outlet />
      </main>
      <BottomNav />
    </>
  )
}
