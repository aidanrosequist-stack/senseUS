import { useLocation, useNavigate } from 'react-router-dom'
import { IconThumbUp, IconBell, IconUser, IconCompass } from '@tabler/icons-react'
import { useNotificationsContext } from '../../context/NotificationsContext'

export default function BottomNav() {
  const { unreadCount } = useNotificationsContext()
  const navigate = useNavigate()
  const path = useLocation().pathname

  const tabs = [
    { label: 'Vote', icon: IconThumbUp, path: '/vote' },
    { label: 'Explore', icon: IconCompass, path: '/explore' },
    { label: 'Activity', icon: IconBell, path: '/activity', badge: unreadCount },
    { label: 'Profile', icon: IconUser, path: '/profile' },
  ]

  return (
    <nav
      aria-label="Primary"
      style={{
        // `sticky`, not `fixed` — this is the fix for the footer spanning
        // the full browser window while the header doesn't. On desktop,
        // index.css caps #root at 480px and centers it on a gray backdrop;
        // Header lives inside that box and is `position: sticky`, so it's
        // naturally confined to it. `fixed` positions relative to the
        // actual viewport, not #root, so it was escaping that 480px column
        // and spanning the whole window. `sticky` stays inside the normal
        // document flow (and therefore inside #root) while still pinning
        // to the bottom of the screen as you scroll.
        position: 'sticky',
        bottom: 0,
        display: 'flex',
        justifyContent: 'center',
        background: '#FFFFFF',
        borderTop: '0.5px solid #E5E7EB',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          height: '60px',
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