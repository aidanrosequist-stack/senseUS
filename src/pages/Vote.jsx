import { useNavigate } from 'react-router-dom'
import BottomNav from '../components/layout/BottomNav'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuestions } from '../hooks/useQuestions'
import QuestionFlow from '../components/vote/QuestionFlow'

export default function Vote() {
  const { user } = useAuth()
  const { questions, loading, error } = useQuestions(user?.id)
  const navigate = useNavigate()

  async function handleVote(questionId, choice, tally) {
    if (!user) return

    const total = tally.yes + tally.ly + tally.ln + tally.no
    const pctYes = total > 0 ? Math.round(((tally.yes + tally.ly) / total) * 100) : 0
    const pctNo = 100 - pctYes

    const { error: voteError } = await supabase
      .from('votes')
      .upsert({
        user_id: user.id,
        question_id: questionId,
        choice,
        integrity_weight_at_vote: 1.0000,
        pct_yes_at_vote: pctYes,
        pct_no_at_vote: pctNo,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,question_id' })

    if (voteError) console.error('Vote error:', voteError)

    // Increment answers_count on profile
    await supabase.rpc('increment_answers_count', { user_id: user.id })
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px',
        paddingBottom: '74px',
        boxSizing: 'border-box',
      }}
    >
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
        />
      </div>
      <BottomNav />
    </div>
  )
}