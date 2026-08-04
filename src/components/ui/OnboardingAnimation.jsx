import { useState, useEffect } from 'react'

const STEPS = [
  {
    icon: '👉',
    title: 'Swipe right to vote Yes',
    subtitle: 'and hold in the green zone for about 2 seconds',
    color: '#6d8a1c',
    bg: '#eef3e0',
    animDirection: 'right',
  },
  {
    icon: '👈',
    title: 'Swipe left to vote No',
    subtitle: 'and hold in the red zone for about 2 seconds',
    color: '#c21f1f',
    bg: '#f9d8d8',
    animDirection: 'left',
  },
  {
    icon: '👆',
    title: 'Swipe up to skip',
    subtitle: 'You can swipe down to bring it back',
    color: '#2D3DCA',
    bg: '#E6F1FB',
    animDirection: 'up',
  },
  {
    icon: '⏱',
    title: 'Hold to confirm',
    subtitle: 'Hold still in a color zone for about 2 seconds to commit your vote or you can also use the voting buttons',
    color: '#6B7280',
    bg: '#F3F4F6',
    animDirection: 'hold',
  },
]

export default function OnboardingAnimation({ onComplete }) {
  const [step, setStep] = useState(0)
  const [animating, setAnimating] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- driving a timed animation transition on step change; inherently timer-based
    setAnimating(true)
    const timer = setTimeout(() => setAnimating(false), 600)
    return () => clearTimeout(timer)
  }, [step])

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      localStorage.setItem('senseus_onboarded', 'true')
      onComplete()
    }
  }

  function handleSkip() {
    localStorage.setItem('senseus_onboarded', 'true')
    onComplete()
  }

  const current = STEPS[step]

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, padding: '1.5rem', boxSizing: 'border-box',
      fontFamily: 'Merriweather, serif',
    }}>
      <div style={{
        background: '#FFFFFF', borderRadius: '20px', padding: '2rem',
        maxWidth: '340px', width: '100%', textAlign: 'center',
      }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '1.5rem' }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? '20px' : '8px',
              height: '8px',
              borderRadius: '4px',
              background: i === step ? '#2D3DCA' : '#E5E7EB',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>

        {/* Animated card preview */}
        <div style={{
          width: '100%',
          height: '160px',
          borderRadius: '16px',
          background: animating ? current.bg : '#F9FAFB',
          border: `2px solid ${animating ? current.color : '#E5E7EB'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.5rem',
          transition: 'all 0.4s ease',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Animated arrow */}
          <div style={{
            fontSize: '48px',
            transform: animating
              ? current.animDirection === 'right' ? 'translateX(20px)'
              : current.animDirection === 'left' ? 'translateX(-20px)'
              : current.animDirection === 'up' ? 'translateY(-20px)'
              : 'scale(1.2)'
              : 'translate(0) scale(1)',
            transition: 'transform 0.4s ease',
            opacity: animating ? 1 : 0.6,
          }}>
            {current.icon}
          </div>

          {/* Hold progress ring */}
          {current.animDirection === 'hold' && (
            <div style={{ position: 'absolute', bottom: '12px', right: '12px' }}>
              <svg width="36" height="36" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="18" cy="18" r="14" fill="none" stroke="#E5E7EB" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="14"
                  fill="none"
                  stroke="#2D3DCA"
                  strokeWidth="3"
                  strokeDasharray={2 * Math.PI * 14}
                  strokeDashoffset={animating ? 2 * Math.PI * 14 * 0.3 : 2 * Math.PI * 14}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                />
              </svg>
            </div>
          )}
        </div>

        {/* Text */}
        <div style={{ fontSize: '17px', fontWeight: 700, color: '#1A1A1A', marginBottom: '8px' }}>
          {current.title}
        </div>
        <div style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6, marginBottom: '1.5rem', whiteSpace: 'pre-line' }}>
          {current.subtitle}
        </div>

        {/* Buttons */}
        <button
          onClick={handleNext}
          style={{
            width: '100%', padding: '12px', background: '#2D3DCA', color: 'white',
            border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700,
            cursor: 'pointer', fontFamily: 'Merriweather, serif', marginBottom: '8px',
          }}
        >
          {step < STEPS.length - 1 ? 'Next →' : 'Got it — let\'s vote!'}
        </button>
        <button
          onClick={handleSkip}
          style={{
            width: '100%', padding: '8px', background: 'none', color: '#9CA3AF',
            border: 'none', fontSize: '12px', cursor: 'pointer', fontFamily: 'Merriweather, serif',
          }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}