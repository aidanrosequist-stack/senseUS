import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import VoteCard from './VoteCard'
import ResultsCard from './ResultsCard'

export default function QuestionFlow({ questions, onVote, onHideQuestion, targetQuestionId, targetQuestion, initialVoteForTarget }) {
  const navigate = useNavigate()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [extraQuestion, setExtraQuestion] = useState(null)
  const [view, setView] = useState('voting') // 'voting' | 'results'
  const [userVote, setUserVote] = useState(null)
  const [tallies, setTallies] = useState({})
  const [changingVote, setChangingVote] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [voteError, setVoteError] = useState(null)
  const skipHistory = useRef([])
  const swipeStart = useRef(null)

  useEffect(() => {
    if (!targetQuestionId) return

    const idx = questions.findIndex(q => q.id === targetQuestionId)
    if (idx >= 0) {
      setCurrentIndex(idx)
    } else if (targetQuestion) {
      // Question not in feed (already voted) — inject it at the front
      setExtraQuestion(targetQuestion)
      setCurrentIndex(0)
    }
  }, [targetQuestionId, questions, targetQuestion])

  const currentQuestion = (extraQuestion && currentIndex === 0) ? extraQuestion : questions[currentIndex]
  const currentInitialZone = (extraQuestion && currentIndex === 0) ? initialVoteForTarget : null

  function getTallyFor(question) {
    return tallies[question.id] || question.votes || { yes: 0, ly: 0, ln: 0, no: 0 }
  }

  async function handleVote(value) {
    const tally = getTallyFor(currentQuestion)

    setSubmitting(true)
    setVoteError(null)

    const isChange = userVote !== null

    try {
      let freshTally = null
      if (onVote) {
        freshTally = await onVote(currentQuestion.id, value, tally)
      }

      // Only now — after the save is confirmed — update local state and transition
      if (!isChange) {
        const updatedTally = freshTally || { ...tally, [value]: (tally[value] || 0) + 1 }
        setTallies((prev) => ({ ...prev, [currentQuestion.id]: updatedTally }))
      } else if (freshTally) {
        setTallies((prev) => ({ ...prev, [currentQuestion.id]: freshTally }))
      }

      setUserVote(value)
      setView('results')
    } catch (err) {
      setVoteError(err.message || 'Something went wrong saving your vote. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSkip() {
    if (submitting) return
    skipHistory.current.push(currentIndex)
    advance()
  }

  function handleHideQuestion() {
    if (submitting) return
    if (onHideQuestion) onHideQuestion(currentQuestion.id)
    advance()
  }

  function handleSwipeDownRecover() {
    if (view !== 'voting') return // can't recover once viewing results
    const last = skipHistory.current.pop()
    if (last !== undefined) {
      setCurrentIndex(last)
    }
  }

  function advance() {
    setExtraQuestion(null)
    setUserVote(null)
    setVoteError(null)
    setView('voting')
    setCurrentIndex((prev) => Math.min(prev + 1, questions.length))
  }

  function handleJoinConversation() {
    navigate(`/conversation/${currentQuestion.id}`)
  }

  function handleTouchStart(e) {
    swipeStart.current = e.touches[0].clientY
  }

  function handleTouchEnd(e) {
    if (swipeStart.current === null) return
    const dy = e.changedTouches[0].clientY - swipeStart.current
    if (dy > 70 && view === 'voting') {
      handleSwipeDownRecover()
    }
    swipeStart.current = null
  }

  if (!currentQuestion) return null

  if (currentIndex >= questions.length) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 500, color: '#1A1A1A', marginBottom: '0.5rem' }}>
          You've answered every available question right now
        </div>
        <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1.25rem' }}>Check back soon for more questions.</p>
        <button
          onClick={() => navigate('/explore')}
          style={{ padding: '10px 20px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
        >
          Browse Explore instead
        </button>
      </div>
    )
  }

  return (
    <div
      style={{ width: '100%', height: '100%' }}
      onWheel={(e) => {
        if (e.deltaY < -30) handleSwipeDownRecover()
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {view === 'voting' && (
        <VoteCard
          key={currentQuestion.id}
          question={currentQuestion}
          onVote={handleVote}
          onSkip={handleSkip}
          onHideQuestion={handleHideQuestion}
          onMakeUpMyMind={() => navigate(`/make-up-my-mind/${currentQuestion.id}`)}
          onViewConversation={() => navigate(`/conversation/${currentQuestion.id}`)}
          showHint={currentIndex === 0}
          initialZone={currentInitialZone || userVote}
          changingVote={changingVote}
          submitting={submitting}
          voteError={voteError}
          onDismissError={() => setVoteError(null)}
        />
      )}
      {view === 'results' && (
        <ResultsCard
          question={currentQuestion}
          userVote={userVote}
          tally={getTallyFor(currentQuestion)}
          onJoinConversation={handleJoinConversation}
          onNext={advance}
          onChangeVote={() => { setChangingVote(true); setView('voting') }}
        />
      )}
    </div>
  )
}
