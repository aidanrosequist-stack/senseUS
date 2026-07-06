import { useState, useRef, useEffect } from 'react'
import { IconThumbUp, IconThumbDown, IconBulb, IconMessageCircle } from '@tabler/icons-react'

const COLORS = {
  yes: '#6d8a1c',
  ly: '#d9c01a',
  ln: '#c2731f',
  no: '#c21f1f',
}

const LABELS = {
  yes: 'YES',
  ly: 'LEANING YES',
  ln: 'LEANING NO',
  no: 'NO',
}

const THRESH_LEAN = 35
const THRESH_FULL = 130
const THRESH_SWIPE_UP = 70

function vibrate(pattern) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern)
  }
}

function playSound(type) {
  if (localStorage.getItem('senseus_sound') === 'off') return
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const oscillator = ctx.createOscillator()
  const gainNode = ctx.createGain()
  oscillator.connect(gainNode)
  gainNode.connect(ctx.destination)

  const configs = {
    yes:        { frequency: 520, duration: 0.08, gain: 0.15 },
    ly:         { frequency: 440, duration: 0.07, gain: 0.12 },
    ln:         { frequency: 320, duration: 0.07, gain: 0.12 },
    no:         { frequency: 240, duration: 0.08, gain: 0.15 },
  }

  const config = configs[type] || configs.yes
  oscillator.frequency.setValueAtTime(config.frequency, ctx.currentTime)
  oscillator.type = 'sine'
  gainNode.gain.setValueAtTime(config.gain, ctx.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + config.duration)
  oscillator.start(ctx.currentTime)
  oscillator.stop(ctx.currentTime + config.duration)
}

export default function VoteCard({ question, onVote, onSkip }) {
  const [zone, setZone] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [hintSide, setHintSide] = useState(null) // 'left' | 'right' | null
  const [hintOffset, setHintOffset] = useState(-100)
  const startPos = useRef({ x: 0, y: 0 })
  const delta = useRef({ x: 0, y: 0 })
  const lastZone = useRef(null)

  useEffect(() => {
    let cancelled = false

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function pulse(side, distance) {
      if (cancelled) return
      setHintSide(side)
      setHintOffset(distance)
      vibrate(8)
      await wait(190)
      if (cancelled) return
      setHintOffset(side === 'left' ? -100 : 100)
      await wait(190)
    }

    async function runSide(side) {
      const distance = side === 'left' ? -35 : 35
      await pulse(side, distance)
      await wait(90)
      await pulse(side, distance)
    }

    async function runHintSequence() {
      await wait(400) // brief pause before the card "teaches" itself
      await runSide('left')
      await wait(450)
      await runSide('right')
      if (!cancelled) setHintSide(null)
    }

    runHintSequence()

    return () => {
      cancelled = true
    }
  }, [])

  function zoneFromDelta(dx) {
    if (dx < -THRESH_FULL) return 'no'
    if (dx < -THRESH_LEAN) return 'ln'
    if (dx > THRESH_FULL) return 'yes'
    if (dx > THRESH_LEAN) return 'ly'
    return null
  }

  function applyZone(newZone) {
    setZone(newZone)
    if (newZone && newZone !== lastZone.current) {
      const isFull = newZone === 'yes' || newZone === 'no'
      vibrate(isFull ? 40 : 12)
      playSound(newZone)
    }
    lastZone.current = newZone
  }

  function handleStart(clientX, clientY) {
    startPos.current = { x: clientX, y: clientY }
    setDragging(true)
  }

  function handleMove(clientX, clientY) {
    delta.current = {
      x: clientX - startPos.current.x,
      y: clientY - startPos.current.y,
    }
    applyZone(zoneFromDelta(delta.current.x))
  }

  function handleEnd() {
    setDragging(false)
    const { x: dx, y: dy } = delta.current

    // Swipe up with no horizontal selection = skip
    if (dy < -THRESH_SWIPE_UP && Math.abs(dy) > Math.abs(dx) && !zone) {
      onSkip()
      resetVisual()
      return
    }

    // Swipe up after selecting a zone = commit and advance
    if (zone && dy < -THRESH_SWIPE_UP && Math.abs(dy) > Math.abs(dx) * 0.5) {
      onVote(zone)
      resetVisual()
      return
    }

    // Released without enough movement to commit via swipe-up - snap back
    resetVisual()
  }

  function resetVisual() {
    delta.current = { x: 0, y: 0 }
    lastZone.current = null
    setZone(null)
  }

  function handleButtonVote(value) {
    const isFull = value === 'yes' || value === 'no'
    vibrate(isFull ? 40 : 12)
    playSound(value)
    onVote(value)
  }

  function handleMindMade() {
    vibrate(20)
    onVote('undecided')
  }

  const backgroundColor = zone ? COLORS[zone] : 'var(--bg, #FFFFFF)'

  return (
<div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor,
        transition: dragging ? 'none' : 'background-color 0.18s ease',
        touchAction: 'none',
        userSelect: 'none',
        overflow: 'hidden',
      }}
      onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
      onMouseMove={(e) => dragging && handleMove(e.clientX, e.clientY)}
      onMouseUp={handleEnd}
      onMouseLeave={() => dragging && handleEnd()}
