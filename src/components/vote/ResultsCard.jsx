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
  /* eslint-disable react-hooks/set-state-in-effect -- resetting the checkmark animation on question change; the reveal sequence is inherently timing-based (setTimeout), not something to derive during render */
  useEffect(() => {
    setCheckmarkIn(false)
    const t = setTimeout(() => setCheckmarkIn(true), 60)
    return () => clearTimeout(t)
  }, [question.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Both sides count up in lockstep — same step size, same interval — so
  // they stay glued at 50/50 for as long as both are still climbing. The
  // moment the smaller side reaches its true total, it stops and the
  // leading side keeps climbing alone, which is what makes the percentages
  // (derived live from these two numbers, below) start to drift apart in
  // real time rather than jumping straight to their final values.
  /* eslint-disable react-hooks/set-state-in-effect -- resetting and driving the count-up reveal animation on question change; inherently timer-based (setInterval), not derivable during render */
  useEffect(() => {
    setYesDisplayed(0)
    setNoDisplayed(0)
    setRevealed(total === 0)

    if (total === 0) return

    const durationMs = 3000
    const intervalMs = 50
    const targetTicks = durationMs / intervalMs
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

      if (yesDone && noDone) {
        setRevealed(true)
        clearInterval(interval)
      }
    }, intervalMs)

    return () => clearInterval(interval)
  }, [question.id, yesTrue, noTrue, total])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function shareQuestion() {
    if (!question?.question_number) return
    const url = `https://senseus.app/q/${question.question_number}`
    const shareData = { title: 'senseUS', text: 'I just voted on this — what do you think?', url }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // User cancelled the share sheet — not an error, do nothing
      }
      return
    }

    try {
      await navigator.clipboard.writeText(url)
      alert('Link copied to clipboard!')
    } catch {
      prompt('Copy this link:', url)
    }
  }

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
  // Both percentages derive live from the two counters above — this is
  // what makes them sit at 50/50 during the tied phase and drift apart
  // in real time once the leader is climbing alone.
  const pctYesLive = totalDisplayed > 0 ? Math.round((yesDisplayed / totalDisplayed) * 100) : 50
  const pctNoLive = 100 - pctYesLive

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
        <span aria-hidden="true" style={{ color: VOTE_COLORS[userVote] || '#0C447C', fontSize: '18px' }}>&#10003;</span>
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

      {/* Head-to-head hero — both percentages ticking live, side by side */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: '2rem', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '36px', fontWeight: 700, fontFamily: 'Georgia, serif', color: '#4d6214', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {total > 0 ? `${pctYesLive}%` : '—'}
          </div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: '#4d6214', letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: '2px' }}>
            yes
          </div>
        </div>
        <div style={{ width: '1px', background: 'rgba(0,0,0,0.1)', alignSelf: 'stretch', marginTop: '4px' }} />
        <div>
          <div style={{ fontSize: '36px', fontWeight: 700, fontFamily: 'Georgia, serif', color: '#8a1616', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {total > 0 ? `${pctNoLive}%` : '—'}
          </div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: '#8a1616', letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: '2px' }}>
            no
          </div>
        </div>
      </div>

      {/* Bar: tracks the same live 50/50-then-drifting ratio as the
          percentages above, in flat yes/no color. Swaps to the real
          four-segment breakdown the instant both counters finish, at
          which point the widths already match exactly. */}
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
                }}
              />
            ))
          ) : (
            <>
              <div style={{ width: `${pctYesLive}%`, background: '#6d8a1c', transition: 'width 0.05s linear' }} />
              <div style={{ width: `${pctNoLive}%`, background: '#c21f1f', transition: 'width 0.05s linear' }} />
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

      <div
        aria-live="polite"
        style={{ width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}
      >
        {revealed && total > 0 && `Final results: ${pctYesLive}% yes, ${pctNoLive}% no, out of ${total.toLocaleString()} verified humans.`}
      </div>

      <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '0.5rem', fontVariantNumeric: 'tabular-nums' }}>
        {totalDisplayed.toLocaleString()} verified humans answered
      </div>
      <div style={{ fontSize: '10px', color: '#6B7280', marginBottom: '1.25rem', lineHeight: 1.5 }}>
        Results are integrity-weighted.{' '}
        <a href="/how-it-works" style={{ color: '#6B7280', textDecoration: 'underline' }}>Learn more</a>
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
        <button
          onClick={onNext}
          style={{
            fontSize: '12px',
            color: '#6B7280',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            fontFamily: 'Merriweather, serif',
            padding: 0,
          }}
        >
          tap, swipe up, or press Enter for next question
        </button>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
          <button
            onClick={shareQuestion}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '12px',
              color: '#6B7280',
              cursor: 'pointer',
              textDecoration: 'underline',
              fontFamily: 'Merriweather, serif',
            }}
          >
            Share this question
          </button>
          <button
            onClick={onChangeVote}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '12px',
              color: '#6B7280',
              cursor: 'pointer',
              textDecoration: 'underline',
              fontFamily: 'Merriweather, serif',
            }}
          >
            Change my vote
          </button>
        </div>
      </div>
    </div>
  )
}
