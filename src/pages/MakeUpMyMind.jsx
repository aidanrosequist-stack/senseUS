import Header from '../components/layout/Header'
import BottomNav from '../components/layout/BottomNav'
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { IconWaveSine, IconCornerDownRight, IconNews } from '@tabler/icons-react'
import { supabase } from '../lib/supabase'

const STANCE_CONFIG = {
  yes:  { label: 'Yes', background: '#6d8a1c', color: 'white', headerColor: '#4d621d' },
  ly:   { label: 'Leaning Yes', background: '#d9c01a', color: 'white', headerColor: '#7a6b0e' },
  neutral: { label: 'Neutral', background: '#2D3DCA', color: 'white', headerColor: '#1a2480' },
  ln:   { label: 'Leaning No', background: '#c2731f', color: 'white', headerColor: '#7a4513' },
  no:   { label: 'No', background: '#c21f1f', color: 'white', headerColor: '#7a1313' },
}

const STANCE_ORDER = ['yes', 'ly', 'neutral', 'ln', 'no']

export default function MakeUpMyMind() {
  const { questionId } = useParams()
  const navigate = useNavigate()
  const [question, setQuestion] = useState(null)
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const { data: questionData, error: qError } = await supabase
          .from('questions')
          .select('id, text, category')
          .eq('id', questionId)
          .single()

        if (qError) throw qError
        setQuestion(questionData)

        const { data: articleData, error: aError } = await supabase
          .from('question_articles')
          .select('id, title, outlet_name, url, stance, display_order')
          .eq('question_id', questionId)
          .eq('is_active', true)
          .order('display_order', { ascending: true })

        if (aError) {
          console.warn('Articles error:', aError)
          setArticles([])
        } else {
          setArticles(articleData || [])
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [questionId])

  const grouped = STANCE_ORDER.reduce((acc, stance) => {
    const group = articles.filter(a => a.stance === stance)
    if (group.length > 0) acc[stance] = group
    return acc
  }, {})

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#7a1313' }}>
        Something went wrong. Please go back and try again.
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#C7C7CC', boxSizing: 'border-box', paddingBottom: '90px' }}>
      <Header />
      <div style={{ padding: '14px', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '480px', background: '#FFFFFF', borderRadius: '20px', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <button
          onClick={() => navigate(-1)}
          style={{ fontSize: '13px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', padding: 0 }}
        >
          ← back to vote
        </button>
      </div>
      

      {/* Question */}
      <div style={{ marginBottom: '1.5rem' }}>
        <span style={{ fontSize: '11px', fontWeight: 500, padding: '3px 10px', borderRadius: '20px', background: '#E6F1FB', color: '#0C447C', display: 'inline-block', marginBottom: '8px' }}>
          {question?.category}
        </span>
        <h1 style={{ fontSize: '17px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.5, margin: 0 }}>
          {question?.text}
        </h1>
      </div>

      <p style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6, marginBottom: '1rem' }}>
        Read perspectives from across the spectrum, then return to cast your vote.
      </p>
      <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '10px 12px', marginBottom: '1.5rem', fontSize: '11px', color: '#9CA3AF', lineHeight: 1.6 }}>
        Articles were sourced with AI assistance and reviewed by our editorial team. Links may break over time — if you find a dead link, please let us know at hello@senseus.app. For questions about AI itself, all articles are human-selected only.
      </div>

      {/* Articles grouped by stance */}
      {Object.keys(grouped).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
          No articles have been added for this question yet.
        </div>
      ) : (
        STANCE_ORDER.filter(s => grouped[s]).map(stance => {
          const config = STANCE_CONFIG[stance]
          return (
            <div key={stance} style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                {grouped[stance].map(article => (
                  <a
                    key={article.id}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      padding: '8px 0',
                      background: config.background,
                      color: config.color,
                      borderRadius: '20px',
                      fontSize: '16px',
                      fontWeight: 500,
                      textDecoration: 'none',
                      fontFamily: 'Merriweather, serif',
                      width: '75%',
                      textAlign: 'center',
                      marginBottom: '4px',
                    }}
                  >
                    {article.outlet_name}
                  </a>
                ))}
              </div>
            </div>
          )
        })
      )}

      {/* Back to vote CTA */}
      <div style={{ position: 'sticky', bottom: '1.5rem', marginTop: '2rem' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            width: '100%',
            padding: '13px',
            background: '#FFFFFF',
            color: '#1A1A1A',
            border: '1.5px solid #D1D5DB',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'Merriweather, serif',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}
        >
          ← return to vote
        </button>
      </div>

        </div>
      </div>
      <BottomNav />
    </div>
  )
}