onTouchStart={(e) => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchMove={(e) => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchEnd={handleEnd}
    >
      {hintSide === 'left' && (
        <div
          style={{
            position: 'absolute',
            top: '-10%',
            bottom: '-10%',
            left: 0,
            width: '90px',
            zIndex: 1,
            pointerEvents: 'none',
            background: 'radial-gradient(ellipse 60px 140px at 0% 50%, #6d8a1c 0px, #6d8a1c 38px, transparent 60px)',
            transform: `translateX(${hintOffset}px)`,
            transition: 'transform 0.19s ease',
          }}
        />
      )}
      {hintSide === 'right' && (
        <div
          style={{
            position: 'absolute',
            top: '-10%',
            bottom: '-10%',
            right: 0,
            width: '90px',
            zIndex: 1,
            pointerEvents: 'none',
            background: 'radial-gradient(ellipse 60px 140px at 100% 50%, #c21f1f 0px, #c21f1f 38px, transparent 60px)',
            transform: `translateX(${hintOffset}px)`,
            transition: 'transform 0.19s ease',
          }}
        />
      )}

      <div
        style={{
          height: '60%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          textAlign: 'center',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 500,
            padding: '3px 10px',
            borderRadius: '20px',
            marginBottom: '0.75rem',
            background: zone ? 'rgba(255,255,255,0.25)' : '#E6F1FB',
            color: zone ? '#FFFFFF' : '#0C447C',
          }}
        >
          {question.category}
        </span>
        <div
          style={{
            fontSize: '19px',
            fontWeight: 500,
            lineHeight: 1.4,
            fontFamily: 'Georgia, serif',
            color: zone ? '#FFFFFF' : '#1A1A1A',
          }}
        >
          {question.text}
        </div>

{zone && (
          <div
            style={{
              position: 'absolute',
              top: '18%',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '20px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: 'white',
              opacity: 0.9,
              pointerEvents: 'none',
              textAlign: 'center',
            }}
          >
            {LABELS[zone]}
          </div>
        )}


      </div>

      <div style={{ height: '40%', padding: '0 1rem 1rem', borderTop: '0.5px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
<div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '6px',
            marginBottom: '8px',
          }}
        >
          <button
            onClick={() => handleButtonVote('yes')}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: '#eef3e0', border: '1.5px solid #4d621d', borderRadius: '9px', padding: '10px 4px', cursor: 'pointer' }}
          >
            <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#6d8a1c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconThumbUp size={18} color="white" />
            </span>
            <span style={{ fontSize: '10px', fontWeight: 500, color: '#27500A' }}>Yes</span>
          </button>

          <button
            onClick={() => handleButtonVote('ly')}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: '#faf6d0', border: '1.5px solid #7a6b0e', borderRadius: '9px', padding: '10px 4px', cursor: 'pointer' }}
          >
            <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#d9c01a', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(45deg)' }}>
              <IconThumbUp size={18} color="white" />
            </span>
            <span style={{ fontSize: '10px', fontWeight: 500, color: '#633806', textAlign: 'center' }}>Leaning Yes</span>
          </button>

          <button
            onClick={() => handleButtonVote('ln')}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: '#f9ead8', border: '1.5px solid #7a4513', borderRadius: '9px', padding: '10px 4px', cursor: 'pointer' }}
          >
            <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#c2731f', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(45deg)' }}>
              <IconThumbDown size={18} color="white" />
            </span>
            <span style={{ fontSize: '10px', fontWeight: 500, color: '#993C1D', textAlign: 'center' }}>Leaning No</span>
          </button>

          <button
            onClick={() => handleButtonVote('no')}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: '#f9d8d8', border: '1.5px solid #7a1313', borderRadius: '9px', padding: '10px 4px', cursor: 'pointer' }}
          >
            <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#c21f1f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconThumbDown size={18} color="white" />
            </span>
            <span style={{ fontSize: '10px', fontWeight: 500, color: '#791F1F' }}>No</span>
          </button>
        </div>

<button
          onClick={handleMindMade}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#E6F1FB', border: '1.5px solid #0C447C', color: '#0C447C', borderRadius: '8px', padding: '9px', fontSize: '16px', fontWeight: 400, cursor: 'pointer', marginBottom: '8px' }}
        >
          <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#378ADD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconBulb size={14} color="white" />
          </span>
          Make Up My Mind
        </button>

        <button
          onClick={() => console.log('view conversation')}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', background: '#FFFFFF', border: '1.5px solid #D1D5DB', borderRadius: '8px', color: '#6B7280', fontSize: '13px', fontWeight: 500, cursor: 'pointer', padding: '8px' }}
        >
          <IconMessageCircle size={16} color="#6B7280" />
          View the Conversation
        </button>
      </div>
    </div>
  )
}