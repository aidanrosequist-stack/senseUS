import { useState, useEffect, useCallback } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import PartyMiniCard from '../components/party/PartyMiniCard'
import ConfettiBurst from '../components/ui/ConfettiBurst'
import { playSound } from '../lib/sound'

// migration: 095/097/098/099_question_parties — the "?Party" invite/vote/
// results page, reached via the link create_party()/join_party() hand out
// (https://senseus.app/party/:token).
//
// REBUILT 2026-11-01 around the new backend (098/099), after discussing
// at length with Aidan (see claude/senseUS-question-party-feature-notes.md):
//   - get_party_preview(token): thin pre-join read, unchanged in shape.
//   - get_party_voting_state(party_id): the caller's own curated questions
//     + their own existing votes only — backs the editable mini-card list.
//   - get_party_results(token): the N-way breakdown, now self-triggering
//     the lazy "is everyone actually done" completion check on every call
//     and withholding question-level rows entirely until the party is no
//     longer 'open' — so calling it is always safe, and its own returned
//     party_status is the one authoritative signal for which view to show.
//   - submit_party_answers(party_id): the mini-card page's "I'm done"
//     button. Leaving a question blank is allowed by design (no forced
//     skip) — a confirm prompt below just makes sure that was intentional.
//
// Voting itself goes straight through the same cast_vote()/retract_vote()
// RPCs the regular VoteCard uses (migration 099) — tapping an
// already-selected stance again un-casts it, same as VoteCard.

const JOIN_REJECTION_MESSAGES = {
  rate_limited: "You're trying that a little too fast — give it a second and try again.",
  not_found: 'This party invite could not be found.',
  already_closed: 'This party is no longer open.',
  expired: 'This party invite has expired.',
  party_full: 'This party is already full.',
}

