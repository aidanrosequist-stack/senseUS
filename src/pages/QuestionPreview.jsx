import { useState, useEffect } from 'react'
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
  const [surrounding, setSurrounding] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const qNum = parseInt(number, 10)

        // Fetch the featured question
        const { data: q } = await supabase
          .from('questions')
          .select('id, text, category, domain, question_number')
          .eq('question_number', qNum)
          .single()

        if (!q) { setLoading(false); return }
        setQuestion(q)

        // Fetch vote tally
        const { data: votes } = await supabase
          .from('votes')
          .select('choice')
          .eq('question_id', q.id)

        const counts = { yes: 0, ly: 0, ln: 0, no: 0 }
        ;(votes || []).forEach(v => {
          if (counts[v.choice] !== undefined) counts[v.choice]++
        })
        setTally(counts)

        // Fetch surrounding questions (2 before, 2 after)
        const { data: surroundingData } = await supabase
          .from('questions')
          .select('id, text, category, question_number')
          .not('published_at', 'is', null)
          .neq('question_number', qNum)
          .gte('question_number', Math.max(1, qNum - 2))
          .lte('question_number', qNum + 2)
          .order('question_number', { ascending: true })

        setSurrounding(surroundingData || [])
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [number])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  if (!question) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
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

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', minHeight: '100dvh' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '22px', fontWeight: 400, color: '#1A1A1A' }}>
          sense<span style={{ fontWeight: 700, color: '#2D3DCA' }}>US</span>
        </div>
        <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
          real humans. real opinions. real truth.
        </div>
      </div>

      {/* Featured question card */}
      <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '11px', fontWeight: 500, padding: '3px 10px', borderRadius: '20px', background: '#E6F1FB', color: '#0C447C' }}>
            {question.category}
          </span>
          <span style={{ fontSize: '11px', color: '#9CA3AF' }}>#{question.question_number}</span>
        </div>

        <div style={{ fontSize: '18px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.5, marginBottom: '1.25rem', fontFamily: 'Merriweather, serif' }}>
          {question.text}
        </div>

        {/* Vote bar */}
        {total > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ width: '100%', height: '8px', borderRadius: '4px', overflow: 'hidden', display: 'flex', background: '#F1F1F1', marginBottom: '6px' }}>
              {segments.map(seg => (
                <div
                  key={seg.key}
                  style={{
                    width: `${(seg.value / total) * 100}%`,
                    background: VOTE_COLORS[seg.key],
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#4d6214', fontWeight: 500 }}>{pctYes}% yes</span>
              <span style={{ color: '#6B7280', fontSize: '11px' }}>{total.toLocaleString()} answered</span>
              <span style={{ color: '#8a1616', fontWeight: 500 }}>{pctNo}% no</span>
            </div>
          </div>
        )}

        {total === 0 && (
          <div style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '1rem', textAlign: 'center' }}>
            Be the first to vote on this question.
          </div>
        )}

        {/* CTA */}
        <Link
          to="/register"
          style={{
            display: 'block', width: '100%', padding: '12px', background: '#2D3DCA',
            color: 'white', borderRadius: '10px', fontSize: '14px', fontWeight: 700,
            textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box',
            marginBottom: '8px',
          }}
        >
          Vote on this question
        </Link>
        <Link
          to="/register"
          style={{ display: 'block', textAlign: 'center', fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}
        >
          Join senseUS — free, verified, no ads
        </Link>
      </div>

      {/* Surrounding questions */}
      {surrounding.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
            More questions
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {surrounding.map(q => (
              <div
                key={q.id}
                onClick={() => navigate(`/q/${q.question_number}`)}
                style={{
                  background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px',
                  padding: '12px 14px', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                }}
              >
                <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, flex: 1 }}>
                  {q.text}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF', flexShrink: 0 }}>
                  #{q.question_number}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '8px' }}>
          Operated by Gudboi Enterprises, LLC
        </div>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <Link to="/privacy" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none' }}>Privacy</Link>
          <Link to="/terms" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none' }}>Terms</Link>
          <Link to="/how-it-works" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none' }}>How It Works</Link>
        </div>
      </div>

    </div>
  )
}