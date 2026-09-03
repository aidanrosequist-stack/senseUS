import { useState, useRef, useEffect } from 'react'
import { IconThumbUp, IconThumbDown, IconBulb, IconMessageCircle, IconShare } from '@tabler/icons-react'

// Tier 2 ("wash") — updated 2026-09-03 (second pass) to reuse the vote
// buttons' own backfill colors below (see `bg` in the button styles further
// down this file, also Activity.jsx/ResultsCard.jsx's VOTE_PILL_STYLES
// background) instead of a bespoke shade, so this is the same 4 hex values
// as those rather than a 5th slightly-different set — one fewer color
// variant in the app. This full-card background used to be tier 1 (the
// small-accent bold colors used for the swipe-hint glow/borders/icons
// elsewhere in this file) — that read as too saturated for a screen-filling
// background, so it's switched to this much lighter tier instead. Overlay
// text below is #1A1A1A (not white — white doesn't reliably pass contrast
// on any of these 4 hues, see Explore.jsx's comment on the same palette),
// plus a soft drop-shadow for a little depth now that it's not relying on
// the light backgrounds' black-text contrast (already 14-17:1 at this
// lighter tier) but reads a bit flatter without it.
const COLORS = {
  yes: '#eef3e0',
  ly: '#faf6d0',
  ln: '#f9ead8',
  no: '#f9d8d8',
}

const ZONE_TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.18)'

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

// Reused across the whole session instead of creating (and leaking)
// a new AudioContext on every sound effect.
let sharedAudioCtx = null
function getAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume()
  }
  return sharedAudioCtx
}

function playSound(type) {
  if (localStorage.getItem('senseus_sound') === 'off') return
  const ctx = getAudioContext()
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

function ProgressRing({ progress }) {
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (progress / 100) * circumference

  return (
    <svg
      width="44"
      height="44"
      style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-90deg)', pointerEvents: 'none' }}
    >
      <circle
        cx="22"
        cy="22"
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="3"
      />
      <circle
        cx="22"
        cy="22"
        r={radius}
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.05s linear' }}
      />
    </svg>
  )
}

