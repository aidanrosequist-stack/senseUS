import { useLocation, useNavigate } from 'react-router-dom'
import { IconCards, IconBell, IconUser } from '@tabler/icons-react'

export default function BottomNav() {
  const location = useNavigate()
  const navigate = useNavigate()
  const path = useLocation().pathname

  const tabs = [
    { label: 'Cards', icon: IconCards, path: '/vote' },
    { label: 'Activity', icon: IconBell, path: '/activity' },
    { label: 'Profile', icon: IconUser, path: '/profile' },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '60px',
        background: '#FFFFFF',
        borderTop: '0.5px solid #E5E7EB',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 100,
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
            }}
          >
            <Icon size={22} />
            <span style={{ fontSize: '10px', fontWeight: active ? 700 : 400, fontFamily: 'Merriweather, serif' }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}