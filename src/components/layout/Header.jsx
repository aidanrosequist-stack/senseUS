import { useState, useEffect, useRef } from 'react'

const CYCLE_WORDS = [
  { text: 'you', color: '#993C1D', hold: 1400 },
  { text: 'me', color: '#0C447C', hold: 1400 },
  { text: 'he', color: '#712B13', hold: 420 },
  { text: 'she', color: '#993556', hold: 420 },
  { text: 'they', color: '#3C3489', hold: 420 },
  { text: 'we', color: '#085041', hold: 420 },
  { text: "y'all", color: '#7A6B0E', hold: 420 },
  { text: 'everyone', color: '#3B6D11', hold: 420 },
]

const SETTLED_COLOR = '#6da627' // matches the wordmark everywhere else in the app

export default function Header() {
  const alreadyPlayed = typeof window !== 'undefined' && sessionStorage.getItem('senseus_header_anim_played') === 'true'

  const [word, setWord] = useState(alreadyPlayed ? 'US' : 'you')
  const [color, setColor] = useState(alreadyPlayed ? SETTLED_COLOR : CYCLE_WORDS[0].color)
  const [visible, setVisible] = useState(true)
  const [settled, setSettled] = useState(alreadyPlayed)
  const timeoutRef = useRef(null)

  useEffect(() => {
    if (alreadyPlayed) return

    let i = 0

    function showNext() {
      if (i >= CYCLE_WORDS.length) {
        // Landed — settle into the real wordmark styling and stop for good.
        setVisible(false)
        timeoutRef.current = setTimeout(() => {
          setWord('US')
          setColor(SETTLED_COLOR)
          setVisible(true)
          setSettled(true)
          sessionStorage.setItem('senseus_header_anim_played', 'true')
        }, 180)
        return
      }

      const w = CYCLE_WORDS[i]
      setVisible(false)
      timeoutRef.current = setTimeout(() => {
        setWord(w.text)
        setColor(w.color)
        setVisible(true)
        i += 1
        timeoutRef.current = setTimeout(showNext, w.hold)
      }, 180)
    }

    timeoutRef.current = setTimeout(showNext, CYCLE_WORDS[0].hold)

    return () => clearTimeout(timeoutRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{
      width: '100%',
      background: '#FFFFFF',
      borderBottom: '0.5px solid #E5E7EB',
      display: 'flex',
      justifyContent: 'center',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        padding: '1px 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        boxSizing: 'border-box',
      }}>
        <img
          src="/senseUS-logo.png"
          alt="senseUS"
          style={{ height: '90px', width: 'auto' }}
        />
        <div style={{ fontFamily: 'Merriweather, serif' }}>
          <div style={{ fontSize: '24px', fontWeight: 400, color: '#1A1A1A', lineHeight: 1 }}>
            sense
            <span
              style={{
                fontWeight: 700,
                color: settled ? SETTLED_COLOR : color,
                display: 'inline-block',
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(4px)',
                transition: 'opacity 0.18s ease, transform 0.18s ease',
              }}
            >
              {word}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#6B7280', letterSpacing: '0.03em', marginTop: '2px' }}>
            THE societal media platform
          </div>
        </div>
      </div>
    </div>
  )
}
