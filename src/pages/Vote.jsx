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
  const { questions, loading, error } = useQuestions(user?.id)
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
    if (!user) return

    const total = tally.yes + tally.ly + tally.ln + tally.no
    const pctYes = total > 0 ? Math.round(((tally.yes + tally.ly) / total) * 100) : 0
    const pctNo = 100 - pctYes

    // Check if this is a new vote or a change, and get the user's current
    // integrity weight — run in parallel since they're independent
    const [{ data: existingVote }, { data: profile }] = await Promise.all([
      supabase
        .from('votes')
        .select('id')
        .eq('user_id', user.id)
        .eq('question_id', questionId)
        .single(),
      supabase
        .from('profiles')
        .select('integrity_weight')
        .eq('id', user.id)
        .single(),
    ])

    const isNewVote = !existingVote
    const currentWeight = profile?.integrity_weight ?? 1.0000

    const { error: voteError } = await supabase
      .from('votes')
      .upsert({
        user_id: user.id,
        question_id: questionId,
        choice,
        integrity_weight_at_vote: currentWeight,
        pct_yes_at_vote: pctYes,
        pct_no_at_vote: pctNo,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,question_id' })

    if (voteError) console.error('Vote error:', voteError)

    // Only increment answers_count for new votes, not changes
    if (isNewVote) {
      await supabase.rpc('increment_answers_count', { user_id: user.id })
    }

    // Fetch real tally from DB and update local state
    const { data: freshTally } = await supabase
      .rpc('get_vote_tally', { p_question_id: questionId })
      .single()

    if (freshTally) {
      return { yes: freshTally.yes, ly: freshTally.ly, ln: freshTally.ln, no: freshTally.no }
    }
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