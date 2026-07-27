import BottomNav from '../components/layout/BottomNav'
import Header from '../components/layout/Header'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuestions } from '../hooks/useQuestions'
import QuestionFlow from '../components/vote/QuestionFlow'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'

export default function Vote() {
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

    async function fetchTargetQuestion() {
      const { data } = await supabase
        .from('questions')
        .select('id, text, category, domain, is_tracking_anchor, geo_scope')
        .eq('id', targetQuestionId)
        .single()

      if (data) {
        const { data: tallyRow } = await supabase
          .rpc('get_vote_tally', { p_question_id: targetQuestionId })
          .single()

        const counts = tallyRow
          ? { yes: tallyRow.yes, ly: tallyRow.ly, ln: tallyRow.ln, no: tallyRow.no }
          : { yes: 0, ly: 0, ln: 0, no: 0 }

        setTargetQuestion({ ...data, votes: counts, replyCount: 0 })
      }
    }

    fetchTargetQuestion()
  }, [targetQuestionId, user])

  async function handleVote(questionId, choice, tally) {
    if (!user) return null

    // integrity_weight_at_vote and pct_yes_at_vote/pct_no_at_vote are no
    // longer computed here — the secure_vote_fields_trigger on the votes
    // table overwrites both server-side on every insert/update, so the
    // client can no longer influence a vote's weight or recorded tally
    // snapshot. See migration 007_secure_vote_fields.sql.

    const { data: existingVote } = await supabase
      .from('votes')
      .select('id')
      .eq('user_id', user.id)
      .eq('question_id', questionId)
      .single()

    const isNewVote = !existingVote

    const { error: voteError } = await supabase
      .from('votes')
      .upsert({
        user_id: user.id,
        question_id: questionId,
        choice,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,question_id' })

    if (voteError) {
      console.error('Vote error:', voteError)
      throw new Error('Your vote could not be saved. Please check your connection and try again.')
    }

    if (isNewVote) {
      await supabase.rpc('increment_answers_count', { user_id: user.id })
    }

    const { data: freshTally } = await supabase
      .rpc('get_vote_tally', { p_question_id: questionId })
      .single()

    return freshTally
      ? { yes: freshTally.yes, ly: freshTally.ly, ln: freshTally.ln, no: freshTally.no }
      : { yes: 0, ly: 0, ln: 0, no: 0 }
  }
  
  async function handleHideQuestion(questionId) {
    if (!user) return
    await supabase.from('question_skips').insert({ user_id: user.id, question_id: questionId })
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading questions...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#7a1313' }}>
        Error loading questions. Please try again.
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
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
      <Header />
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
          borderRadius: '20px',
          overflow: 'hidden',
          border: '0.5px solid #E5E7EB',
          boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
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
      <BottomNav />
    </div>
    </div>
  )
}