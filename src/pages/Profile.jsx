import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Skeleton, SkeletonCard, SkeletonStatGrid } from '../components/ui/Skeleton'
import { useNotificationsContext } from '../context/NotificationsContext'
import BottomNav from '../components/layout/BottomNav'

function timeAgo(dateString) {
  const now = new Date()
  const date = new Date(dateString)
  const diff = Math.floor((now - date) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function Profile() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const [showResonanceInfo, setShowResonanceInfo] = useState(false)
  const [showIntegrityInfo, setShowIntegrityInfo] = useState(false)
  const [integrityStatus, setIntegrityStatus] = useState(null)
  const { notifications, markAsRead, markAllAsRead, deleteNotification } = useNotificationsContext()

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

const BADGE_INFO = {
  'ultra-definitive': { label: 'Ultra-Definitive', description: '100+ votes, less than 10% leaning', emoji: '🎯' },
  'decisive-streak': { label: 'Decisive Streak', description: '20 consecutive definitive votes', emoji: '🔥' },
  'super-decisive-streak': { label: 'Super Decisive Streak', description: '50 consecutive definitive votes', emoji: '⚡' },
}

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
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', paddingBottom: '80px' }}>
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
    )
  }

  if (error || !profile) {
    return (
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Merriweather, serif' }}>
        <p style={{ color: '#7a1313', fontSize: '14px' }}>{error || 'Profile not found.'}</p>
        <Link to="/" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none' }}>← back to home</Link>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
          sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
        </div>
        <Link to="/settings" style={{ color: '#6B7280', textDecoration: 'none' }}>
          <span style={{ fontSize: '20px' }}>⚙</span>
        </Link>
      </div>

      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>
          {profile.avatar || '🌿'}
        </div>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A' }}>{getDisplayName(profile)}</div>
          <div style={{ fontSize: '12px', color: '#6B7280', fontWeight: 300 }}>{getMemberSince(profile)}</div>
        </div>
      </div>

{/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', marginBottom: '1.5rem' }}>
        <div 
          onClick={() => setShowResonanceInfo(true)}
          style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center', cursor: 'pointer' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Resonance score ⓘ</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A1A1A' }}>{profile.resonance_score}</div>
          <div style={{ fontSize: '11px', color: '#2D3DCA', marginTop: '4px' }}>{profile.resonance_tier}</div>
        </div>
        <div style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Answered</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A1A1A' }}>{profile.answers_count}</div>
          <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px', fontWeight: 300 }}>questions</div>
        </div>
        <div style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Current streak</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A1A1A' }}>{profile.streak_days}</div>
          <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px', fontWeight: 300 }}>days</div>
        </div>
        <div
          onClick={openIntegrityInfo}
          style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center', cursor: 'pointer' }}
        >
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Integrity weight ⓘ</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A1A1A' }}>{profile.integrity_weight?.toFixed(4)}</div>
        </div>
      </div>

{/* Badges widget */}
<div style={{ marginBottom: '1.5rem' }}>
  <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
    Badges
  </div>
  {(profile?.badges || []).length === 0 ? (
    <div style={{ fontSize: '12px', color: '#9CA3AF' }}>
      Keep voting to earn your first badge.
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
        onClick={markAllAsRead}
        style={{ fontSize: '12px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', padding: 0 }}
      >
        Mark all as read
      </button>
    )}
  </div>
  {notifications.length === 0 ? (
    <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '14px' }}>
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
          <div
            onClick={() => markAsRead(notification.id)}
            style={{ cursor: 'pointer' }}
          >
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
              {new Date(notification.created_at).toLocaleDateString()}
            </div>
          </div>
          <button
            onClick={() => deleteNotification(notification.id)}
            style={{ marginTop: '8px', fontSize: '11px', color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', padding: 0, textDecoration: 'underline' }}
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
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFFFFF', borderRadius: '16px', padding: '1.5rem',
              maxWidth: '360px', width: '100%', fontFamily: 'Merriweather, serif',
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
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFFFFF', borderRadius: '16px', padding: '1.5rem',
              maxWidth: '360px', width: '100%', fontFamily: 'Merriweather, serif',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
              Reach your full weight
            </div>
            <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.7, marginBottom: '1rem' }}>
              Your integrity weight reflects sustained, genuine participation. It only ever moves up, and it's based on your activity over the last 30 days.
            </p>
            {!integrityStatus ? (
              <p style={{ fontSize: '13px', color: '#9CA3AF' }}>Loading...</p>
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
                        color: item.done || item.started ? 'white' : '#9CA3AF',
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
      <BottomNav />
    </div>
  )
}