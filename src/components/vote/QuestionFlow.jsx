import { useState, useRef } from 'react'
import VoteCard from './VoteCard'
import ResultsCard from './ResultsCard'

export default function QuestionFlow({ questions }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [view, setView] = useState('voting') // 'voting' | 'results'
  const [userVote, setUserVote] = useState(null)
  const [tallies, setTallies] = useState({})
  const skipHistory = useRef([])

  const currentQuestion = questions[currentIndex]

  function getTallyFor(question) {
    return tallies[question.id] || question.votes || { yes: 0, leaning_yes: 0, leaning_no: 0, no: 0 }
  }

  function handleVote(value) {
    if (value === 'undecided') {
      // Undecided doesn't affect the yes/no spectrum tally, just advance after a brief beat
      setUserVote('undecided')
      const tally = getTallyFor(currentQuestion)
      setTallies((prev) => ({ ...prev, [currentQuestion.id]: tally }))
      setView('results')
      return
    }

    const tally = getTallyFor(currentQuestion)
    const updatedTally = { ...tally, [value]: tally[value] + 1 }
    setTallies((prev) => ({ ...prev, [currentQuestion.id]: updatedTally }))
    setUserVote(value)
    setView('results')

    // Once a vote is committed, this question can't be recovered via swipe-down
    skipHistory.current = []
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
    // Placeholder until comments/discussion feature is built
    console.log('Join conversation for question', currentQuestion.id)
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

  return (
    <div
      style={{ width: '100%', height: '100%' }}
      onWheel={(e) => {
        // Basic desktop testing aid: scroll up triggers swipe-down recovery
        if (e.deltaY < -30) handleSwipeDownRecover()
      }}
    >
      {view === 'voting' && (
        <VoteCard question={currentQuestion} onVote={handleVote} onSkip={handleSkip} />
      )}
      {view === 'results' && (
        <ResultsCard
          question={currentQuestion}
          userVote={userVote}
          tally={getTallyFor(currentQuestion)}
          onJoinConversation={handleJoinConversation}
          onNext={advance}
        />
      )}
    </div>
  )
}