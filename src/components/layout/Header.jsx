// The one shared header for every logged-in app page. Rendered once by
// AppShell — do not import/render this directly from individual pages,
// or it goes back to remounting on every navigation.
//
// Deliberately takes no props: it's rendered exactly once, by AppShell,
// not per-page — so there's no page instance around to hand it page-
// specific content anyway. Anything a single page needs (e.g. Profile's
// settings link) belongs in that page's own body, not bolted onto shared
// chrome. If several pages end up wanting the same control, that's worth
// a real conversation about whether it belongs in the header — not a
// reason to sneak it in as a prop nobody can actually wire up cleanly.
//
// Height is pinned explicitly (rather than left to intrinsic sizing) so
// pages that need to fit exactly one viewport — Vote's swipe-card screen,
// specifically — can subtract a known, exported number instead of a
// hardcoded guess. If you resize the logo or padding here, update this
// constant too.
export const HEADER_HEIGHT_PX = 58

export default function Header() {
  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 40,
      width: '100%',
      height: `${HEADER_HEIGHT_PX}px`,
      background: '#FFFFFF',
      borderBottom: '0.5px solid #E5E7EB',
      display: 'flex',
      justifyContent: 'center',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        padding: '1px 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxSizing: 'border-box',
      }}>
        <img
          src="/senseUS-logo.png"
          alt="senseUS"
          style={{ height: '50px', width: 'auto' }}
        />
        <div style={{ fontFamily: 'Merriweather, serif', flex: 1 }}>
          <div style={{ fontSize: '18px', fontWeight: 400, color: '#1A1A1A', lineHeight: 1 }}>
            sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
          </div>
          <div style={{ fontSize: '10px', color: '#6B7280', letterSpacing: '0.03em', marginTop: '2px' }}>
            THE societal media platform
          </div>
        </div>
      </div>
    </div>
  )
}
