import { IconMessageCircle } from '@tabler/icons-react'
import { useRef, useEffect } from 'react'

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

export default function ResultsCard({ question, userVote, tally, onJoinConversation, onNext }) {
  const total = tally.yes + tally.ly + tally.ln + tally.no
  const pctYes = total > 0 ? Math.round(((tally.yes + tally.ly) / total) * 100) : 0
  const pctNo = 100 - pctYes

  const segments = [
    { key: 'yes', value: tally.yes },
    { key: 'ly', value: tally.ly },
    { key: 'ln', value: tally.ln },
    { key: 'no', value: tally.no },
  ]

  const cardRef = useRef(null)
  const startY = useRef(0)

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
          fontSize: '17px',
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
          marginBottom: '1rem',
          display: 'inline-block',
          ...VOTE_PILL_STYLES[userVote],
        }}
      >
        {VOTE_LABELS[userVote]}
      </div>

      <div style={{ width: '100%', marginBottom: '0.5rem', boxSizing: 'border-box' }}>
        <div
          style={{
            width: '100%',
            height: '8px',
            borderRadius: '4px',
            overflow: 'hidden',
            display: 'flex',
            background: '#F1F1F1',
          }}
        >
          {segments.map((seg) => (
            <div
              key={seg.key}
              style={{
                width: total > 0 ? `${(seg.value / total) * 100}%` : '25%',
                background: VOTE_COLORS[seg.key],
                flexShrink: 0,
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12px',
            marginTop: '4px',
            width: '100%',
          }}
        >
          <span style={{ color: '#4d6214' }}>{pctYes}% yes</span>
          <span style={{ color: '#8a1616' }}>{pctNo}% no</span>
        </div>
      </div>

      <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '0.5rem' }}>
        {total.toLocaleString()} verified humans answered
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
    </div>
  )
}