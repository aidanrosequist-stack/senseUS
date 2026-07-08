import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f',
}

export default function QuestionPreview() {
  const { number } = useParams()
  const navigate = useNavigate()
  const [question, setQuestion] = useState(null)
  const [tally, setTally] = useState({ yes: 0, ly: 0, ln: 0, no: 0 })
  const [loading, setLoading] = useState(true)
  const [sliding, setSliding] = useState(null) // 'up' | 'down' | null
  const [maxNumber, setMaxNumber] = useState(null)

  const qNum = parseInt(number, 10)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        const { data: q } = await supabase
          .from('questions')
          .select('id, text, category, domain, question_number')
          .eq('question_number', qNum)
          .single()

        if (!q) { setLoading(false); return }
        setQuestion(q)

        const { data: votes } = await supabase
          .from('votes')
          .select('choice')
          .eq('question_id', q.id)

        const counts = { yes: 0, ly: 0, ln: 0, no: 0 }
        ;(votes || []).forEach(v => {
          if (counts[v.choice] !== undefined) counts[v.choice]++
        })
        setTally(counts)

        // Get max question number for boundary check
        const { data: maxQ } = await supabase
          .from('questions')
          .select('question_number')
          .not('published_at', 'is', null)
          .order('question_number', { ascending: false })
          .limit(1)
          .single()

        if (maxQ) setMaxNumber(maxQ.question_number)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [qNum])

  const goTo = useCallback((direction) => {
    const nextNum = direction === 'next' ? qNum + 1 : qNum - 1
    if (nextNum < 1 || (maxNumber && nextNum > maxNumber)) return
    setSliding(direction === 'next' ? 'up' : 'down')
    setTimeout(() => {
      setSliding(null)
      navigate(`/q/${nextNum}`)
    }, 280)
  }, [qNum, maxNumber, navigate])

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'ArrowDown') goTo('next')
      if (e.key === 'ArrowUp') goTo('prev')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goTo])

  // Mouse wheel navigation
  useEffect(() => {
    let wheelTimeout = null
    function handleWheel(e) {
      if (wheelTimeout) return
      if (e.deltaY > 30) goTo('next')
      else if (e.deltaY < -30) goTo('prev')
      wheelTimeout = setTimeout(() => { wheelTimeout = null }, 600)
    }
    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [goTo])

  // Touch/swipe navigation
  useEffect(() => {
    let startY = 0
    function handleTouchStart(e) { startY = e.touches[0].clientY }
    function handleTouchEnd(e) {
      const dy = e.changedTouches[0].clientY - startY
      if (dy < -50) goTo('next')
      else if (dy > 50) goTo('prev')
    }
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [goTo])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280', background: '#C7C7CC' }}>
        Loading...
      </div>
    )
  }

  if (!question) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280', background: '#C7C7CC' }}>
        Question not found.
      </div>
    )
  }

  const total = tally.yes + tally.ly + tally.ln + tally.no
  const pctYes = total > 0 ? Math.round(((tally.yes + tally.ly) / total) * 100) : 0
  const pctNo = 100 - pctYes

  const segments = [
    { key: 'yes', value: tally.yes },
    { key: 'ly', value: tally.ly },
    { key: 'ln', value: tally.ln },
    { key: 'no', value: tally.no },
  ]

  const slideStyle = sliding === 'up'
    ? { transform: 'translateY(-40px)', opacity: 0, transition: 'transform 0.28s ease, opacity 0.28s ease' }
    : sliding === 'down'
    ? { transform: 'translateY(40px)', opacity: 0, transition: 'transform 0.28s ease, opacity 0.28s ease' }
    : { transform: 'translateY(0)', opacity: 1, transition: 'transform 0.28s ease, opacity 0.28s ease' }

  return (
    <div style={{ width: '100%', height: '100dvh', background: '#C7C7CC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', boxSizing: 'border-box', fontFamily: 'Merriweather, serif', overflow: 'hidden' }}>
      <div style={{ width: '100%', maxWidth: '420px', ...slideStyle }}>

        {/* Card */}
        <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '1.5rem', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
              sense<span style={{ fontWeight: 700, color: '#2D3DCA' }}>US</span>
            </div>
            <span style={{ fontSize: '11px', color: '#9CA3AF' }}>#{question.question_number}</span>
          </div>

          <span style={{ fontSize: '10px', fontWeight: 500, padding: '3px 10px', borderRadius: '20px', background: '#E6F1FB', color: '#0C447C', display: 'inline-block', marginBottom: '0.75rem' }}>
            {question.category}
          </span>

          <div style={{ fontSize: '17px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.5, marginBottom: '1.25rem' }}>
            {question.text}
          </div>

          {total > 0 ? (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ width: '100%', height: '8px', borderRadius: '4px', overflow: 'hidden', display: 'flex', marginBottom: '6px' }}>
                {segments.map(seg => (
                  <div key={seg.key} style={{ width: `${(seg.value / total) * 100}%`, background: VOTE_COLORS[seg.key] }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span style={{ color: '#4d6214', fontWeight: 500 }}>{pctYes}% yes</span>
                <span style={{ color: '#6B7280', fontSize: '11px' }}>{total.toLocaleString()} answered</span>
                <span style={{ color: '#8a1616', fontWeight: 500 }}>{pctNo}% no</span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '1.25rem', textAlign: 'center' }}>
              Be the first to vote on this question.
            </div>
          )}

          <div style={{ height: '1px', background: '#E5E7EB', marginBottom: '1rem' }} />

          <Link
            to="/register"
            style={{ display: 'block', width: '100%', padding: '12px', background: '#2D3DCA', color: 'white', borderRadius: '10px', fontSize: '14px', fontWeight: 700, textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box', marginBottom: '8px' }}
          >
            Vote on this question
          </Link>
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#6B7280' }}>
            Join senseUS — free, verified, no ads
          </div>
        </div>

        {/* Navigation hint */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
          {qNum > 1 && (
            <div style={{ background: 'rgba(255,255,255,0.85)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#6B7280', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
              ↑ prev
            </div>
          )}
          {(!maxNumber || qNum < maxNumber) && (
            <div style={{ background: 'rgba(255,255,255,0.85)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#6B7280', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
              ↓ next
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <Link to="/privacy" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Privacy</Link>
            <Link to="/terms" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Terms</Link>
            <Link to="/how-it-works" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>How It Works</Link>
          </div>
        </div>

      </div>
    </div>
  )
}