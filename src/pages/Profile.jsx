import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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

function DeltaBadge({ pctAtVote, pctNow, type }) {
  if (pctAtVote == null || pctNow == null) return null
  const delta = Math.round(pctNow - pctAtVote)
  if (delta === 0) return null
  const isUp = delta > 0
  const color = type === 'yes'
    ? (isUp ? '#4d621d' : '#7a1313')
    : (isUp ? '#7a1313' : '#4d621d')
  return (
    <span style={{ fontSize: '11px', color, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '2px' }}>
      {isUp ? '▲' : '▼'} {Math.abs(delta)}%
    </span>
  )
}

export default function Profile() {
  const [profile, setProfile] = useState(null)
  const [votes, setVotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

        const { data: votesData, error: votesError } = await supabase
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
          .order('created_at', { ascending: false })

        if (votesError) throw votesError
        setVotes(votesData || [])
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
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '2rem 1.5rem', textAlign: 'center', color: '#6B7280', fontFamily: 'Merriweather, serif' }}>
        Loading...
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
    <div style={{ maxWidth: '420px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
          sense<span style={{ fontWeight: 700, color: '#2D3DCA' }}>US</span>
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
        <div style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Resonance score</div>
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
        <div style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px', fontWeight: 300 }}>Integrity weight</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A1A1A' }}>{profile.integrity_weight?.toFixed(4)}</div>
          <div style={{ fontSize: '11px', color: '#52B788', marginTop: '4px' }}>verified</div>
        </div>
      </div>

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
                  {vote.pct_yes_at_vote != null && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <DeltaBadge pctAtVote={vote.pct_yes_at_vote} pctNow={65} type="yes" />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}