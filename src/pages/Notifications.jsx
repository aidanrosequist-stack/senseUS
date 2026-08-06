import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../hooks/useNotifications'
import BottomNav from '../components/layout/BottomNav'

const TYPE_ICONS = {
  badge_earned: '🏆',
  new_tracking_question: '📊',
  system_message: '💬',
  milestone: '🎯',
  admin_broadcast: '📣',
  welcome: '👋',
  urgent: '🚨',
}

function timeAgo(dateString) {
  const now = new Date()
  const date = new Date(dateString)
  const diff = Math.floor((now - date) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function Notifications() {
  const navigate = useNavigate()
  const { notifications, unreadCount, markAsRead, markAllAsRead, loading } = useNotifications()

  function handleNotificationClick(notification) {
    if (!notification.read) markAsRead(notification.id)
    if (notification.action_url) navigate(notification.action_url)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', minHeight: '100dvh', paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
          sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
        </div>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A' }}>Notifications</div>
        <div style={{ width: '60px' }} />
      </div>

      {unreadCount > 0 && (
        <button
          onClick={markAllAsRead}
          style={{ fontSize: '12px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', marginBottom: '1rem', padding: 0 }}
        >
          Mark all as read ({unreadCount})
        </button>
      )}

      {notifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#6B7280', fontSize: '14px' }}>
          No notifications yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {notifications.map(notification => (
            <div
              key={notification.id}
              onClick={() => handleNotificationClick(notification)}
              style={{
                background: notification.read ? '#FFFFFF' : '#F0F3FF',
                border: notification.priority === 'urgent'
                  ? '1px solid #c21f1f'
                  : notification.priority === 'high'
                  ? '1px solid #2D3DCA'
                  : '0.5px solid #E5E7EB',
                borderRadius: '10px',
                padding: '12px 14px',
                cursor: notification.action_url ? 'pointer' : 'default',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
              }}
            >
              <div style={{ fontSize: '20px', flexShrink: 0 }}>
                {TYPE_ICONS[notification.type] || '💬'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                    {notification.title}
                  </div>
                  {!notification.read && (
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2D3DCA', flexShrink: 0, marginTop: '4px' }} />
                  )}
                </div>
                <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5, marginBottom: '4px' }}>
                  {notification.body}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                  {timeAgo(notification.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <BottomNav />
    </div>
  )
}