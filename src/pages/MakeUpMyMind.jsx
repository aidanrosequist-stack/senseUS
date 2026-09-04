import { HEADER_HEIGHT_PX } from '../components/layout/Header'
import { usePageTitle } from '../hooks/usePageTitle'
import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const STANCE_CONFIG = {
  yes:  { label: 'Yes', background: '#6d8a1c', color: 'white', headerColor: '#4d621d' },
  ly:   { label: 'Leaning Yes', background: '#d9c01a', color: 'white', headerColor: '#7a6b0e' },
  neutral: { label: 'Neutral', background: '#2D3DCA', color: 'white', headerColor: '#1a2480' },
  ln:   { label: 'Leaning No', background: '#c2731f', color: 'white', headerColor: '#7a4513' },
  no:   { label: 'No', background: '#c21f1f', color: 'white', headerColor: '#7a1313' },
}

const STANCE_ORDER = ['yes', 'ly', 'neutral', 'ln', 'no']

export default function MakeUpMyMind() {
  usePageTitle('Make Up My Mind')
  const { questionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // Where "back to vote" should actually go depends on how this page was
  // reached — Conversation.jsx (already voted, reading up afterward) and
  // QuestionFlow.jsx (mid-vote, via VoteCard's Make Up My Mind button)
  // both link here. The header button used to just do navigate(-1)
  // (plain browser-history back), which is exactly the bug report this
  // fixes: the vote flow's current question is local React state inside
  // QuestionFlow, not part of the URL, so going back to a bare /vote
  // remounts it from scratch — a fresh candidate batch gets fetched and
  // the flow starts over from whatever question lands first in it, not
  // the one the user was actually reading about. The sticky CTA at the
  // bottom already worked around this by hardcoding a jump to
  // /vote?question=<id> (the same deep-link path Vote.jsx uses for
  // shares/notifications), but that's wrong for the *other* entry point:
  // coming from Conversation (already voted), it would detour back
  // through a vote card instead of returning to the conversation being
  // read. Tracking which entry point was used via router state and
  // picking the right destination fixes both buttons for both paths at
  // once, and does it without depending on browser history at all.
  const cameFromConversation = location.state?.from === 'conversation'
  const backDestination = cameFromConversation
    ? `/conversation/${questionId}`
    : `/vote?question=${questionId}`

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

        // Log this view for the Diligent Researcher badge, and so we can
        // eventually see real usage of this feature — fire-and-forget,
        // never blocks the page.
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) {
            supabase.from('article_views').insert({ user_id: user.id, question_id: questionId }).then(() => {})
          }
        })

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100dvh - ${HEADER_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        <LoadingSpinner />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100dvh - ${HEADER_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#7a1313' }}>
        Something went wrong. Please go back and try again.
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#C7C7CC', boxSizing: 'border-box', paddingBottom: '90px' }}>
      <div style={{ padding: '14px', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '480px', background: '#FFFFFF', borderRadius: 'var(--senseus-card-radius)', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', boxShadow: 'var(--senseus-card-shadow)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <button
          onClick={() => navigate(backDestination)}
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
      <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '10px 12px', marginBottom: '1.5rem', fontSize: '11px', color: '#6B7280', lineHeight: 1.6 }}>
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
          onClick={() => navigate(backDestination)}
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
    </div>
  )
}