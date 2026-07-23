import Header from '../components/layout/Header'
import { useNotifications } from '../hooks/useNotifications'
import { useNotificationsContext } from '../context/NotificationsContext'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import BottomNav from '../components/layout/BottomNav'
import { IconWaveSine, IconChartBar, IconThumbUp, IconThumbDown } from '@tabler/icons-react'

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f', dec: '#2D3DCA'
}

const VOTE_LABELS = {
  yes: 'yes', ly: 'leaning yes', ln: 'leaning no', no: 'no', dec: 'undecided'
}

function VoteIcon({ choice, size = 14 }) {
  const color = VOTE_COLORS[choice] || '#6B7280'
  if (choice === 'yes') return <IconThumbUp size={size} color={color} />
  if (choice === 'ly') return <IconThumbUp size={size} color={color} style={{ transform: 'rotate(45deg)' }} />
  if (choice === 'ln') return <IconThumbDown size={size} color={color} style={{ transform: 'rotate(45deg)' }} />
  if (choice === 'no') return <IconThumbDown size={size} color={color} />
  return <span style={{ fontSize: size - 2, color }}>undecided</span>
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

function formatVoteTimestamp(dateString) {
  const date = new Date(dateString)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  let hours = date.getUTCHours()
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'pm' : 'am'
  hours = hours % 12
  if (hours === 0) hours = 12
  return `${y}.${m}.${d} @ ${hours}:${minutes}${ampm} UTC`
}

export default function Activity() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('replies')
  const [replies, setReplies] = useState([])
  const [shifts, setShifts] = useState([])
  const [badges, setBadges] = useState([])
  const [loading, setLoading] = useState(true)
  const { notifications, markAsRead, markAllAsRead } = useNotificationsContext()

  useEffect(() => {
    if (!user) return
    async function fetchActivity() {
      try {
        // Fetch replies to user's comments
        const { data: userComments } = await supabase
          .from('comments')
          .select('id, body, question_id')
          .eq('user_id', user.id)
          .eq('is_deleted', false)

        if (userComments?.length > 0) {
          const commentIds = userComments.map(c => c.id)
          const { data: repliesData } = await supabase
            .from('comments')
            .select(`
              id, body, created_at, parent_id, resonance_count,
              profiles (first_name, last_initial, display_preference, anon_name),
              questions (id, text, category)
            `)
            .in('parent_id', commentIds)
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
            .limit(20)

          setReplies(repliesData || [])
        }

        // Fetch all questions user has voted on with current tallies
        const { data: userVotes } = await supabase
          .from('votes')
          .select(`
            choice, created_at, pct_yes_at_vote,
            questions (id, text, category)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20)

        if (userVotes?.length > 0) {
          const questionIds = userVotes.map(v => v.questions.id)
          const { data: tallyRows } = await supabase.rpc('get_vote_tallies_batch', {
            p_question_ids: questionIds,
          })
          const totalsById = {}
          for (const row of tallyRows || []) {
            totalsById[row.question_id] = {
              pctYes: Number(row.total) > 0 ? Math.round(((Number(row.yes) + Number(row.ly)) / Number(row.total)) * 100) : 0,
              total: Number(row.total),
            }
          }
          const shiftsWithCurrent = userVotes.map(vote => {
            const t = totalsById[vote.questions.id] || { pctYes: 0, total: 0 }
            const hasBaseline = vote.pct_yes_at_vote !== null && vote.pct_yes_at_vote !== undefined
            const delta = hasBaseline ? t.pctYes - vote.pct_yes_at_vote : null
            return { ...vote, pctYes: t.pctYes, pctNo: 100 - t.pctYes, total: t.total, delta }
          })
          setShifts(shiftsWithCurrent)
        }

        // Fetch badges from profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('badges')
          .eq('id', user.id)
          .single()
        setBadges(profile?.badges || [])

        // Fetch skipped ("Revisit") questions
        const { data: skipsData } = await supabase
          .from('question_skips')
          .select('id, question_id, created_at, questions (id, text, category)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
        setSkipped(skipsData || [])

      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchActivity()
  }, [user])

   function getDisplayName(profile) {
    if (!profile) return 'Anonymous'
    if (profile.display_preference === 'anon') return profile.anon_name || 'Anonymous'
    if (profile.display_preference === 'first_only') return profile.first_name
    return `${profile.first_name} ${profile.last_initial}.`
  }

  const BADGE_INFO = {
    'ultra-definitive': { label: 'Ultra-Definitive', description: '100+ votes, less than 10% leaning', emoji: '🎯' },
    'decisive-streak': { label: 'Decisive Streak', description: '20 consecutive definitive votes', emoji: '🔥' },
    'super-decisive-streak': { label: 'Super Decisive Streak', description: '50 consecutive definitive votes', emoji: '⚡' },
  }

  if (loading) {
    return (
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', paddingBottom: '80px' }}>
        <Skeleton height="16px" width="40%" style={{ marginBottom: '1.5rem' }} />
        <SkeletonCard style={{ marginBottom: '8px' }} />
        <SkeletonCard style={{ marginBottom: '8px' }} />
        <SkeletonCard style={{ marginBottom: '8px' }} />
        <SkeletonCard />
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
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A' }}>Activity</div>
        <div style={{ width: '60px' }} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '1.5rem', background: '#F3F4F6', padding: '4px', borderRadius: '10px' }}>
        {[
          { key: 'replies', label: 'Replies' },
          { key: 'shifts', label: 'Shifts' },
          { key: 'badges', label: 'Badges' },
          { key: 'revisit', label: 'Revisit' },
          { key: 'notifications', label: 'Notifications' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '8px', background: tab === t.key ? '#2D3DCA' : 'transparent',
              color: tab === t.key ? 'white' : '#6B7280', border: 'none', borderRadius: '8px',
              fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Replies tab */}
      {tab === 'replies' && (
        <div>
          {replies.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
              No replies yet. Join a conversation to get started.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {replies.map(reply => (
                <div
                  key={reply.id}
                  onClick={() => navigate(`/conversation/${reply.questions?.id}`)}
                  style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, color: '#1A1A1A' }}>{getDisplayName(reply.profiles)}</span>
                    {' '}replied to your comment
                  </div>
                  <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.5, marginBottom: '6px' }}>
                    {reply.body}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                      {reply.questions?.category} · {timeAgo(reply.created_at)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: '#6B7280' }}>
                      <IconWaveSine size={11} />
                      {reply.resonance_count}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Shifts tab */}
      {tab === 'shifts' && (
        <div>
          <p style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.6, marginBottom: '1rem' }}>
            See how public opinion is trending on questions you've answered. On the left is a timestamp of when you voted and how. On the right is the current total vote count, current yes/no percentage, and how the percentage has shifted since you voted.
          </p>
          {shifts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
              No shifts yet. Vote on some questions to see how they're trending.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {shifts.map((shift, i) => (
                <div
                  key={i}
                  onClick={() => navigate(`/conversation/${shift.questions?.id}`)}
                  style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, marginBottom: '8px' }}>
                    {shift.questions?.text}
                  </div>

                  {/* Tally bar */}
                  <div style={{ width: '100%', height: '6px', borderRadius: '3px', overflow: 'hidden', display: 'flex', background: '#F1F1F1', marginBottom: '6px' }}>
                    <div style={{ width: `${shift.pctYes}%`, background: '#6d8a1c', transition: 'width 0.3s ease' }} />
                    <div style={{ width: `${shift.pctNo}%`, background: '#c21f1f', transition: 'width 0.3s ease' }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ fontSize: '11px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        You voted <VoteIcon choice={shift.choice} size={13} />
                      </div>
                      <div style={{ fontSize: '10px', color: '#9CA3AF' }}>
                        on {formatVoteTimestamp(shift.created_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', color: '#4d621d', fontWeight: 700 }}>
                          ▲ {shift.pctYes}% yes
                        </span>
                        <span style={{ fontSize: '11px', color: '#7a1313', fontWeight: 700 }}>
                          ▼ {shift.pctNo}% no
                        </span>
                      </div>
                      {shift.delta !== null && (
                        <div style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: shift.delta > 0 ? '#4d621d' : shift.delta < 0 ? '#7a1313' : '#9CA3AF',
                        }}>
                          {shift.delta > 0 ? `↑ +${shift.delta} pts since you voted` : shift.delta < 0 ? `↓ ${shift.delta} pts since you voted` : 'No shift since you voted'}
                        </div>
                      )}
                      <div style={{ fontSize: '10px', color: '#9CA3AF' }}>
                        {shift.total} {shift.total === 1 ? 'human' : 'humans'} answered to date
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

{tab === 'revisit' && (
        <div>
          {skipped.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
              Nothing here. Questions you choose not to see disappear from your feed and show up here instead.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {skipped.map(skip => (
                <div
                  key={skip.id}
                  style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}
                >
                  <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.5, marginBottom: '8px' }}>
                    {skip.questions?.text}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                      {skip.questions?.category} · {timeAgo(skip.created_at)}
                    </div>
                    <button
                      onClick={async () => {
                        await supabase.from('question_skips').delete().eq('id', skip.id)
                        setSkipped(prev => prev.filter(s => s.id !== skip.id))
                        navigate(`/vote?question=${skip.question_id}`)
                      }}
                      style={{ fontSize: '12px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', fontWeight: 500 }}
                    >
                      Revisit →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Badges tab */}
      {tab === 'badges' && (
        <div>
          {badges.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0' }}>
              <div style={{ fontSize: '32px', marginBottom: '1rem' }}>🏆</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.5rem' }}>No badges yet</div>
              <p style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.7, maxWidth: '260px', margin: '0 auto' }}>
                Keep voting to earn badges. Cast 20 consecutive definitive yes/no votes to earn your first Decisive Streak badge.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {badges.map(badge => {
                const info = BADGE_INFO[badge] || { label: badge, description: '', emoji: '🏅' }
                return (
                  <div key={badge} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '14px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ fontSize: '28px' }}>{info.emoji}</div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A1A1A' }}>{info.label}</div>
                      <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>{info.description}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Notifications */}
      {tab === 'notifications' && (
        <div>
          {notifications.length > 0 && (
            <button
              onClick={markAllAsRead}
              style={{ fontSize: '12px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', marginBottom: '1rem', padding: 0 }}
            >
              Mark all as read
            </button>
          )}
          {notifications.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
              No notifications yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {notifications.map(notification => (
                <div
                  key={notification.id}
                  onClick={() => markAsRead(notification.id)}
                  style={{
                    background: notification.read ? '#FFFFFF' : '#F0F3FF',
                    border: notification.priority === 'urgent' ? '1px solid #c21f1f' : notification.priority === 'high' ? '1px solid #2D3DCA' : '0.5px solid #E5E7EB',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    cursor: 'pointer',
                  }}
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
              ))}
            </div>
          )}
        </div>
      )}

      <BottomNav />
    </div>
  )
}