import { useState, useEffect } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Skeleton, SkeletonCard, SkeletonStatGrid } from '../components/ui/Skeleton'
import { useNotificationsContext } from '../context/NotificationsContext'
import { BADGE_INFO } from '../lib/badgeInfo'
import { useModalFocus } from '../hooks/useModalFocus'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { HEADER_HEIGHT_PX } from '../components/layout/Header'
import { BOTTOM_NAV_HEIGHT_PX } from '../components/layout/BottomNav'

function timeAgo(dateString) {
  const now = new Date()
  const date = new Date(dateString)
  const diff = Math.floor((now - date) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Ported over from the standalone /notifications page, which is going
// away — nothing in the app ever linked to it, so its nicer notification
// card (type icon, relative timestamp, click-to-navigate) was built but
// never actually seen by anyone. This is the one place notifications are
// shown now, so it inherits that behavior instead.
const NOTIFICATION_TYPE_ICONS = {
  badge_earned: '🏆',
  new_tracking_question: '📊',
  system_message: '💬',
  milestone: '🎯',
  admin_broadcast: '📣',
  welcome: '👋',
  urgent: '🚨',
}

export default function Profile() {
  usePageTitle('Your Profile')
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const [showResonanceInfo, setShowResonanceInfo] = useState(false)
  const [showIntegrityInfo, setShowIntegrityInfo] = useState(false)
  const [integrityStatus, setIntegrityStatus] = useState(null)
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification } = useNotificationsContext()
  const [notifError, setNotifError] = useState(null)
  // "Where do badges go?" explainer, same tap-to-read pattern as the
  // Resonance/Integrity stat cards above — always available, not a
  // one-time thing, so it's still there whenever someone actually
  // wonders about it, not just on their first visit.
  const [showBadgesInfo, setShowBadgesInfo] = useState(false)
  // One-time dismissible pointer at the settings gear, same lightweight
  // pattern as Explore's long-press tip (senseus_seen_longpress_hint_explore)
  // — the gear is a small unlabeled icon tucked into the identity row with
  // nothing else calling it out, easy to miss on a first visit.
  const [showSettingsHint, setShowSettingsHint] = useState(
    localStorage.getItem('senseus_seen_settings_hint_profile') !== 'true'
  )

  function handleNotificationClick(notification) {
    if (!notification.read) markAsRead(notification.id)
    if (notification.action_url) navigate(notification.action_url)
  }

  async function handleMarkAllAsRead() {
    setNotifError(null)
    try {
      await markAllAsRead()
    } catch (err) {
      // markAllAsRead() previously swallowed its own write error and
      // fell through to an optimistic UI update regardless, which is
      // exactly why clicking this used to look like it did nothing —
      // there was no path for a failure to ever become visible here.
      console.error('Mark all as read failed:', err)
      setNotifError('Could not mark notifications as read. Please try again.')
    }
  }
  const resonancePanelRef = useModalFocus(showResonanceInfo, () => setShowResonanceInfo(false))
  const integrityPanelRef = useModalFocus(showIntegrityInfo, () => setShowIntegrityInfo(false))
  const badgesPanelRef = useModalFocus(showBadgesInfo, () => setShowBadgesInfo(false))

async function openIntegrityInfo() {
    setShowIntegrityInfo(true)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const [{ count: voteCount }, { count: commentCount }] = await Promise.all([
      supabase.from('votes').select('*', { count: 'exact', head: true }).eq('user_id', profile.id).gte('updated_at', thirtyDaysAgo),
      supabase.from('comments').select('*', { count: 'exact', head: true }).eq('user_id', profile.id).eq('is_deleted', false).gte('created_at', thirtyDaysAgo),
    ])

    setIntegrityStatus({
      voteStarted: (voteCount || 0) >= 10,
      voteMaxed: (voteCount || 0) >= 50,
      commentStarted: (commentCount || 0) >= 5,
      commentMaxed: (commentCount || 0) >= 10,
      consistent: (profile.streak_days || 0) >= 7,
    })
  }

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
          setError('Not logged in')
          setLoading(false)
          return
        }

        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (profileError) throw profileError
        setProfile(profileData)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [])

  function getDisplayName(p) {
    if (!p) return ''
    if (p.display_preference === 'anon') return p.anon_name || 'Anonymous'
    if (p.display_preference === 'first_only') return p.first_name
    return `${p.first_name} ${p.last_initial}.`
  }

  function getMemberSince(p) {
    if (!p?.created_at) return ''
    const date = new Date(p.created_at)
    return `Member since ${date.toLocaleString('default', { month: 'long', year: 'numeric' })}`
  }

  if (loading) {
    return (
      <div style={{ minHeight: `calc(100dvh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`, boxSizing: 'border-box', background: '#C7C7CC', paddingBottom: '80px' }}>
        <div style={{ padding: '14px', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: '420px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: 'var(--senseus-card-radius)', boxShadow: 'var(--senseus-card-shadow)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
              <Skeleton width="48px" height="48px" borderRadius="50%" />
              <div style={{ flex: 1 }}>
                <Skeleton height="16px" width="50%" style={{ marginBottom: '6px' }} />
                <Skeleton height="12px" width="35%" />
              </div>
            </div>
            <SkeletonStatGrid />
            <Skeleton height="14px" width="30%" style={{ marginBottom: '10px' }} />
            <SkeletonCard style={{ marginBottom: '8px' }} />
            <SkeletonCard style={{ marginBottom: '8px' }} />
            <SkeletonCard />
          </div>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div style={{ minHeight: `calc(100dvh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`, boxSizing: 'border-box', background: '#C7C7CC' }}>
        <div style={{ padding: '14px', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: '420px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: 'var(--senseus-card-radius)', boxShadow: 'var(--senseus-card-shadow)' }}>
            <p style={{ color: '#7a1313', fontSize: '14px' }}>{error || 'Profile not found.'}</p>
            <Link to="/" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none' }}>← back to home</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: `calc(100dvh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`, boxSizing: 'border-box', background: '#C7C7CC', paddingBottom: '80px' }}>
    <div style={{ padding: '14px', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: 'var(--senseus-card-radius)', boxShadow: 'var(--senseus-card-shadow)', animation: 'senseus-content-in 0.35s ease' }}>

      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>
            {profile.avatar || '🌿'}
          </div>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{getDisplayName(profile)}</h1>
            <div style={{ fontSize: '12px', color: '#6B7280', fontWeight: 300 }}>{getMemberSince(profile)}</div>
          </div>
        </div>
        <Link to="/settings" style={{ color: '#6B7280', textDecoration: 'none', flexShrink: 0 }} aria-label="Settings">
          <span style={{ fontSize: '20px' }}>⚙</span>
        </Link>
      </div>

      {/* One-time pointer at the gear above — same dismissible-banner
          pattern as Explore's long-press tip. Placed right below the
          identity row it's pointing at, not up top with the page title,
          so the "here" of "tap the ⚙ up here" is unambiguous. */}
      {showSettingsHint && (
        <div style={{ marginBottom: '1.5rem', background: '#E6F1FB', border: '1px solid #0C447C', borderRadius: '10px', padding: '10px 14px', fontSize: '12px', color: '#0C447C', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <span>Tip: tap ⚙ above for your display name, avatar, phone, and notification settings.</span>
          <button
            onClick={() => {
              localStorage.setItem('senseus_seen_settings_hint_profile', 'true')
              setShowSettingsHint(false)
            }}
            aria-label="Dismiss tip"
            style={{ background: 'none', border: 'none', color: '#0C447C', fontSize: '16px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

{/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', marginBottom: '1.5rem' }}>
        <button
          type="button"
          onClick={() => setShowResonanceInfo(true)}
          style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center', cursor: 'pointer', border: 'none', width: '100%', fontFamily: 'inherit' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Resonance score ⓘ</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A1A1A' }}>{profile.resonance_score}</div>
          <div style={{ fontSize: '11px', color: '#2D3DCA', marginTop: '4px' }}>{profile.resonance_tier}</div>
        </button>
        <div style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Answered</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A1A1A' }}>{profile.answers_count}</div>
          <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px', fontWeight: 300 }}>questions</div>
        </div>
        <div style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Current streak</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: profile.streak_days >= 7 ? '#c2731f' : '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            {profile.streak_days}
            {/* A flicker on the flame once there's a real streak going —
                previously this number looked identical to "Answered" and
                "Integrity weight" next to it, with nothing to signal that
                the on-a-roll/unstoppable/constant-as-the-sun badges (7/30/
                100-day streaks) are even a thing to build toward. */}
            {profile.streak_days > 0 && (
              <span
                aria-hidden="true"
                style={{ fontSize: '18px', display: 'inline-block', animation: 'senseus-streak-flicker 1.6s ease-in-out infinite' }}
              >
                🔥
              </span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px', fontWeight: 300 }}>days</div>
        </div>
        <button
          type="button"
          onClick={openIntegrityInfo}
          style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center', cursor: 'pointer', border: 'none', width: '100%', fontFamily: 'inherit' }}
        >
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Integrity weight ⓘ</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A1A1A' }}>{profile.integrity_weight?.toFixed(4)}</div>
        </button>
      </div>

{/* Badges widget */}
<div style={{ marginBottom: '1.5rem' }}>
  <button
    type="button"
    onClick={() => setShowBadgesInfo(true)}
    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', padding: 0, marginBottom: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
  >
    <span style={{ fontSize: '14px', fontWeight: 700, color: '#1A1A1A' }}>Badges</span>
    <span style={{ fontSize: '12px', color: '#6B7280' }} aria-hidden="true">ⓘ</span>
  </button>
  {(profile?.badges || []).length === 0 ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '1.25rem 1rem', border: '1.5px dashed #D1D5DB', borderRadius: '10px' }}>
      <span style={{ fontSize: '26px' }} aria-hidden="true">🏅</span>
      <span style={{ fontSize: '12px', color: '#6B7280', textAlign: 'center' }}>Keep voting to earn your first badge.</span>
    </div>
  ) : (
    <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
      {(profile?.badges || []).map(badge => {
        const info = BADGE_INFO[badge] || { label: badge, emoji: '🏅' }
        return (
          <div
            key={badge}
            title={info.label}
            style={{ flexShrink: 0, width: '64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
          >
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>
              {info.emoji}
            </div>
            <div style={{ fontSize: '10px', color: '#6B7280', textAlign: 'center', lineHeight: 1.2 }}>
              {info.label}
            </div>
          </div>
        )
      })}
    </div>
  )}
</div>

{/* Notifications */}
<div style={{ marginTop: '1.5rem' }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
    <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A1A1A' }}>Notifications</div>
    {notifications.length > 0 && (
      <button
        onClick={handleMarkAllAsRead}
        style={{ fontSize: '12px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', padding: 0 }}
      >
        Mark all as read{unreadCount > 0 ? ` (${unreadCount})` : ''}
      </button>
    )}
  </div>
  {notifError && (
    <div style={{ fontSize: '12px', color: '#7a1313', background: '#f9d8d8', borderRadius: '8px', padding: '8px 12px', marginBottom: '0.75rem' }}>
      {notifError}
    </div>
  )}
  {notifications.length === 0 ? (
    <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '14px' }}>
      <div style={{ fontSize: '28px', marginBottom: '0.5rem' }}>🔔</div>
      No notifications yet.
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {notifications.map(notification => (
        <div
          key={notification.id}
          style={{
            background: notification.read ? '#FFFFFF' : '#F0F3FF',
            border: notification.priority === 'urgent' ? '1px solid #c21f1f' : notification.priority === 'high' ? '1px solid #2D3DCA' : '0.5px solid #E5E7EB',
            borderRadius: '10px',
            padding: '12px 14px',
          }}
        >
          <button
            type="button"
            onClick={() => handleNotificationClick(notification)}
            style={{ cursor: notification.action_url ? 'pointer' : 'default', display: 'flex', gap: '10px', alignItems: 'flex-start', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}
          >
            <div style={{ fontSize: '18px', flexShrink: 0, lineHeight: 1.3 }}>
              {NOTIFICATION_TYPE_ICONS[notification.type] || '💬'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
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
              <div style={{ fontSize: '11px', color: '#6B7280' }}>
                {timeAgo(notification.created_at)}
              </div>
            </div>
          </button>
          <button
            onClick={() => deleteNotification(notification.id)}
            style={{ marginTop: '8px', fontSize: '11px', color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', padding: 0, textDecoration: 'underline' }}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  )}
</div>

{showResonanceInfo && (
        <div
          onClick={() => setShowResonanceInfo(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '1.5rem', boxSizing: 'border-box',
          }}
        >
          <div
            ref={resonancePanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Resonance Score"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFFFFF', borderRadius: '16px', padding: '1.5rem',
              maxWidth: '360px', width: '100%', fontFamily: 'Merriweather, serif',
              outline: 'none',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
              Resonance Score
            </div>
            <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.7, marginBottom: '1rem' }}>
              Your resonance score reflects how closely your votes align with the overall verified community. A score of 50 means you're perfectly in the middle — voting with the majority half the time and against it half the time.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1rem' }}>
              {[
                { tier: 'Trailblazer', range: '0–9', desc: 'Consistently ahead of the curve' },
                { tier: 'Contrarian', range: '10–24', desc: 'Frequently swims against the tide' },
                { tier: 'Independent', range: '25–49', desc: 'Leans away from consensus' },
                { tier: 'Aligned', range: '50–74', desc: 'Often agrees with the majority' },
                { tier: 'Resonant', range: '75–90', desc: 'Strongly in tune with the community' },
                { tier: 'Chorus', range: '91–100', desc: 'Nearly always with the majority' },
              ].map(t => (
                <div key={t.tier} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '0.5px solid #F3F4F6' }}>
                  <span style={{ fontWeight: 700, color: '#2D3DCA' }}>{t.tier} ({t.range})</span>
                  <span style={{ color: '#6B7280' }}>{t.desc}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowResonanceInfo(false)}
              style={{ width: '100%', padding: '10px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
      {showIntegrityInfo && (
        <div
          onClick={() => setShowIntegrityInfo(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '1.5rem', boxSizing: 'border-box',
          }}
        >
          <div
            ref={integrityPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Reach your full weight"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFFFFF', borderRadius: '16px', padding: '1.5rem',
              maxWidth: '360px', width: '100%', fontFamily: 'Merriweather, serif',
              outline: 'none',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
              Reach your full weight
            </div>
            <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.7, marginBottom: '1rem' }}>
              Your integrity weight reflects sustained, genuine participation. It only ever moves up, and it's based on your activity over the last 30 days.
            </p>
            {!integrityStatus ? (
              <div style={{ padding: '0.5rem 0' }}><LoadingSpinner size={18} label={null} /></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '1rem' }}>
                {[
                  { label: 'Vote more', done: integrityStatus.voteMaxed, started: integrityStatus.voteStarted },
                  { label: 'Interact more', done: integrityStatus.commentMaxed, started: integrityStatus.commentStarted },
                  { label: 'Be consistent', done: integrityStatus.consistent, started: integrityStatus.consistent },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: item.done ? '#6d8a1c' : item.started ? '#d9c01a' : '#F3F4F6',
                        color: item.done || item.started ? 'white' : '#6B7280',
                        fontSize: '11px', fontWeight: 700,
                      }}
                    >
                      {item.done ? '✓' : item.started ? '~' : ''}
                    </div>
                    <span style={{ fontSize: '13px', color: item.done ? '#1A1A1A' : '#6B7280', textDecoration: item.done ? 'line-through' : 'none' }}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <a href="/how-it-works"
              style={{ display: 'block', fontSize: '12px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none', marginBottom: '0.75rem', textAlign: 'center' }}
            >
              Learn more about how weighting works →
            </a>
            <button
              onClick={() => setShowIntegrityInfo(false)}
              style={{ width: '100%', padding: '9px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
      {showBadgesInfo && (
        <div
          onClick={() => setShowBadgesInfo(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '1.5rem', boxSizing: 'border-box',
          }}
        >
          <div
            ref={badgesPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Badges"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFFFFF', borderRadius: '16px', padding: '1.5rem',
              maxWidth: '360px', width: '100%', fontFamily: 'Merriweather, serif',
              outline: 'none',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
              Badges
            </div>
            <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.7, marginBottom: '1rem' }}>
              Badges are earned automatically as you vote, comment, and engage — there's nothing to sign up for or claim. The moment you qualify for one, it shows up in the row above.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '1rem', maxHeight: '260px', overflowY: 'auto' }}>
              {Object.entries(BADGE_INFO).map(([key, info]) => {
                const earned = (profile?.badges || []).includes(key)
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '0.5px solid #F3F4F6', opacity: earned ? 1 : 0.6 }}>
                    <span style={{ fontSize: '18px', flexShrink: 0 }} aria-hidden="true">{info.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A1A' }}>{info.label}{earned ? ' ✓' : ''}</div>
                      <div style={{ fontSize: '11px', color: '#6B7280' }}>{info.description}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              onClick={() => setShowBadgesInfo(false)}
              style={{ width: '100%', padding: '10px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

    </div>
    </div>
    </div>
  )
}