export default function VoteCard({ question, onVote, onSkip, onMakeUpMyMind, onViewConversation, onHideQuestion, showHint = false, initialZone = null, submitting = false, submittingLabel = 'Saving your vote...', voteError = null, onDismissError }) {
  const [zone, setZone] = useState(initialZone)

  // The native touchmove listener below is bound in an effect with an
  // empty dependency array (it only needs to attach once), so the
  // onTouchMove closure it creates permanently sees whatever
  // handleMove/startHold looked like at mount — including the
  // mount-time value of the `submitting` prop. Without this ref,
  // startHold's submitting guard would never see `submitting` become
  // true once a vote is actually in flight, so a touch-drag gesture
  // could restart the hold-to-vote timer mid-save and call onVote a
  // second time. Reading through a ref instead of the closed-over prop
  // means the guard always sees the current value, regardless of when
  // the effect that created the listener last ran.
  const submittingRef = useRef(submitting)
  useEffect(() => {
    submittingRef.current = submitting
  }, [submitting])

useEffect(() => {
    return () => {
      clearInterval(holdInterval.current)
      clearTimeout(moveTimeout.current)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local drag-zone state from a prop that only changes on question navigation; not worth restructuring around key-based remount here
    if (initialZone) setZone(initialZone)
  }, [initialZone])
  const [dragging, setDragging] = useState(false)
  const [hintSide, setHintSide] = useState(null) // 'left' | 'right' | null
  const [hintOffset, setHintOffset] = useState(-100)
  const cardRef = useRef(null)
  const startPos = useRef({ x: 0, y: 0 })
  const delta = useRef({ x: 0, y: 0 })
  const lastZone = useRef(null)
  const [holdProgress, setHoldProgress] = useState(0) // 0-100
  const [holdZone, setHoldZone] = useState(null)
  const holdInterval = useRef(null)
  function startHold(currentZone) {
    if (!currentZone || submittingRef.current) return
    setHoldZone(currentZone)
    setHoldProgress(0)

    if (navigator.vibrate) navigator.vibrate(30)

    const startTime = Date.now()
    const duration = 1500
    let cancelled = false

    // Store cancel function on ref
    holdInterval.cancelTicks = () => { cancelled = true }

    const tickTimes = [400, 800, 1200]
    tickTimes.forEach(t => {
      setTimeout(() => {
        if (!cancelled && holdInterval.current) {
          if (navigator.vibrate) navigator.vibrate(25)
        }
      }, t)
    })

    holdInterval.current = setInterval(() => {
      if (cancelled) {
        clearInterval(holdInterval.current)
        holdInterval.current = null
        return
      }
      const elapsed = Date.now() - startTime
      const progress = Math.min((elapsed / duration) * 100, 100)
      setHoldProgress(progress)

      if (progress >= 100) {
        clearInterval(holdInterval.current)
        holdInterval.current = null
        cancelled = true

        if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 120])
        try {
          const ctx = getAudioContext()
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.frequency.value = 600
          gain.gain.setValueAtTime(0.3, ctx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
          osc.start()
          osc.stop(ctx.currentTime + 0.3)
        } catch {
          // Audio playback can fail silently on some browsers/permissions — not critical to the vote itself
        }

        onVote(currentZone)
        setHoldProgress(0)
        setHoldZone(null)
      }
    }, 50)
  }

  function cancelHold() {
    if (holdInterval.cancelTicks) holdInterval.cancelTicks()
    clearInterval(holdInterval.current)
    holdInterval.current = null
    clearTimeout(moveTimeout.current)
    setHoldProgress(0)
    setHoldZone(null)
  }

  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    function onTouchMove(e) {
      e.preventDefault()
      handleMove(e.touches[0].clientX, e.touches[0].clientY)
    }

    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  useEffect(() => {
    if (!showHint) return
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

  const moveTimeout = useRef(null)

  function handleMove(clientX, clientY) {
    const newDelta = {
      x: clientX - startPos.current.x,
      y: clientY - startPos.current.y,
    }

    delta.current = newDelta
    const newZone = zoneFromDelta(delta.current.x)
    const zoneChanged = newZone !== lastZone.current

    applyZone(newZone)

    // Only reset the hold timer when the user actually crosses into a
    // different zone (or out of any zone) — natural hand tremor while
    // holding still inside the same zone should never cancel progress.
    if (zoneChanged) {
      cancelHold()
      clearTimeout(moveTimeout.current)
      if (newZone) {
        moveTimeout.current = setTimeout(() => {
          startHold(newZone)
        }, 400)
      }
    }
  }

  function handleEnd() {
    setDragging(false)
    const { x: dx, y: dy } = delta.current

    // Cancel any hold timer
    cancelHold()

    // Swipe up with no horizontal selection = skip
    if (dy < -THRESH_SWIPE_UP && Math.abs(dy) > Math.abs(dx) && !zone) {
      onSkip()
      resetVisual()
      return
    }

    // Releasing without completing the hold just snaps back — committing
    // now happens only via hold-to-vote or the buttons, never a raw release.
    resetVisual()
  }

  function resetVisual() {
    delta.current = { x: 0, y: 0 }
    lastZone.current = null
    setZone(null)
  }

  function handleButtonVote(value) {
    if (submitting) return
    const isFull = value === 'yes' || value === 'no'
    vibrate(isFull ? 40 : 12)
    playSound(value)
    onVote(value)
  }

  function handleMindMade() {
    vibrate(20)
    if (onMakeUpMyMind) onMakeUpMyMind()
  }

  async function shareQuestion() {
    if (!question?.question_number) return
    const url = `https://senseus.app/q/${question.question_number}`
    const shareData = {
      title: 'senseUS',
      text: 'Vote on this question on senseUS',
      url,
    }

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

  const backgroundColor = zone ? COLORS[zone] : 'var(--bg, #FFFFFF)'

  return (
<div
      ref={cardRef}
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
      onMouseUp={() => { cancelHold(); handleEnd() }}
      onMouseLeave={() => { cancelHold(); if (dragging) handleEnd() }}
      onTouchStart={(e) => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchMove={(e) => {
        e.preventDefault()
        handleMove(e.touches[0].clientX, e.touches[0].clientY)
      }}
      onTouchEnd={() => { cancelHold(); handleEnd() }}
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
        <div style={{ display: 'flex', gap: '6px', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 500,
              padding: '3px 10px',
              borderRadius: '20px',
              background: '#E6F1FB',
              color: '#0C447C',
            }}
          >
            {question.category}
          </span>
          {question.is_sponsored && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                padding: '3px 10px',
                borderRadius: '20px',
                background: '#FFF3CD',
                color: '#856404',
              }}
            >
              Sponsored
            </span>
          )}
        </div>
        {question.is_sponsored && question.sponsor_name && (
          <div style={{ fontSize: '11px', color: zone ? '#1A1A1A' : '#6B7280', textShadow: zone ? ZONE_TEXT_SHADOW : 'none', marginBottom: '0.5rem' }}>
            sponsored by {question.sponsor_name}
          </div>
        )}
        <div
          style={{
            fontSize: '19px',
            fontWeight: 500,
            lineHeight: 1.4,
            fontFamily: 'Georgia, serif',
            color: '#1A1A1A',
            textShadow: zone ? ZONE_TEXT_SHADOW : 'none',
          }}
        >
          {question.text}
        </div>

        <button
          onClick={shareQuestion}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', cursor: 'pointer', marginTop: '10px', color: zone ? '#1A1A1A' : '#6B7280', textShadow: zone ? ZONE_TEXT_SHADOW : 'none', fontSize: '12px', fontFamily: 'Merriweather, serif' }}
        >
          <IconShare size={14} color={zone ? '#1A1A1A' : '#6B7280'} />
          Share this question
        </button>

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
              color: '#1A1A1A',
              textShadow: ZONE_TEXT_SHADOW,
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
          role="group"
          aria-label="Cast your vote"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '6px',
            marginBottom: '8px',
          }}
        >
          {[
            { zone: 'yes', bg: '#eef3e0', border: '#4d621d', circle: '#6d8a1c', label: 'Yes', icon: 'up', rotate: false, textColor: '#27500A' },
            { zone: 'ly', bg: '#faf6d0', border: '#7a6b0e', circle: '#d9c01a', label: 'Leaning Yes', icon: 'up', rotate: true, textColor: '#633806' },
            { zone: 'ln', bg: '#f9ead8', border: '#7a4513', circle: '#c2731f', label: 'Leaning No', icon: 'down', rotate: true, textColor: '#993C1D' },
            { zone: 'no', bg: '#f9d8d8', border: '#7a1313', circle: '#c21f1f', label: 'No', icon: 'down', rotate: false, textColor: '#791F1F' },
          ].map(({ zone, bg, border, circle, label, icon, rotate, textColor }) => (
            <button
              key={zone}
              onClick={() => handleButtonVote(zone)}
              onPointerDown={() => startHold(zone)}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              aria-label={`Vote ${label}`}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: bg, border: `1.5px solid ${border}`, borderRadius: '9px', padding: '10px 4px', cursor: 'pointer', position: 'relative', userSelect: 'none' }}
            >
              <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: circle, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: rotate ? 'rotate(45deg)' : 'none', position: 'relative' }}>
                {icon === 'up' ? <IconThumbUp size={18} color="white" /> : <IconThumbDown size={18} color="white" />}
                {holdZone === zone && holdProgress > 0 && (
                  <ProgressRing progress={holdProgress} color={circle} />
                )}
              </span>
              <span style={{ fontSize: '10px', fontWeight: 500, color: textColor, textAlign: 'center' }}>{label}</span>
            </button>
          ))}
        </div>

