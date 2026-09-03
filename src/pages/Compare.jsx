import { useState, useEffect, useCallback, useMemo } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { BADGE_EMOJI } from '../lib/badgeInfo'
import { HEADER_HEIGHT_PX } from '../components/layout/Header'

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f'
}

const VOTE_LABELS = {
  yes: 'yes', ly: 'leaning yes', ln: 'leaning no', no: 'no'
}

// 'Closely' groups by side of the issue (yes/leaning-yes vs no/leaning-no);
// 'exactly' only counts agreement when both picked the identical choice.
const SAME_SIDE = { yes: 'yes', ly: 'yes', ln: 'no', no: 'no' }

function agrees(mine, theirs, mode) {
  if (mode === 'exactly') return mine === theirs
  return SAME_SIDE[mine] === SAME_SIDE[theirs]
}

function getDisplayName(profile) {
  if (!profile) return 'Anonymous'
  if (profile.display_preference === 'anon') return profile.anon_name || 'Anonymous'
  if (profile.display_preference === 'first_only') return profile.first_name
  return `${profile.first_name} ${profile.last_initial}.`
}

export default function Compare() {
  usePageTitle('Compare')
  const { token } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [tokenRow, setTokenRow] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [senderProfile, setSenderProfile] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [matchMode, setMatchMode] = useState('closely')

  const loadComparison = useCallback(async (tr) => {
    const otherId = tr.sender_id === user.id ? tr.recipient_id : tr.sender_id

    // Used to fetch both accounts' entire vote histories (unbounded) and
    // intersect them in JS, then fetch every shared question. For two
    // long-time users that's an ever-growing full-history download on
    // both sides. get_comparison computes the intersection server-side
    // via a self-join on votes, so only the shared rows ever cross the
    // wire.
    //
    // The two profile lookups went through get_public_profiles() as of
    // migration 054, replacing a direct public_profiles SELECT that had
    // no scoping at the grant level (same fix shape as public_votes in
    // migration 051). The RPC always returns the view's full column set,
    // so this just keeps destructuring the same fields as before.
    const [{ data: sharedRows }, { data: otherProfile }, { data: myProfile }] = await Promise.all([
      supabase.rpc('get_comparison', { p_other_id: otherId }),
      supabase.rpc('get_public_profiles', { p_user_ids: [otherId] }).single(),
      supabase.rpc('get_public_profiles', { p_user_ids: [user.id] }).single(),
    ])

    const enriched = (sharedRows || []).map(r => ({
      questionId: r.question_id,
      mine: r.mine,
      theirs: r.theirs,
      question: { id: r.question_id, text: r.question_text, domain: r.domain },
    }))

    setComparison({ otherProfile, myProfile, shared: enriched })
    // Note: eslint's exhaustive-deps rule is satisfied by [user?.id] directly
    // here (it only sees the .id access), unlike the other fix sites in this
    // pass where a disable comment was needed — so none is added here.
  }, [user?.id])

  // Recomputed client-side, not refetched — toggling match mode just
  // re-scores the same already-loaded mine/theirs pairs, so this is
  // instant with no loading state.
  const { agreementPct, byDomain } = useMemo(() => {
    const shared = comparison?.shared || []
    if (shared.length === 0) return { agreementPct: null, byDomain: {} }

    const agreeCount = shared.filter(s => agrees(s.mine, s.theirs, matchMode)).length
    const pct = Math.round((agreeCount / shared.length) * 100)

    const domains = {}
    shared.forEach(s => {
      const d = s.question.domain || 'other'
      if (!domains[d]) domains[d] = { agree: 0, total: 0 }
      domains[d].total += 1
      if (agrees(s.mine, s.theirs, matchMode)) domains[d].agree += 1
    })

    return { agreementPct: pct, byDomain: domains }
  }, [comparison, matchMode])

  const myBadges = comparison?.myProfile?.badges || []
  const theirBadges = comparison?.otherProfile?.badges || []
  const sharedBadges = myBadges.filter(b => theirBadges.includes(b))
  const onlyMyBadges = myBadges.filter(b => !theirBadges.includes(b))
  const onlyTheirBadges = theirBadges.filter(b => !myBadges.includes(b))

  useEffect(() => {
    async function load() {
      const { data: tr } = await supabase
        .from('comparison_tokens')
        .select('*')
        .eq('token', token)
        .maybeSingle()

      if (!tr) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setTokenRow(tr)

      // As of migration 054, via get_public_profiles() -- see the note
      // in loadComparison() above.
      const { data: sp } = await supabase
        .rpc('get_public_profiles', { p_user_ids: [tr.sender_id] })
        .single()
      setSenderProfile(sp)

      if (tr.status === 'accepted') {
        await loadComparison(tr)
      }

      setLoading(false)
    }

    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user.id, not the user object, is the real dependency (see ProtectedRoute.jsx for the same pattern) — loadComparison's own identity is now stable across token refreshes too, since its useCallback was fixed the same way.
  }, [token, user?.id, loadComparison])

  async function handleAccept() {
    setProcessing(true)
    // Was a raw table update with no expiry check — accept_comparison_token
    // enforces the 48h expiry (and self-accept/double-accept) server-side,
    // since a client-side-only check can always be bypassed.
    const { error } = await supabase.rpc('accept_comparison_token', { p_token: token })

    if (error) {
      alert(error.message || 'This link is no longer available — it may have already been used or expired.')
      setProcessing(false)
      return
    }

    const updated = { ...tokenRow, status: 'accepted', recipient_id: user.id }
    setTokenRow(updated)
    await loadComparison(updated)
    setProcessing(false)
  }

  async function handleDecline() {
    setProcessing(true)
    const { error } = await supabase
      .from('comparison_tokens')
      .update({ status: 'declined' })
      .eq('id', tokenRow.id)

    if (error) {
      alert('Something went wrong — please try again.')
      setProcessing(false)
      return
    }

    setTokenRow({ ...tokenRow, status: 'declined' })
    setProcessing(false)
  }

  async function startNewComparison() {
    const { data, error } = await supabase
      .from('comparison_tokens')
      .insert({ sender_id: user.id })
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
      } catch {
        // User cancelled the share sheet — not an error, do nothing
      }
    } else {
      try {
        await navigator.clipboard.writeText(url)
        alert('Link copied to clipboard!')
      } catch {
        prompt('Copy this link:', url)
      }
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100dvh - ${HEADER_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box', background: '#C7C7CC' }}>
      <div style={{ padding: '14px', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', paddingBottom: '100px', background: '#FFFFFF', borderRadius: '20px', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>

          <button
            onClick={() => navigate('/profile')}
            style={{ fontSize: '13px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', padding: 0, marginBottom: '1.25rem' }}
          >
            ← back
          </button>

          {notFound && (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <p style={{ fontSize: '14px', color: '#6B7280' }}>
                This comparison link doesn't exist or has expired.
              </p>
            </div>
          )}

          {!notFound && tokenRow?.status === 'declined' && (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <p style={{ fontSize: '14px', color: '#6B7280' }}>This comparison was declined.</p>
            </div>
          )}

          {!notFound && tokenRow?.status === 'pending' && tokenRow.sender_id === user?.id && (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <p style={{ fontSize: '14px', color: '#1A1A1A', marginBottom: '0.5rem' }}>
                Waiting for your friend to accept.
              </p>
              <p style={{ fontSize: '12px', color: '#6B7280' }}>
                This link expires 48 hours after you created it.
              </p>
            </div>
          )}

          {!notFound && tokenRow?.status === 'pending' && tokenRow.sender_id !== user?.id && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
                {getDisplayName(senderProfile)} wants to compare voting histories with you
              </h1>
              <p style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                You'll see how your answers line up on every question you've both voted on. Nothing is shared unless you accept.
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleAccept}
                  disabled={processing}
                  style={{ flex: 1, padding: '10px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif', opacity: processing ? 0.5 : 1 }}
                >
                  Accept
                </button>
                <button
                  onClick={handleDecline}
                  disabled={processing}
                  style={{ flex: 1, padding: '10px', background: '#F3F4F6', color: '#6B7280', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif', opacity: processing ? 0.5 : 1 }}
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {!notFound && tokenRow?.status === 'accepted' && comparison && (
            <div>
              <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginBottom: '1.25rem', textAlign: 'center' }}>
                You vs {getDisplayName(comparison.otherProfile)}
              </h1>

              {comparison.shared.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#6B7280', textAlign: 'center' }}>
                  You haven't both answered any of the same questions yet.
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '1.25rem', background: '#F3F4F6', padding: '3px', borderRadius: '8px', maxWidth: '220px', margin: '0 auto 1.25rem' }}>
                    {[
                      { key: 'closely', label: 'Match closely' },
                      { key: 'exactly', label: 'Match exactly' },
                    ].map(m => (
                      <button
                        key={m.key}
                        onClick={() => setMatchMode(m.key)}
                        style={{
                          flex: 1, padding: '6px 10px', background: matchMode === m.key ? '#FFFFFF' : 'transparent',
                          color: matchMode === m.key ? '#1A1A1A' : '#6B7280', border: 'none', borderRadius: '6px',
                          fontSize: '11px', fontWeight: matchMode === m.key ? 700 : 500, cursor: 'pointer',
                          fontFamily: 'Merriweather, serif', boxShadow: matchMode === m.key ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <div style={{ fontSize: '40px', fontWeight: 700, color: '#2D3DCA', fontFamily: 'Merriweather, serif', lineHeight: 1 }}>
                      {agreementPct}%
                    </div>
                    <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                      agreement on {comparison.shared.length} shared question{comparison.shared.length !== 1 ? 's' : ''}
                    </div>
                  </div>

                {(sharedBadges.length > 0 || onlyMyBadges.length > 0 || onlyTheirBadges.length > 0) && (
                <div style={{ marginBottom: '1.5rem' }}>
                  {sharedBadges.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.5rem', textAlign: 'center' }}>
                        Badges you both have
                      </div>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        {sharedBadges.map(b => (
                          <span key={b} title={b} style={{ fontSize: '22px' }}>{BADGE_EMOJI[b] || '🏅'}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(onlyMyBadges.length > 0 || onlyTheirBadges.length > 0) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', marginBottom: '0.4rem', textAlign: 'center' }}>
                          Just you
                        </div>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          {onlyMyBadges.length > 0
                            ? onlyMyBadges.map(b => (
                                <span key={b} title={b} style={{ fontSize: '18px' }}>{BADGE_EMOJI[b] || '🏅'}</span>
                              ))
                            : <span style={{ fontSize: '11px', color: '#6B7280' }}>—</span>}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', marginBottom: '0.4rem', textAlign: 'center' }}>
                          Just {getDisplayName(comparison.otherProfile)}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          {onlyTheirBadges.length > 0
                            ? onlyTheirBadges.map(b => (
                                <span key={b} title={b} style={{ fontSize: '18px' }}>{BADGE_EMOJI[b] || '🏅'}</span>
                              ))
                            : <span style={{ fontSize: '11px', color: '#6B7280' }}>—</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.5rem' }}>
                    {Object.entries(byDomain).map(([domain, stats]) => (
                      <div key={domain} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0', borderBottom: '0.5px solid #F3F4F6' }}>
                        <span style={{ color: '#1A1A1A', textTransform: 'capitalize' }}>{domain}</span>
                        <span style={{ color: '#6B7280' }}>{stats.agree}/{stats.total} agree</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {comparison.shared.map(s => {
                      const isAgree = agrees(s.mine, s.theirs, matchMode)
                      return (
                        <div key={s.questionId} style={{ background: '#FFFFFF', border: isAgree ? '1px solid #eef3e0' : '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}>
                          <div style={{ fontSize: '13px', color: '#1A1A1A', marginBottom: '8px', lineHeight: 1.4 }}>
                            {s.question.text}
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', background: VOTE_COLORS[s.mine] + '20', color: VOTE_COLORS[s.mine], fontWeight: 500 }}>
                              You: {VOTE_LABELS[s.mine]}
                            </span>
                            <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', background: VOTE_COLORS[s.theirs] + '20', color: VOTE_COLORS[s.theirs], fontWeight: 500 }}>
                              Them: {VOTE_LABELS[s.theirs]}
                            </span>
                            {isAgree && (
                              <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#4d621d', fontWeight: 700 }}>
                                ✓ agree
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              <button
                onClick={startNewComparison}
                style={{ width: '100%', marginTop: '1.5rem', padding: '10px', background: '#F3F4F6', color: '#2D3DCA', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
              >
                Compare with someone else
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
