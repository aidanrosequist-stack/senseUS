import { Outlet } from 'react-router-dom'
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
// available height comes from (2026-11-01, replacing ~21 occurrences of
// the same calc() duplicated across 10 page files — see each page's own
// comment at its outer div). It reserves exactly Header's and
// BottomNav's real heights, and height:100svh + box-sizing:border-box
// means those two paddings are subtracted FROM 100svh rather than added
// on top of it, so a page's own `height: '100%'` lands on exactly the
// visible space between them. This is also what makes Header/BottomNav
// using `position: fixed` safe: previously their height came out of
// normal document flow (via `sticky`, which still occupies its own
// space even while pinned), and every page separately did its own
// subtraction to match; fixed elements reserve no flow space at all, so
// without this padding a fixed header/footer would simply overlap page
// content instead of sitting above/below it.
//
// UPDATED 2026-11-02: the `senseus-app-main` class (index.css) makes
// THIS element the actual scroll container on mobile now, not the
// document — html/body are overflow:hidden there. A page whose content
// needs more room than this still grows past it (this height is a floor
// via each page's own `minHeight: '100%'` or `height: '100%'`, not a
// hard clip) but now scrolls inside this box's own overflow instead of
// scrolling the whole page. See index.css's html/body comment for why:
// a mobile browser's address-bar collapse/expand is tied to the
// document itself scrolling, and that's what kept making the fixed
// header/footer visibly resettle mid-gesture (reported three times) no
// matter how exactly `fixed`/viewport-unit math was tuned — removing
// the document-level scroll removes the trigger, not just the symptom.
// Reset to a plain non-scrolling block at >=768px (same class, media
// query in index.css) — desktop's whole centered column still scrolls
// together as one, exactly as before.
export default function AppShell() {
  return (
    <>
      <Header />
      <main
        className="senseus-app-main"
        style={{
          height: '100svh',
          boxSizing: 'border-box',
          paddingTop: `${HEADER_HEIGHT_PX}px`,
          paddingBottom: `${BOTTOM_NAV_HEIGHT_PX}px`,
        }}
      >
        <Outlet />
      </main>
      <BottomNav />
    </>
  )
}