{holdProgress > 0 && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            pointerEvents: 'none',
          }}>
            <svg width="80" height="80" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="5" />
              <circle
                cx="40" cy="40" r="34"
                fill="none"
                stroke="white"
                strokeWidth="5"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={2 * Math.PI * 34 * (1 - holdProgress / 100)}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.05s linear' }}
              />
            </svg>
          </div>
        )}

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
          onClick={() => onViewConversation && onViewConversation()}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', background: '#FFFFFF', border: '1.5px solid #D1D5DB', borderRadius: '8px', color: '#6B7280', fontSize: '13px', fontWeight: 500, cursor: 'pointer', padding: '8px' }}
        >
          <IconMessageCircle size={16} color="#6B7280" />
          View the Conversation
        </button>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '8px' }}>
          <button
            onClick={() => onHideQuestion && onHideQuestion()}
            style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: '11px', cursor: 'pointer', fontFamily: 'Merriweather, serif', textDecoration: 'underline' }}
          >
            I don't want to see this question again
          </button>
          </div>
      </div>

      {submitting && (
        <div role="status" aria-live="polite" style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, fontFamily: 'Merriweather, serif', fontSize: '13px', color: '#1A1A1A' }}>
          {submittingLabel}
        </div>
      )}

      {voteError && (
        <div role="alert" aria-live="assertive" style={{ position: 'absolute', bottom: '1rem', left: '1rem', right: '1rem', background: '#7a1313', color: 'white', borderRadius: '10px', padding: '12px 14px', fontFamily: 'Merriweather, serif', fontSize: '13px', zIndex: 21, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
          <div style={{ marginBottom: '8px' }}>{voteError}</div>
          <button
            onClick={() => onDismissError && onDismissError()}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Dismiss and try again
          </button>
        </div>
      )}
    </div>
  )
}