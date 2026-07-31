import Header from '../components/layout/Header'
import AnimatedWordmark from '../components/layout/AnimatedWordmark'
import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Skeleton, SkeletonCard, SkeletonStatGrid } from '../components/ui/Skeleton'
import BottomNav from '../components/layout/BottomNav'

const VOTE_PILL_STYLES = {
  yes: { background: '#eef3e0', color: '#4d621d' },
  ly: { background: '#faf6d0', color: '#7a6b0e' },
  ln: { background: '#f9ead8', color: '#7a4513' },
  no: { background: '#f9d8d8', color: '#7a1313' },
}

const VOTE_LABELS = {
  yes: 'yes',
  ly: 'leaning yes',
  ln: 'leaning no',
  no: 'no',
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

export default function Profile() {
  const [snapshotMap, setSnapshotMap] = useState({})
  const [profile, setProfile] = useState(null)
  const [votes, setVotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const [showResonanceInfo, setShowResonanceInfo] = useState(false)
  const [showIntegrityInfo, setShowIntegrityInfo] = useState(false)
  const [integrityStatus, setIntegrityStatus] = useState(null)

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

async function startComparison() {
    const { data, error } = await supabase
      .from('comparison_tokens')
      .insert({ sender_id: profile.id })
      .select('token')
      .single()

    if (error || !data) {
      alert('Something went wrong creating your link.')
      return
    }

    const url = `https://senseus.app/compare/${data.token}`
    const shareData = { title: 'senseUS', text: 'Compare voting histories with me on senseUS', url }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(url)
        alert('Link copied to clipboard!')
      } catch {
        prompt('Copy this link:', url)
      }
    }
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

        // Profile and votes are independent queries — run them together
        // instead of waiting on one before starting the other.
        const [
          { data: profileData, error: profileError },
          { data: votesData, error: votesError },
        ] = await Promise.all([
          supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single(),
          supabase
            .from('votes')
            .select(`
              id,
              choice,
              created_at,
              updated_at,
              pct_yes_at_vote,
              pct_no_at_vote,
              questions (
                id,
                text,
                category
              )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
        ])

        if (profileError) throw profileError
        setProfile(profileData)

        if (votesError) throw votesError

        // Fetch 7-day snapshots
        const questionIds = (votesData || []).map(v => v.questions?.id).filter(Boolean)
        let newSnapshotMap = {}
        if (questionIds.length > 0) {
          const today = new Date()
          const sevenDaysAgo = new Date(today)
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
          const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]
          const todayStr = today.toISOString().split('T')[0]

          const { data: snapshots } = await supabase
            .from('question_snapshots')
            .select('question_id, pct_yes, pct_no, total_votes, snapshot_date')
            .in('question_id', questionIds)
            .in('snapshot_date', [todayStr, sevenDaysAgoStr])

          ;(snapshots || []).forEach(s => {
            if (!newSnapshotMap[s.question_id]) newSnapshotMap[s.question_id] = {}
            if (s.snapshot_date === todayStr) newSnapshotMap[s.question_id].today = s
            if (s.snapshot_date === sevenDaysAgoStr) newSnapshotMap[s.question_id].sevenDaysAgo = s
          })
        }

        setVotes(votesData || [])
        setSnapshotMap(newSnapshotMap)
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
          sense<AnimatedWordmark />
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

    {/* Comparison button */}
    <button
      onClick={startComparison}
      style={{ width: '100%', padding: '8px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif', marginBottom: '1.5rem' }}
    >
      Compare your vote history with a friend
    </button>

      {/* Vote history */}
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
        Vote history
      </div>

      {votes.length === 0 ? (
        <p style={{ fontSize: '13px', color: '#6B7280', textAlign: 'center', padding: '2rem 0' }}>
          No votes yet — head to the vote feed to get started.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {votes.map((vote) => {
            const totalAtVote = vote.pct_yes_at_vote != null ? 100 : null
            return (
              <div
                key={vote.id}
                style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '12px 14px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.5, flex: 1 }}>
                    {vote.questions?.text}
                  </div>
                  <div style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0, ...VOTE_PILL_STYLES[vote.choice] }}>
                    {VOTE_LABELS[vote.choice]}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 300 }}>
                    {vote.questions?.category} · {timeAgo(vote.created_at)}
                  </div>
                    {snapshotMap[vote.questions?.id]?.today && (
                  <div style={{ marginTop: '8px' }}>
                    {(() => {
                      const todaySnap = snapshotMap[vote.questions?.id]?.today
                      const weekSnap = snapshotMap[vote.questions?.id]?.sevenDaysAgo
                      const currentPctYes = todaySnap?.pct_yes || 0
                      const currentPctNo = todaySnap?.pct_no || 0
                      const trend = weekSnap ? currentPctYes - weekSnap.pct_yes : null

                      return (
                        <div>
                          {/* Current tally bar */}
                          <div style={{ width: '100%', height: '6px', borderRadius: '3px', overflow: 'hidden', display: 'flex', background: '#F1F1F1', marginBottom: '4px' }}>
                            <div style={{ width: `${currentPctYes}%`, background: '#6d8a1c' }} />
                            <div style={{ width: `${currentPctNo}%`, background: '#c21f1f' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontSize: '10px', color: '#6B7280' }}>
                              <span style={{ color: '#4d621d', fontWeight: 700 }}>{currentPctYes}% yes</span>
                              {' · '}
                              <span style={{ color: '#7a1313', fontWeight: 700 }}>{currentPctNo}% no</span>
                              {' · '}
                              {todaySnap.total_votes} {todaySnap.total_votes === 1 ? 'human' : 'humans'}
                            </div>
                            {trend !== null && (
                              <div style={{ fontSize: '10px', fontWeight: 700, color: trend > 0 ? '#4d621d' : trend < 0 ? '#7a1313' : '#6B7280' }}>
                                {trend > 0 ? '▲' : trend < 0 ? '▼' : '—'}
                                {trend !== 0 ? ` ${Math.abs(trend)}% this week` : ' no change'}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )} 
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button
                    onClick={() => navigate(`/vote?question=${vote.questions?.id}&currentVote=${vote.choice}`)}
                    style={{ flex: 1, padding: '6px', background: '#F3F4F6', color: '#1A1A1A', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                  >
                    Change vote
                  </button>
                  <button
                    onClick={() => navigate(`/conversation/${vote.questions?.id}`)}
                    style={{ flex: 1, padding: '6px', background: '#E6F1FB', color: '#0C447C', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                  >
                    View conversation
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
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