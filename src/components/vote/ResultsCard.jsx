import { IconMessageCircle } from '@tabler/icons-react'
import { useRef, useEffect, useState } from 'react'

const VOTE_COLORS = {
  yes: '#6d8a1c',
  ly: '#d9c01a',
  ln: '#c2731f',
  no: '#c21f1f',
}

const VOTE_PILL_STYLES = {
  yes: { background: '#eef3e0', color: '#4d621d' },
  ly: { background: '#faf6d0', color: '#7a6b0e' },
  ln: { background: '#f9ead8', color: '#7a4513' },
  no: { background: '#f9d8d8', color: '#7a1313' },
  dec: { background: '#E6F1FB', color: '#0C447C' },
}

const VOTE_LABELS = {
  yes: 'yes',
  ly: 'leaning yes',
  ln: 'leaning no',
  no: 'no',
  dec: 'undecided',
}

// A light wash of each vote color, used as the results card's background —
// carries the color story forward from the vote card without the full
// saturation of the card you just came from.
const VOTE_WASH = {
  yes: '#F4F8EC',
  ly: '#FBF8E4',
  ln: '#FBF1E6',
  no: '#FBEAEA',
  dec: '#FFFFFF',
}

export default function ResultsCard({ question, userVote, tally, onJoinConversation, onNext, onChangeVote }) {
  const total = tally.yes + tally.ly + tally.ln + tally.no
  const yesTrue = tally.yes + tally.ly
  const noTrue = tally.ln + tally.no
  const pctYesTrue = total > 0 ? Math.round((yesTrue / total) * 100) : 50
  const pctNoTrue = 100 - pctYesTrue

  const segments = [
    { key: 'yes', value: tally.yes },
    { key: 'ly', value: tally.ly },
    { key: 'ln', value: tally.ln },
    { key: 'no', value: tally.no },
  ]

  const [yesDisplayed, setYesDisplayed] = useState(0)
  const [noDisplayed, setNoDisplayed] = useState(0)
  const [revealed, setRevealed] = useState(total === 0)
  const [checkmarkIn, setCheckmarkIn] = useState(false)

  const cardRef = useRef(null)
  const startY = useRef(0)

  // Checkmark scales in on mount / whenever a new question's results show
  useEffect(() => {
    setCheckmarkIn(false)
    const t = setTimeout(() => setCheckmarkIn(true), 60)
    return () => clearTimeout(t)
  }, [question.id])

  // The core reveal sequence: both sides count up together. Whichever side
  // is smaller finishes first and locks — that's the signal to morph the
  // bar from its neutral 50/50 placeholder into the real segmented split.
  // The leading side keeps counting until it reaches its own true total.
  useEffect(() => {
    setYesDisplayed(0)
    setNoDisplayed(0)
    setRevealed(total === 0)

    if (total === 0) return

    const targetTicks = 40
    const step = Math.max(1, Math.ceil(Math.max(yesTrue, noTrue, 1) / targetTicks))

    const interval = setInterval(() => {
      let yesDone = false
      let noDone = false

      setYesDisplayed(prev => {
        const next = Math.min(prev + step, yesTrue)
        yesDone = next >= yesTrue
        return next
      })
      setNoDisplayed(prev => {
        const next = Math.min(prev + step, noTrue)
        noDone = next >= noTrue
        return next
      })

      setRevealed(prevRevealed => {
        if (prevRevealed) return true
        if ((yesTrue <= noTrue && yesDone) || (noTrue <= yesTrue && noDone)) return true
        return prevRevealed
      })

      if (yesDone && noDone) {
        clearInterval(interval)
      }
    }, 35)

    return () => clearInterval(interval)
  }, [question.id, yesTrue, noTrue, total])

  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    function onTouchStart(e) {
      startY.current = e.touches[0].clientY
    }

    function onTouchEnd(e) {
      const dy = e.changedTouches[0].clientY - startY.current
      if (dy < -50) onNext()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [onNext])

  const totalDisplayed = yesDisplayed + noDisplayed
  const leaderKey = pctYesTrue >= pctNoTrue ? 'yes' : 'no'
  const leaderPct = leaderKey === 'yes' ? pctYesTrue : pctNoTrue
  const leaderColor = leaderKey === 'yes' ? '#4d6214' : '#8a1616'

  return (
    <div
      ref={cardRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        boxSizing: 'border-box',
        textAlign: 'center',
        overflowY: 'auto',
        background: VOTE_WASH[userVote] || '#FFFFFF',
        transition: 'background 0.4s ease',
      }}
    >
      <span
        style={{
          fontSize: '11px',
          fontWeight: 500,
          padding: '3px 10px',
          borderRadius: '20px',
          marginBottom: '0.75rem',
          background: '#E6F1FB',
          color: '#0C447C',
          display: 'inline-block',
        }}
      >
        {question.category}
      </span>

      <div
        style={{
          fontSize: '15px',
          fontWeight: 500,
          lineHeight: 1.4,
          fontFamily: 'Georgia, serif',
          color: '#1A1A1A',
          marginBottom: '1rem',
          width: '100%',
        }}
      >
        {question.text}
      </div>

      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: '#E9EFD9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '0.5rem',
          flexShrink: 0,
          transform: checkmarkIn ? 'scale(1)' : 'scale(0.4)',
          opacity: checkmarkIn ? 1 : 0,
          transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease',
        }}
      >
        <span style={{ color: VOTE_COLORS[userVote] || '#0C447C', fontSize: '18px' }}>&#10003;</span>
      </div>

      <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '4px' }}>
        you voted
      </div>

      <div
        style={{
          fontSize: '14px',
          fontWeight: 500,
          padding: '5px 14px',
          borderRadius: '20px',
          marginBottom: '1.25rem',
          display: 'inline-block',
          ...VOTE_PILL_STYLES[userVote],
        }}
      >
        {VOTE_LABELS[userVote]}
      </div>

      {/* Hero verdict — the actual payoff of voting */}
      <div style={{ marginBottom: '0.5rem' }}>
        <div style={{ fontSize: '40px', fontWeight: 700, fontFamily: 'Georgia, serif', color: leaderColor, lineHeight: 1 }}>
          {total > 0 ? `${revealed ? leaderPct : 50}%` : '—'}
        </div>
        <div style={{ fontSize: '12px', fontWeight: 500, color: leaderColor, letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: '2px' }}>
          {total > 0 ? leaderKey : 'no votes yet'}
        </div>
      </div>

      {/* Bar: neutral 50/50 placeholder during the count-up, morphs into the
          real segmented split the instant the underdog side locks in */}
      <div style={{ width: '100%', marginBottom: '0.5rem', boxSizing: 'border-box' }}>
        <div
          style={{
            width: '100%',
            height: '10px',
            borderRadius: '5px',
            overflow: 'hidden',
            display: 'flex',
            background: '#F1F1F1',
          }}
        >
          {revealed ? (
            segments.map((seg) => (
              <div
                key={seg.key}
                style={{
                  width: total > 0 ? `${(seg.value / total) * 100}%` : '25%',
                  background: VOTE_COLORS[seg.key],
                  flexShrink: 0,
                  transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            ))
          ) : (
            <>
              <div style={{ width: '50%', background: '#6d8a1c', opacity: 0.55, animation: 'senseus-pulse 1.1s ease-in-out infinite' }} />
              <div style={{ width: '50%', background: '#c21f1f', opacity: 0.55, animation: 'senseus-pulse 1.1s ease-in-out infinite' }} />
            </>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12px',
            marginTop: '4px',
            width: '100%',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ color: '#4d6214' }}>{yesDisplayed.toLocaleString()} yes</span>
          <span style={{ color: '#8a1616' }}>{noDisplayed.toLocaleString()} no</span>
        </div>
      </div>

      <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '0.5rem', fontVariantNumeric: 'tabular-nums' }}>
        {totalDisplayed.toLocaleString()} verified humans answered
      </div>
      <div style={{ fontSize: '10px', color: '#9CA3AF', marginBottom: '1.25rem', lineHeight: 1.5 }}>
        Results are integrity-weighted.{' '}
        <a href="/how-it-works" style={{ color: '#9CA3AF', textDecoration: 'underline' }}>Learn more</a>
      </div>

      <button
        onClick={onJoinConversation}
        style={{
          width: '100%',
          background: '#2D3DCA',
          color: '#FFFFFF',
          border: 'none',
          borderRadius: '8px',
          padding: '11px',
          fontSize: '13px',
          fontWeight: 500,
          marginBottom: '0.5rem',
          boxSizing: 'border-box',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '7px',
        }}
      >
        <IconMessageCircle size={16} color="white" />
        Join the conversation
      </button>

      <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '1rem' }}>
        {question.replyCount || 0} replies
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
        <div
          onClick={onNext}
          style={{
            fontSize: '12px',
            color: '#6B7280',
            cursor: 'pointer',
          }}
        >
          tap or swipe up for next question
        </div>
        <button
          onClick={onChangeVote}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '12px',
            color: '#9CA3AF',
            cursor: 'pointer',
            textDecoration: 'underline',
            fontFamily: 'Merriweather, serif',
          }}
        >
          Change my vote
        </button>
      </div>

      <style>{`
        @keyframes senseus-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.85; }
        }
      `}</style>
    </div>
  )
}
