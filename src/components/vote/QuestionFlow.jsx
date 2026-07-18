import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import VoteCard from './VoteCard'
import ResultsCard from './ResultsCard'

export default function QuestionFlow({ questions , onVote }) {
  const navigate = useNavigate()
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (targetQuestionId) {
      const idx = questions.findIndex(q => q.id === targetQuestionId)
      return idx >= 0 ? idx : 0
    }
    return 0
  })
  const [view, setView] = useState('voting') // 'voting' | 'results'
  const [userVote, setUserVote] = useState(null)
  const [tallies, setTallies] = useState({})
  const skipHistory = useRef([])

  const currentQuestion = questions[currentIndex]

  function getTallyFor(question) {
    return tallies[question.id] || question.votes || { yes: 0, leaning_yes: 0, leaning_no: 0, no: 0 }
  }

  function handleVote(value) {
    const tally = getTallyFor(currentQuestion)

    if (value === 'undecided') {
      setUserVote('undecided')
      setTallies((prev) => ({ ...prev, [currentQuestion.id]: tally }))
      setView('results')
      return
    }

    const updatedTally = { ...tally, [value]: (tally[value] || 0) + 1 }
    setTallies((prev) => ({ ...prev, [currentQuestion.id]: updatedTally }))
    setUserVote(value)
    setView('results')
    skipHistory.current = []

    // Write to Supabase
    if (onVote) {
      onVote(currentQuestion.id, value, tally)
    }
  }

  function handleSkip() {
    skipHistory.current.push(currentIndex)
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
    setUserVote(null)
    setView('voting')
    setCurrentIndex((prev) => Math.min(prev + 1, questions.length))
  }

  function handleJoinConversation() {
    navigate(`/conversation/${currentQuestion.id}`)
  }

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
        <p style={{ fontSize: '13px', color: '#6B7280' }}>Check back soon for more questions.</p>
      </div>
    )
  }

  const swipeStart = useRef(null)

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
          question={currentQuestion}
          onVote={handleVote}
          onSkip={handleSkip}
          onMakeUpMyMind={() => navigate(`/make-up-my-mind/${currentQuestion.id}`)}
          onViewConversation={() => navigate(`/conversation/${currentQuestion.id}`)}
          showHint={currentIndex === 0}
          initialZone={userVote}
        />
      )}
      {view === 'results' && (
        <ResultsCard
          question={currentQuestion}
          userVote={userVote}
          tally={getTallyFor(currentQuestion)}
          onJoinConversation={handleJoinConversation}
          onNext={advance}
          onChangeVote={() => setView('voting')}
        />
      )}
    </div>
  )
}