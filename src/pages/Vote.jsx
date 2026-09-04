import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuestions } from '../hooks/useQuestions'
import QuestionFlow from '../components/vote/QuestionFlow'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { HEADER_HEIGHT_PX } from '../components/layout/Header'
import VisuallyHidden from '../components/ui/VisuallyHidden'
import { usePageTitle } from '../hooks/usePageTitle'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function Vote() {
  usePageTitle('Vote')
  const { user } = useAuth()
  const { questions, loading, error, usingFallbackPool } = useQuestions(user?.id)
  const [showGlobalNotice, setShowGlobalNotice] = useState(
    usingFallbackPool && localStorage.getItem('senseus_seen_global_notice') !== 'true'
  )
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const targetQuestionId = searchParams.get('question')
  const currentVoteParam = searchParams.get('currentVote')
  const location = useLocation()
  const from = location.state?.from || '/vote'
  const [targetQuestion, setTargetQuestion] = useState(null)
  
  useEffect(() => {
    if (!targetQuestionId || !user) return

    // A deep link like /vote?question=<id> (shares, "change your vote",
    // notifications) used to always fetch that question separately, even
    // when it's already sitting in the batch useQuestions just loaded —
    // the common case for a freshly shared, still-unanswered question.
    // Skip the extra round trip when it's already there.
    if (questions.some(q => q.id === targetQuestionId)) return

    async function fetchTargetQuestion() {
      const { data } = await supabase
        .from('questions')
        .select('id, text, category, domain, geo_scope, question_number, is_sponsored')
        .eq('id', targetQuestionId)
        .single()

      if (data) {
        const { data: tallyRow } = await supabase
          .rpc('get_vote_tally', { p_question_id: targetQuestionId })
          .single()

        const counts = tallyRow
          ? { yes: tallyRow.yes, ly: tallyRow.ly, ln: tallyRow.ln, no: tallyRow.no }
          : { yes: 0, ly: 0, ln: 0, no: 0 }

        let sponsorName = null
        if (data.is_sponsored) {
          const { data: sponsor } = await supabase
            .from('public_sponsors')
            .select('sponsor_name')
            .eq('question_id', targetQuestionId)
            .maybeSingle()
          sponsorName = sponsor?.sponsor_name || null
        }

        setTargetQuestion({ ...data, votes: counts, replyCount: 0, sponsor_name: sponsorName })
      }
    }

    fetchTargetQuestion()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user?.id, not the user object, is the real dependency (see ProtectedRoute.jsx for the same pattern). AuthContext hands out a new user object reference on every onAuthStateChange firing, including Supabase's routine hourly token refresh.
  }, [targetQuestionId, user?.id, questions])

  async function handleVote(questionId, choice) {
    if (!user) return null

    // integrity_weight_at_vote and pct_yes_at_vote/pct_no_at_vote are no
    // longer computed here — the secure_vote_fields_trigger on the votes
    // table overwrites both server-side on every insert/update, so the
    // client can no longer influence a vote's weight or recorded tally
    // snapshot. See migration 007_secure_vote_fields.sql.
    //
    // This used to be up to four sequential round trips: a SELECT to
    // check for an existing vote (just to know whether to increment
    // answers_count), the upsert itself, a conditional increment RPC,
    // then a separate tally refetch. Casting a vote is the single
    // most-repeated action in the app, so that's now one round trip via
    // cast_vote, which does all four steps server-side in one
    // transaction and returns the fresh tally directly. See migration
    // 017_cast_vote_rpc.sql.
    const { data: freshTally, error: voteError } = await supabase
      .rpc('cast_vote', { p_question_id: questionId, p_choice: choice })
      .single()

    if (voteError) {
      console.error('Vote error:', voteError)
      throw new Error('Your vote could not be saved. Please check your connection and try again.')
    }

    // cast_vote() rejects a vote fired under 1 second after the same
    // user's last one (any question) by returning normally with
    // rejected_reason set, rather than raising — see migration
    // 055_cast_vote_cooldown.sql for why it's a return value here and
    // not a thrown Postgres exception. Surface it as a distinct message
    // rather than lumping it in with an actual save failure.
    if (freshTally?.rejected_reason === 'cooldown') {
      throw new Error("You're voting a little too fast — give it a second and try again.")
    }

    // A question can be pulled from moderation after it was already loaded
    // into this client's feed (or reached via a deep link/stale tab) — see
    // migration 071_pull_question_moderation.sql. cast_vote() rejects the
    // attempt the same way it rejects a cooldown (return normally with
    // rejected_reason set, not a thrown exception, so the block itself
    // still logs durably) rather than silently recording nothing.
    if (freshTally?.rejected_reason === 'question_pulled') {
      throw new Error('This question is no longer available.')
    }

    return freshTally
      ? { yes: freshTally.yes, ly: freshTally.ly, ln: freshTally.ln, no: freshTally.no }
      : { yes: 0, ly: 0, ln: 0, no: 0 }
  }
  
  async function handleHideQuestion(questionId) {
    if (!user) return
    const { error } = await supabase.from('question_skips').insert({ user_id: user.id, question_id: questionId })
    if (error) {
      console.error('Hide question error:', error)
      throw new Error('This question could not be hidden. Please try again.')
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100dvh - ${HEADER_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        <LoadingSpinner label="Loading questions..." />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100dvh - ${HEADER_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#7a1313' }}>
        Error loading questions. Please try again.
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        // This used to be a flat 100dvh, sized on the assumption that
        // Header was rendered inside this same div (its old first child).
        // Now Header lives above this in AppShell, so this div only gets
        // the rest of the viewport underneath it — hence the subtraction.
        height: `calc(100dvh - ${HEADER_HEIGHT_PX}px)`,
        background: '#C7C7CC',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '0',
        paddingBottom: '74px',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <VisuallyHidden as="h1">Vote</VisuallyHidden>
      {showGlobalNotice && (
        <div style={{ position: 'absolute', top: '60px', left: '16px', right: '16px', background: '#2D3DCA', color: 'white', borderRadius: '10px', padding: '12px 14px', fontSize: '13px', fontFamily: 'Merriweather, serif', zIndex: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <span>You've answered everything from your country and around the world — now showing questions from other countries too.</span>
          <button
            onClick={() => {
              localStorage.setItem('senseus_seen_global_notice', 'true')
              setShowGlobalNotice(false)
            }}
            style={{ background: 'none', border: 'none', color: 'white', fontSize: '18px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}
      <div style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px',
        boxSizing: 'border-box',
      }}>
      {from !== '/vote' && (
        <button
          onClick={() => navigate(from)}
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            background: 'rgba(255,255,255,0.85)',
            border: 'none',
            borderRadius: '20px',
            padding: '6px 14px',
            fontSize: '12px',
            color: '#1A1A1A',
            cursor: 'pointer',
            fontFamily: 'Merriweather, serif',
            zIndex: 10,
          }}
        >
          ← back
        </button>
      )}
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          height: '100%',
          maxHeight: '760px',
          borderRadius: 'var(--senseus-card-radius)',
          overflow: 'hidden',
          border: '0.5px solid #E5E7EB',
          boxShadow: 'var(--senseus-card-shadow)',
          background: '#FFFFFF',
          boxSizing: 'border-box',
        }}
      >
        <QuestionFlow
          questions={questions}
          onVote={handleVote}
          onHideQuestion={handleHideQuestion}
          targetQuestionId={targetQuestionId}
          targetQuestion={targetQuestion}
          initialVoteForTarget={currentVoteParam}
        />
      </div>
    </div>
    </div>
  )
}