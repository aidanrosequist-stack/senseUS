import { useNavigate } from 'react-router-dom'

const BADGE_INFO = {
  'ultra-definitive': { emoji: '🎯', label: 'Ultra-Definitive' },
  'decisive-streak': { emoji: '🔥', label: 'Decisive Streak' },
  'super-decisive-streak': { emoji: '⚡', label: 'Super Decisive Streak' },
}

export default function NotificationPopup({ urgentNotification, highNotifications, onDismissUrgent, onDismissHigh }) {
  const navigate = useNavigate()

  function handleAction(notification, dismiss) {
    dismiss(notification.id)
    if (notification.action_url) navigate(notification.action_url)
  }

  // Urgent takes priority — show as full screen overlay
  if (urgentNotification) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '1.5rem', boxSizing: 'border-box',
        fontFamily: 'Merriweather, serif',
      }}>
        <div style={{
          background: '#FFFFFF', borderRadius: '16px', padding: '1.75rem',
          maxWidth: '380px', width: '100%', border: '2px solid #c21f1f',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
          <div style={{ fontSize: '28px', textAlign: 'center', marginBottom: '0.75rem' }}>🚨</div>
          <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#c21f1f', textAlign: 'center', marginBottom: '0.75rem' }}>
            {urgentNotification.title}
          </h2>
          <p style={{ fontSize: '14px', color: '#374151', lineHeight: 1.7, textAlign: 'center', marginBottom: '1.5rem' }}>
            {urgentNotification.body}
          </p>
          <button
            onClick={() => handleAction(urgentNotification, onDismissUrgent)}
            style={{
              width: '100%', padding: '12px', background: '#c21f1f', color: 'white',
              border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
              cursor: 'pointer', fontFamily: 'Merriweather, serif',
            }}
          >
            I understand
          </button>
        </div>
      </div>
    )
  }

  // High priority — show as a stack of toast cards at the bottom
  if (highNotifications.length > 0) {
    const notification = highNotifications[0]
    const isBadge = notification.type === 'badge_earned'
    const badgeKey = notification.action_url?.split('/').pop()
    const badgeInfo = BADGE_INFO[badgeKey] || { emoji: '🏆', label: 'Badge Earned' }

    return (
      <div style={{
        position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
        width: 'calc(100% - 3rem)', maxWidth: '420px',
        zIndex: 999, fontFamily: 'Merriweather, serif',
      }}>
        <div style={{
          background: '#FFFFFF', borderRadius: '14px', padding: '1.25rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '1px solid #2D3DCA',
          display: 'flex', gap: '12px', alignItems: 'flex-start',
        }}>
          <div style={{ fontSize: '28px', flexShrink: 0 }}>
            {isBadge ? badgeInfo.emoji : '⭐'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '4px' }}>
              {notification.title}
            </div>
            <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5, marginBottom: '10px' }}>
              {notification.body}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {notification.action_url && (
                <button
                  onClick={() => handleAction(notification, onDismissHigh)}
                  style={{
                    flex: 1, padding: '7px', background: '#2D3DCA', color: 'white',
                    border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'Merriweather, serif',
                  }}
                >
                  View
                </button>
              )}
              <button
                onClick={() => onDismissHigh(notification.id)}
                style={{
                  flex: 1, padding: '7px', background: '#F3F4F6', color: '#6B7280',
                  border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'Merriweather, serif',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
        {highNotifications.length > 1 && (
          <div style={{ textAlign: 'center', fontSize: '11px', color: '#6B7280', marginTop: '6px' }}>
            +{highNotifications.length - 1} more notification{highNotifications.length - 1 !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    )
  }

  return null
}