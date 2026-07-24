import { useState, useEffect, useRef } from 'react'

const CYCLE_WORDS = [
  { text: 'you', color: '#1e4e21', hold: 1000 },
  { text: 'me', color: '#3978ac', hold: 1000 },
  { text: 'he', color: '#a3340f', hold: 400 },
  { text: 'she', color: '#d1527c', hold: 300 },
  { text: 'they', color: '#361485', hold: 200 },
  { text: 'we', color: '#56acac', hold: 100 },
  { text: "y'all", color: '#c3ce32', hold: 100 },
  { text: 'everyone', color: '#9844be', hold: 100 },
]

const SETTLED_COLOR = '#6da627' // matches the wordmark's static color everywhere else

// Drop-in replacement for the static "US" span:
//   sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
// becomes:
//   sense<AnimatedWordmark />
// Plays the word-cycle once per browser tab/session (via sessionStorage),
// then settles permanently into the real "US" styling — every remount
// after that first play just renders the static state directly.
export default function AnimatedWordmark() {
  const alreadyPlayed = typeof window !== 'undefined' && sessionStorage.getItem('senseus_header_anim_played') === 'true'

  const [word, setWord] = useState(alreadyPlayed ? 'US' : 'you')
  const [color, setColor] = useState(alreadyPlayed ? SETTLED_COLOR : CYCLE_WORDS[0].color)
  const [visible, setVisible] = useState(true)
  const [settled, setSettled] = useState(alreadyPlayed)
  const timeoutRef = useRef(null)

  useEffect(() => {
    if (alreadyPlayed) return

    let i = 1

    function showNext() {
      if (i >= CYCLE_WORDS.length) {
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
    <span
      style={{
        display: 'inline-block',
        width: settled ? 'auto' : '5.5em',
        textAlign: 'left',
      }}
    >
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
    </span>
  )
}
