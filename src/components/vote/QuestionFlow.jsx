import { useState, useRef, useEffect, useCallback } from 'react'
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
  const [submittingLabel, setSubmittingLabel] = useState('Saving your vote...')
  const skipHistory = useRef([])
  const swipeStart = useRef(null)
  // One-shot flag telling the next VoteCard mount to play its quiet
  // "settle in" entrance (see enterFromAbove in VoteCard.jsx) — set only
  // by a successful swipe-down recover, and cleared right after the
  // resulting question change commits so it doesn't leak into whatever
  // question comes after (a normal forward skip/advance shouldn't play
  // this animation).
  const [enterFromAbove, setEnterFromAbove] = useState(false)
  // One-shot celebration for a user's very first successful vote ever on
  // the account (see handleVote below). Used to be gated purely by a
  // localStorage flag — simple, but per-device, so it re-fired the first
  // time someone voted from a second device/browser even though their
  // account had already voted before. As of migration 073, cast_vote()
  // itself returns whether this call was a genuine new vote and the
  // account's running distinct-questions-voted count, so this is now
  // authoritative and account-wide with no extra round trip.
  const [firstVoteToShow, setFirstVoteToShow] = useState(false)

  useEffect(() => {
    if (!targetQuestionId) return

    const idx = questions.findIndex(q => q.id === targetQuestionId)
    if (idx >= 0) {
      setCurrentIndex(idx)
    } else if (targetQuestion) {
      // Question not in feed (already voted) — inject it at the front
      // eslint-disable-next-line react-hooks/set-state-in-effect -- injecting a question not present in the main feed; genuinely depends on the async fetch result, not derivable during render
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
    setSubmittingLabel('Saving your vote...')
    setVoteError(null)

    const isChange = userVote !== null

    try {
      let freshTally = null
      if (onVote) {
        freshTally = await onVote(currentQuestion.id, value, tally)
      }

      // wasNewVote/answersCount (migration 073) ride along on freshTally
      // just for this check — pulled off here so only the actual
      // yes/ly/ln/no counts ever land in the tallies cache below.
      const wasNewVote = freshTally?.wasNewVote
      const answersCount = freshTally?.answersCount
      const tallyCounts = freshTally ? { yes: freshTally.yes, ly: freshTally.ly, ln: freshTally.ln, no: freshTally.no } : null

      // Only now — after the save is confirmed — update local state and transition
      if (!isChange) {
        const updatedTally = tallyCounts || { ...tally, [value]: (tally[value] || 0) + 1 }
        setTallies((prev) => ({ ...prev, [currentQuestion.id]: updatedTally }))
      } else if (tallyCounts) {
        setTallies((prev) => ({ ...prev, [currentQuestion.id]: tallyCounts }))
      }

      // Authoritative now (migration 073), not a localStorage guess:
      // wasNewVote means this call genuinely inserted a new vote row
      // (not a change to an existing one — closing a gap the old
      // isChange-only check had for someone deep-linking in to change
      // their one-and-only vote, see that migration's own comment), and
      // answersCount === 1 means the account has never voted on any
      // other question either. Together, this can only ever be true once
      // per account, on any device — no need to gate it behind a
      // per-device flag anymore.
      if (wasNewVote && answersCount === 1) {
        setFirstVoteToShow(true)
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

  async function handleHideQuestion() {
    if (submitting) return

    setSubmitting(true)
    setSubmittingLabel('Hiding this question...')
    setVoteError(null)

    try {
      // Wait for the skip to actually be recorded before moving on — this
      // used to fire the insert and advance() in the same tick, so a
      // failed write (offline, RLS error, etc.) was invisible: the
      // question just moved on as if it had been hidden, and would keep
      // resurfacing since nothing was ever saved.
      if (onHideQuestion) await onHideQuestion(currentQuestion.id)
      advance()
    } catch (err) {
      setVoteError(err.message || 'This question could not be hidden. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSwipeDownRecover() {
    if (view !== 'voting') return // can't recover once viewing results
    const last = skipHistory.current.pop()
    if (last !== undefined) {
      setEnterFromAbove(true)
      setCurrentIndex(last)
    }
  }

  // Consumes the one-shot flag right after the question it was set for
  // has actually rendered (VoteCard reads enterFromAbove only at its own
  // mount, which happens before this effect runs, so it still sees
  // `true` for that one card) — this just prevents it from staying true
  // for whatever question comes after.
  useEffect(() => {
    if (enterFromAbove) setEnterFromAbove(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on currentQuestion, not enterFromAbove itself
  }, [currentQuestion])

  // Memoized so ResultsCard (which re-binds its touch-swipe listener
  // whenever its onNext prop changes identity) doesn't tear down and
  // re-add that native listener on every QuestionFlow re-render while
  // results are showing — only when questions.length actually changes.
  const advance = useCallback(() => {
    setExtraQuestion(null)
    setUserVote(null)
    setVoteError(null)
    setView('voting')
    setFirstVoteToShow(false)
    setCurrentIndex((prev) => Math.min(prev + 1, questions.length))
  }, [questions.length])

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

  // currentQuestion is undefined both when the feed is genuinely
  // exhausted (currentIndex has reached questions.length) and in a
  // couple of transient/defensive states that aren't that. These used
  // to be two separate top-level checks with the exhausted-feed message
  // written second — but currentQuestion is ALSO undefined in exactly
  // that case, so the earlier bare `if (!currentQuestion) return null`
  // always fired first and the dedicated "you've answered everything"
  // screen below was unreachable dead code; running out of questions
  // silently rendered a blank card instead of ever showing it. Nesting
  // the checks (exhausted-feed message takes priority whenever
  // currentQuestion is missing) fixes that while still falling back to
  // a bare `null` for any other transient undefined-question state.
  if (!currentQuestion) {
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
    return null
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
          onMakeUpMyMind={() => navigate(`/make-up-my-mind/${currentQuestion.id}`, { state: { from: 'vote' } })}
          onViewConversation={() => navigate(`/conversation/${currentQuestion.id}`)}
          showHint={currentIndex === 0}
          initialZone={currentInitialZone || userVote}
          enterFromAbove={enterFromAbove}
          changingVote={changingVote}
          submitting={submitting}
          submittingLabel={submittingLabel}
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
          firstVote={firstVoteToShow}
          onChangeVote={() => { setChangingVote(true); setView('voting') }}
        />
      )}
    </div>
  )
}
