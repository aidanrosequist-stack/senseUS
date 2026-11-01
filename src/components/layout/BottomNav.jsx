import { useLocation, useNavigate } from 'react-router-dom'
import { IconThumbUp, IconBell, IconUser, IconCompass } from '@tabler/icons-react'
import { useNotificationsContext } from '../../context/NotificationsContext'

// Exported for the same reason Header exports HEADER_HEIGHT_PX: AppShell's
// <main> uses this to reserve exactly this nav's real height (padding-
// bottom, 2026-11-01 — the single centralized place this now happens,
// replacing ~21 pages' worth of their own calc()). If you resize this
// nav, update this constant too.
export const BOTTOM_NAV_HEIGHT_PX = 60

export default function BottomNav() {
  const { unreadCount } = useNotificationsContext()
  const navigate = useNavigate()
  const path = useLocation().pathname

  // The unread badge used to sit on Activity (via the bell icon), but
  // Activity is streaks/stats/compare-with-friend — nothing to do with
  // notifications. The actual notifications list lives on /profile, so
  // that's where an unread count should point too.
  const tabs = [
    { label: 'Vote', icon: IconThumbUp, path: '/vote' },
    { label: 'Explore', icon: IconCompass, path: '/explore' },
    { label: 'Activity', icon: IconBell, path: '/activity' },
    { label: 'Profile', icon: IconUser, path: '/profile', badge: unreadCount },
  ]

  return (
    <nav
      aria-label="Primary"
      className="senseus-bottom-nav"
      style={{
        // position/bottom live on .senseus-bottom-nav (index.css) now, not
        // here — see that class's own comment for the full history. Short
        // version: this used to be `sticky` specifically to stay confined
        // to desktop's centered 480px #root column (`fixed` positions
        // against the real viewport, which would've spanned the whole
        // browser window instead). It's `fixed` again on mobile as of
        // 2026-11-01 — sticky plus ever-more-precise dvh/svh viewport-unit
        // math still weren't enough to stop this nav visibly sliding
        // during a phone browser's address-bar collapse/expand animation
        // on scroll (reported twice, 2026-10-29 and 2026-11-01); `fixed`
        // sidesteps that whole class of bug by anchoring to the actual
        // visual viewport edge directly, immune to how tall the document
        // currently computes to. The >=768px media query in that class
        // switches back to `sticky` so desktop keeps the original
        // confined-to-480px-column behavior.
        display: 'flex',
        justifyContent: 'center',
        background: '#FFFFFF',
        borderTop: '0.5px solid #E5E7EB',
        // Matches Header's own light depth treatment (see its comment) so
        // the two pieces of sticky chrome read as one consistent elevation
        // tier, shadow cast upward since this sits at the bottom.
        boxShadow: '0 -1px 4px rgba(0,0,0,0.06)',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          height: `${BOTTOM_NAV_HEIGHT_PX}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          boxSizing: 'border-box',
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = path === tab.path
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.badge > 0 ? `${tab.label}, ${tab.badge} unread` : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '3px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '8px 20px',
                color: active ? '#2D3DCA' : '#6B7280',
                position: 'relative',
              }}
            >
              <Icon size={22} />
              {tab.badge > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '4px',
                  right: '12px',
                  background: '#c21f1f',
                  color: 'white',
                  borderRadius: '50%',
                  width: '16px',
                  height: '16px',
                  fontSize: '10px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {tab.badge > 9 ? '9+' : tab.badge}
                </div>
              )}
              <span style={{ fontSize: '10px', fontWeight: active ? 700 : 400, fontFamily: 'Merriweather, serif' }}>
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}