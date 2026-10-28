import { useState, useEffect, useCallback } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { HEADER_HEIGHT_PX } from '../components/layout/Header'
import { BOTTOM_NAV_HEIGHT_PX } from '../components/layout/BottomNav'
import LoadingSpinner from '../components/ui/LoadingSpinner'

// migration: 095_question_parties.sql — the "? Party" invite/results page,
// reached via the link create_party()/join_party() hand out
// (https://senseus.app/party/:token). Same token-page shape as
// Compare.jsx: get_party_preview(token) first (the thin, pre-join read —
// never exposes the question list or anyone's votes to someone who
// hasn't joined), then join_party(token) if the viewer chooses to join,
// then get_party_results(token) for the actual N-way breakdown once
// they're a participant.

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f', dec: '#2D3DCA',
}

const VOTE_LABELS = {
  yes: 'yes', ly: 'leaning yes', ln: 'leaning no', no: 'no', dec: 'undecided',
}

const JOIN_REJECTION_MESSAGES = {
  rate_limited: "You're trying that a little too fast — give it a second and try again.",
  not_found: 'This party invite could not be found.',
  already_closed: 'This party is no longer open.',
  expired: 'This party invite has expired.',
  party_full: 'This party already has its full 6 people.',
}

function timeUntil(dateString) {
  const diff = Math.floor((new Date(dateString) - new Date()) / 1000)
  if (diff <= 0) return 'expiring soon'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function timeAgo(dateString) {
  const diff = Math.floor((new Date() - new Date(dateString)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function Party() {
  usePageTitle('? Party')
  const { token } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [preview, setPreview] = useState(null)
  const [questions, setQuestions] = useState([]) // [{ question_id, question_number, question_text, question_category, answers: [...] }]
  const [partyMeta, setPartyMeta] = useState(null) // { party_status, expires_at, completed_at }
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  const loadResults = useCallback(async (p_token) => {
    const { data } = await supabase.rpc('get_party_results', { p_token })
    if (!data || data.length === 0) {
      setQuestions([])
      setPartyMeta(null)
      return
    }

    setPartyMeta({
      party_status: data[0].party_status,
      expires_at: data[0].expires_at,
      completed_at: data[0].completed_at,
    })

    // One row per (question, participant) — group into one entry per
    // question, each carrying every participant's answer for it.
    const byQuestion = new Map()
    for (const row of data) {
      if (!byQuestion.has(row.question_id)) {
        byQuestion.set(row.question_id, {
          question_id: row.question_id,
          question_number: row.question_number,
          question_text: row.question_text,
          question_category: row.question_category,
          answers: [],
        })
      }
      byQuestion.get(row.question_id).answers.push({
        participant_number: row.participant_number,
        display_name: row.display_name,
        is_host: row.is_host,
        is_mine: row.is_mine,
        choice: row.choice,
      })
    }
    setQuestions([...byQuestion.values()])
  }, [])

  useEffect(() => {
    async function load() {
      // Requires the exact token as an argument — same anti-listability
      // reasoning as get_comparison_token (migration 079): RLS can't tell
      // "filtered by one known token" from "no filter" at the row level,
      // so question_parties has zero standing grants and this is the only
      // read path.
      const { data: p } = await supabase.rpc('get_party_preview', { p_token: token }).maybeSingle()

      if (!p) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setPreview(p)

      if (p.already_joined) {
        await loadResults(token)
      }

      setLoading(false)
    }

    load()
  }, [token, loadResults])

  async function handleJoin() {
    setJoining(true)
    setJoinError(null)

    const { data, error } = await supabase.rpc('join_party', { p_token: token }).single()
    setJoining(false)

    if (error) {
      setJoinError(error.message || 'Something went wrong — please try again.')
      return
    }

    if (data?.rejected_reason && JOIN_REJECTION_MESSAGES[data.rejected_reason]) {
      setJoinError(JOIN_REJECTION_MESSAGES[data.rejected_reason])
      return
    }

    setPreview(prev => ({ ...prev, already_joined: true, participant_count: Math.min((prev?.participant_count || 0) + 1, prev?.capacity || 6) }))
    await loadResults(token)
  }

  async function sharePartyLink() {
    const url = `https://senseus.app/party/${token}`
    const shareData = { title: 'senseUS', text: 'Join my ? Party on senseUS — vote on a few questions and see how we compare.', url }
    if (navigator.share) {
      try { await navigator.share(shareData) } catch { /* cancelled, not an error */ }
    } else {
      try {
        await navigator.clipboard.writeText(url)
        alert('Party invite link copied to clipboard!')
      } catch {
        prompt('Copy this link:', url)
      }
    }
  }

  const pageStyle = {
    minHeight: `calc(100dvh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`,
    boxSizing: 'border-box',
    background: '#C7C7CC',
    padding: '14px',
  }
  const cardStyle = {
    maxWidth: '480px',
    margin: '0 auto',
    padding: '1.5rem',
    fontFamily: 'Merriweather, serif',
    boxSizing: 'border-box',
    background: '#FFFFFF',
    borderRadius: 'var(--senseus-card-radius)',
    boxShadow: 'var(--senseus-card-shadow)',
  }

  if (loading) {
    return (
      <div style={{ ...pageStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner label="Loading party..." />
      </div>
    )
  }

  if (notFound) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginTop: 0 }}>? Party</h1>
          <p style={{ fontSize: '13px', color: '#6B7280' }}>This party invite could not be found.</p>
          <button
            onClick={() => navigate('/activity')}
            style={{ padding: '8px 16px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Back to Activity
          </button>
        </div>
      </div>
    )
  }

  const isHostViewer = questions.some(q => q.answers.some(a => a.is_mine && a.is_host))
  const effectiveStatus = partyMeta?.party_status || preview?.status

  // Pre-join screen — deliberately thin (no question list, no votes),
  // matching get_party_preview()'s own restriction server-side.
  if (!preview?.already_joined) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginTop: 0, marginBottom: '0.5rem' }}>? Party</h1>
          <p style={{ fontSize: '14px', color: '#1A1A1A', lineHeight: 1.5 }}>
            <strong>{preview.host_display_name}</strong> invited you to vote on {preview.question_count} question{preview.question_count === 1 ? '' : 's'} and compare answers.
          </p>
          <p style={{ fontSize: '12px', color: '#6B7280' }}>
            {preview.participant_count}/{preview.capacity} joined so far
            {preview.status === 'open' && ` · expires in ${timeUntil(preview.expires_at)}`}
          </p>

          {preview.status !== 'open' ? (
            <p style={{ fontSize: '13px', color: '#991B1B' }}>
              This party is {preview.status} and can no longer be joined.
            </p>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              style={{ width: '100%', padding: '10px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: joining ? 'default' : 'pointer', fontFamily: 'Merriweather, serif', opacity: joining ? 0.6 : 1 }}
            >
              {joining ? 'Joining…' : 'Join the Party'}
            </button>
          )}
          {joinError && (
            <p style={{ fontSize: '12px', color: '#991B1B', marginTop: '10px' }}>{joinError}</p>
          )}
        </div>
      </div>
    )
  }

  // Joined — the results view. Every question's own card lists each
  // participant's answer (or a prompt to go vote, when it's the viewer's
  // own still-missing answer on that question).
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>? Party</h1>
          <span style={{
            fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
            background: effectiveStatus === 'open' ? '#E6F1FB' : effectiveStatus === 'completed' ? '#eef3e0' : '#F3F4F6',
            color: effectiveStatus === 'open' ? '#0C447C' : effectiveStatus === 'completed' ? '#4d621d' : '#6B7280',
          }}>
            {effectiveStatus === 'open' ? 'Open' : effectiveStatus === 'completed' ? 'Completed' : 'Expired'}
          </span>
        </div>
        <p style={{ fontSize: '12px', color: '#6B7280', marginTop: 0, marginBottom: '1.25rem' }}>
          {preview.participant_count}/{preview.capacity} joined
          {effectiveStatus === 'open' && partyMeta?.expires_at && ` · expires in ${timeUntil(partyMeta.expires_at)}`}
          {effectiveStatus === 'completed' && partyMeta?.completed_at && ` · completed ${timeAgo(partyMeta.completed_at)}`}
        </p>

        {isHostViewer && effectiveStatus === 'open' && (
          <button
            onClick={sharePartyLink}
            style={{ width: '100%', marginBottom: '1.25rem', padding: '8px', background: '#F3F4F6', color: '#2D3DCA', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Invite more people to this party
          </button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {questions.map(q => (
            <div key={q.question_id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '11px', color: '#0C447C', background: '#E6F1FB', display: 'inline-block', padding: '2px 8px', borderRadius: '20px', marginBottom: '8px' }}>
                {q.question_category}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.4, marginBottom: '10px' }}>
                {q.question_text}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {q.answers
                  .slice()
                  .sort((a, b) => a.participant_number - b.participant_number)
                  .map(a => (
                    <div key={a.participant_number} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#1A1A1A', fontWeight: a.is_mine ? 700 : 400 }}>
                        {a.is_mine ? 'You' : a.display_name}{a.is_host ? ' (host)' : ''}
                      </span>
                      {a.choice ? (
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: '#FFFFFF', border: `1.5px solid ${VOTE_COLORS[a.choice]}`, color: VOTE_COLORS[a.choice] }}>
                          {VOTE_LABELS[a.choice]}
                        </span>
                      ) : a.is_mine ? (
                        <button
                          onClick={() => navigate(`/vote?question=${q.question_id}`)}
                          style={{ fontSize: '11px', color: '#2D3DCA', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                        >
                          Vote now
                        </button>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>hasn't voted yet</span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