const RESULT_COLORS = { yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f' }
const RESULT_LABELS = { yes: 'yes', ly: 'leaning yes', ln: 'leaning no', no: 'no' }

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

// Per-question aggregate bar — same visual language as Conversation.jsx's
// breakdown bar and ResultsCard's yes/no hero, condensed for a list
// context. Per Aidan: "a bar... that shows 3 people voted yes and 3
// people voted no, and a percentage, for each question."
function AggregateBar({ answers }) {
  const tally = { yes: 0, ly: 0, ln: 0, no: 0 }
  for (const a of answers) {
    if (a.choice && tally[a.choice] !== undefined) tally[a.choice]++
  }
  const total = tally.yes + tally.ly + tally.ln + tally.no
  const yesTrue = tally.yes + tally.ly
  const noTrue = tally.ln + tally.no
  const yesPct = total > 0 ? Math.round((yesTrue / total) * 100) : 0

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ width: '100%', height: '8px', borderRadius: '4px', overflow: 'hidden', display: 'flex', background: '#F1F1F1' }}>
        {['yes', 'ly', 'ln', 'no'].map(key => (
          <div key={key} style={{ width: total > 0 ? `${(tally[key] / total) * 100}%` : '25%', background: RESULT_COLORS[key], flexShrink: 0 }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#6B7280', marginTop: '3px' }}>
        <span>{yesTrue} voted yes</span>
        <span>{total > 0 ? `${yesPct}%` : '—'}</span>
        <span>{noTrue} voted no</span>
      </div>
    </div>
  )
}

// "Most agreement" / "Biggest split" results callout -- per Aidan's
// 2026-11-02 brainstorm ask, computed purely client-side from the same
// resultsQuestions the page already has (no backend change). Agreement
// groups yes/ly as one side and ln/no as the other, same grouping
// AggregateBar already uses -- agreementPct is how lopsided that split
// is, so 1.0 is unanimous and 0.5 is a dead-even split.
//
// A question nobody actually answered can't score either way, so it's
// excluded outright. Below 2 scoreable questions there's nothing
// meaningful to contrast, so both highlights are withheld. "Biggest
// split" additionally needs >=2 answers on that question (a single lone
// answer is 100% "agreement" by definition, never a split), and if it
// would otherwise land on the exact same question as "most agreement"
// (every question tied, or only one question clears that bar), it's
// dropped rather than shown twice.
function computeResultHighlights(questions) {
  const scored = questions
    .map(q => {
      const tally = { yes: 0, ly: 0, ln: 0, no: 0 }
      for (const a of q.answers) {
        if (a.choice && tally[a.choice] !== undefined) tally[a.choice]++
      }
      const total = tally.yes + tally.ly + tally.ln + tally.no
      if (total === 0) return null
      const yesSide = tally.yes + tally.ly
      const noSide = tally.ln + tally.no
      return { question: q, total, agreementPct: Math.max(yesSide, noSide) / total }
    })
    .filter(Boolean)

  if (scored.length < 2) return { mostAgreement: null, biggestSplit: null }

  const mostAgreement = scored.reduce((best, s) => (s.agreementPct > best.agreementPct ? s : best))

  const splitCandidates = scored.filter(s => s.total >= 2)
  const biggestSplit = splitCandidates.length > 0
    ? splitCandidates.reduce((best, s) => (Math.abs(s.agreementPct - 0.5) < Math.abs(best.agreementPct - 0.5) ? s : best))
    : null

  if (biggestSplit && biggestSplit.question.question_id === mostAgreement.question.question_id) {
    return { mostAgreement, biggestSplit: null }
  }

  return { mostAgreement, biggestSplit }
}

export default function Party() {
  usePageTitle('?Party!')
  const { token } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [preview, setPreview] = useState(null)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  // 'voting' — mini-card list (party still open); 'results' — the N-way
  // breakdown (completed or expired). get_party_results' own returned
  // party_status is the single source of truth for which one applies —
  // see the file header comment on why that's always safe to call.
  const [mode, setMode] = useState(null)
  const [votingMeta, setVotingMeta] = useState(null) // { capacity, participantCount, expiresAt, alreadySubmitted }
  const [votingQuestions, setVotingQuestions] = useState([]) // [{ question_id, question_number, question_text, question_category, my_choice }]
  const [resultsMeta, setResultsMeta] = useState(null) // { partyStatus, expiresAt, completedAt }
  const [resultsQuestions, setResultsQuestions] = useState([]) // [{ question_id, ..., answers: [...] }]
  const [submitting, setSubmitting] = useState(false)
  const [voteError, setVoteError] = useState(null)

  const loadPartyData = useCallback(async (partyId, p_token) => {
    const { data: resultsData, error: resultsErr } = await supabase.rpc('get_party_results', { p_token })

    if (resultsErr || !resultsData || resultsData.length === 0) {
      setMode('voting')
      return
    }

    if (resultsData[0].party_status !== 'open') {
      setResultsMeta({
        partyStatus: resultsData[0].party_status,
        partyName: resultsData[0].party_name,
        expiresAt: resultsData[0].expires_at,
        completedAt: resultsData[0].completed_at,
      })

      const byQuestion = new Map()
      for (const row of resultsData) {
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
      setResultsQuestions([...byQuestion.values()])
      setMode('results')
      return
    }

    // Still genuinely open — load the editable voting state.
    const { data: votingData, error: votingErr } = await supabase.rpc('get_party_voting_state', { p_party_id: partyId })

    if (votingErr || !votingData || votingData.length === 0) {
      setMode('voting')
      return
    }

    setVotingMeta({
      capacity: votingData[0].capacity,
      partyName: votingData[0].party_name,
      participantCount: votingData[0].participant_count,
      expiresAt: votingData[0].expires_at,
      alreadySubmitted: votingData[0].already_submitted,
    })
    setVotingQuestions(votingData.map(r => ({
      question_id: r.question_id,
      question_number: r.question_number,
      question_text: r.question_text,
      question_category: r.question_category,
      my_choice: r.my_choice,
    })))
    setMode('voting')
  }, [])

  useEffect(() => {
    async function load() {
      const { data: p } = await supabase.rpc('get_party_preview', { p_token: token }).maybeSingle()

      if (!p) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setPreview(p)

      if (p.already_joined) {
        await loadPartyData(p.party_id, token)
      }

      setLoading(false)
    }

    load()
  }, [token, loadPartyData])

  // Results-reveal cue (2026-11-02, per Aidan's brainstorm ask) — fires
  // once per time this page lands on a genuinely completed party's
  // results, confetti included below in the render itself. Deliberately
  // keyed to mode+status rather than a "have I already celebrated this
  // party" flag: revisiting a completed party is rare enough, and brief
  // enough, that re-playing the cue each time reads as a nice touch
  // rather than noise — easy to add a one-time-only guard later if it
  // doesn't land that way in practice. Expired parties get no cue —
  // nothing to celebrate about the clock running out on some unanswered
  // questions.
  useEffect(() => {
    if (mode === 'results' && resultsMeta?.partyStatus === 'completed') {
      playSound('celebrate')
    }
  }, [mode, resultsMeta?.partyStatus])

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
    await loadPartyData(data.party_id, token)
  }

  async function handleVote(questionId, choice) {
    setVoteError(null)
    const previous = votingQuestions
    setVotingQuestions(qs => qs.map(q => q.question_id === questionId ? { ...q, my_choice: choice } : q))

    const { error } = await supabase.rpc('cast_vote', { p_question_id: questionId, p_choice: choice })
    if (error) {
      setVotingQuestions(previous)
      setVoteError(error.message || "Couldn't save that vote — try again.")
    }
  }

  async function handleRetract(questionId) {
    setVoteError(null)
    const previous = votingQuestions
    setVotingQuestions(qs => qs.map(q => q.question_id === questionId ? { ...q, my_choice: null } : q))

    const { error } = await supabase.rpc('retract_vote', { p_question_id: questionId })
    if (error) {
      setVotingQuestions(previous)
      setVoteError(error.message || "Couldn't update that — try again.")
    }
  }

  function handleMakeUpMyMind(questionId) {
    navigate(`/make-up-my-mind/${questionId}`, { state: { from: 'party', partyToken: token } })
  }

  async function handleSubmit() {
    const unanswered = votingQuestions.filter(q => !q.my_choice).length
    if (unanswered > 0) {
      const proceed = window.confirm(
        `You left ${unanswered} question${unanswered === 1 ? '' : 's'} unanswered. Submit anyway?`
      )
      if (!proceed) return
    }

    setSubmitting(true)
    setVoteError(null)
    const { error } = await supabase.rpc('submit_party_answers', { p_party_id: preview.party_id })
    setSubmitting(false)

    if (error) {
      setVoteError(error.message || "Couldn't submit — try again.")
      return
    }

    await loadPartyData(preview.party_id, token)
  }

  async function sharePartyLink() {
    const url = `https://senseus.app/party/${token}`
    // Wording matches Activity.jsx's own createParty() share text exactly
    // -- see that file's own comment for the "called X" fallback reasoning.
    const trimmedPartyName = votingMeta?.partyName?.trim()
    const shareData = {
      title: 'senseUS',
      text: trimmedPartyName
        ? `I made a ?Party! called ${trimmedPartyName}, and want your input! Click here to accept and vote!`
        : 'I made a ?Party! and want your input! Click here to accept and vote!',
      url,
    }
    // Counts toward the sharing integrity-weight bonus the moment this
    // fires (migration 108) — same as every other Share button in the
    // app, regardless of whether the share sheet below is completed.
    supabase.rpc('claim_share').catch(() => {})
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

  // AppShell's <main> reserves Header/BottomNav's real heights via
  // padding (2026-11-01), so '100%' here lands on exactly the space
  // between them -- no page-local calc() needed.
  const pageStyle = {
    minHeight: '100%',
    boxSizing: 'border-box',
    background: '#C7C7CC',
    padding: '14px',
  }
  const cardStyle = {
    maxWidth: '560px',
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
          <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginTop: 0 }}>?Party!</h1>
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

  // Pre-join screen — deliberately thin (no question list, no votes),
  // matching get_party_preview()'s own restriction server-side.
  if (!preview?.already_joined) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginTop: 0, marginBottom: '0.5rem' }}>{preview.party_name || '?Party!'}</h1>
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

  // Joined, party still open — the mini-card voting list.
  if (mode === 'voting') {
    const isHostViewer = preview.host_display_name !== undefined && votingMeta?.participantCount != null
    const unansweredCount = votingQuestions.filter(q => !q.my_choice).length

    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{votingMeta?.partyName || '?Party!'}</h1>
            <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', background: '#E6F1FB', color: '#0C447C' }}>
              Open
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#6B7280', marginTop: 0, marginBottom: '1rem' }}>
            {votingMeta?.participantCount}/{votingMeta?.capacity} joined
            {votingMeta?.expiresAt && ` · expires in ${timeUntil(votingMeta.expiresAt)}`}
          </p>

          {isHostViewer && (
            <button
              onClick={sharePartyLink}
              style={{ width: '100%', marginBottom: '1rem', padding: '8px', background: '#F3F4F6', color: '#2D3DCA', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Invite more people to this party
            </button>
          )}

          {votingMeta?.alreadySubmitted && (
            <div style={{ background: '#F3F4F6', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#6B7280', marginBottom: '1rem' }}>
              You've submitted your answers — results will show here once everyone else has too. You can still change an answer below; just submit again afterward.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '1rem' }}>
            {votingQuestions
              .slice()
              .sort((a, b) => a.question_number - b.question_number)
              .map(q => (
                <PartyMiniCard
                  key={q.question_id}
                  question={q}
                  myChoice={q.my_choice}
                  onVote={(choice) => handleVote(q.question_id, choice)}
                  onRetract={() => handleRetract(q.question_id)}
                  onMakeUpMyMind={() => handleMakeUpMyMind(q.question_id)}
                />
              ))}
          </div>

          {voteError && (
            <p style={{ fontSize: '12px', color: '#991B1B', marginBottom: '10px' }}>{voteError}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{ width: '100%', padding: '11px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: submitting ? 'default' : 'pointer', fontFamily: 'Merriweather, serif', opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? 'Submitting…' : votingMeta?.alreadySubmitted ? 'Submit Again' : 'Submit'}
          </button>
          {unansweredCount > 0 && (
            <p style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'center', marginTop: '6px', marginBottom: 0 }}>
              {unansweredCount} question{unansweredCount === 1 ? '' : 's'} left blank
            </p>
          )}
        </div>
      </div>
    )
  }

  // Completed (or expired) — the combined results view: an aggregate bar
  // per question plus the existing per-individual breakdown underneath.
  const { mostAgreement, biggestSplit } = computeResultHighlights(resultsQuestions)

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{resultsMeta?.partyName || '?Party!'}</h1>
          <span style={{
            fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
            background: resultsMeta?.partyStatus === 'completed' ? '#eef3e0' : '#F3F4F6',
            color: resultsMeta?.partyStatus === 'completed' ? '#4d621d' : '#6B7280',
          }}>
            {resultsMeta?.partyStatus === 'completed' ? 'Completed' : 'Expired'}
          </span>
          {/* Confetti only for a genuinely completed party — see the
              results-reveal-cue effect above for why expired gets none. */}
          {resultsMeta?.partyStatus === 'completed' && <ConfettiBurst count={28} />}
        </div>
        <p style={{ fontSize: '12px', color: '#6B7280', marginTop: 0, marginBottom: '1.25rem' }}>
          {resultsMeta?.partyStatus === 'completed' && resultsMeta?.completedAt && `Completed ${timeAgo(resultsMeta.completedAt)}`}
          {resultsMeta?.partyStatus === 'expired' && 'This party expired before everyone finished — showing whoever made it in.'}
        </p>

        {mostAgreement && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.25rem' }}>
            <div style={{ background: '#eef3e0', border: '1px solid #4d621d', borderRadius: '10px', padding: '10px 14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#27500A', marginBottom: '3px' }}>
                🤝 Most agreement — {Math.round(mostAgreement.agreementPct * 100)}% in sync
              </div>
              <div style={{ fontSize: '12px', color: '#1A1A1A', lineHeight: 1.4 }}>{mostAgreement.question.question_text}</div>
            </div>
            {biggestSplit && (
              <div style={{ background: '#faf6d0', border: '1px solid #7a6b0e', borderRadius: '10px', padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#633806', marginBottom: '3px' }}>
                  ⚡ Biggest split
                </div>
                <div style={{ fontSize: '12px', color: '#1A1A1A', lineHeight: 1.4 }}>{biggestSplit.question.question_text}</div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {resultsQuestions
            .slice()
            .sort((a, b) => a.question_number - b.question_number)
            .map(q => (
              <div key={q.question_id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ fontSize: '11px', color: '#0C447C', background: '#E6F1FB', display: 'inline-block', padding: '2px 8px', borderRadius: '20px', marginBottom: '8px' }}>
                  {q.question_category}
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.4, marginBottom: '10px' }}>
                  {q.question_text}
                </div>

                <AggregateBar answers={q.answers} />

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
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: '#FFFFFF', border: `1.5px solid ${RESULT_COLORS[a.choice]}`, color: RESULT_COLORS[a.choice] }}>
                            {RESULT_LABELS[a.choice]}
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#9CA3AF' }}>left blank</span>
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
