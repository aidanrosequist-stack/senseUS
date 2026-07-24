import Header from '../components/layout/Header'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Skeleton } from '../components/ui/Skeleton'
import BottomNav from '../components/layout/BottomNav'

const DOMAINS = [
  'society & culture',
  'ethics & philosophy',
  'health & wellbeing',
  'relationships',
  'technology',
  'money & work',
  'media & information',
  'politics & policy',
  'science & nature',
  'sports & leisure',
]

const VOTE_COLORS = {
  yes: '#DAE9AF', ly: '#EEE5AA', ln: '#EBCDAD', no: '#EBADAD',
}

const VOTE_LABELS = {
  yes: 'yes', ly: 'leaning yes', ln: 'leaning no', no: 'no',
}

function domainLabel(domain) {
  return domain.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function QuestionThumbnail({ question, userVote, onClick }) {
  const voted = !!userVote
  const bgColor = voted ? VOTE_COLORS[userVote] : '#FFFFFF'
  const textColor = voted ? 'white' : '#1A1A1A'
  const subtextColor = voted ? 'rgba(255,255,255,0.8)' : '#6B7280'

  return (
    <div
      onClick={onClick}
      style={{
        width: '160px',
        minHeight: '200px',
        flexShrink: 0,
        background: bgColor,
        border: voted ? 'none' : '0.5px solid #E5E7EB',
        borderRadius: '12px',
        padding: '12px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        boxSizing: 'border-box',
      }}
    >
      <div>
        <div style={{
          fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '20px', display: 'inline-block', marginBottom: '8px',
          background: voted ? 'rgba(255,255,255,0.25)' : '#E6F1FB',
          color: voted ? 'white' : '#0C447C',
        }}>
          {question.category}
        </div>
        <div style={{ fontSize: '12px', fontWeight: 500, color: textColor, lineHeight: 1.4, fontFamily: 'Merriweather, serif' }}>
          {question.text.length > 70 ? question.text.substring(0, 70) + '...' : question.text}
        </div>
      </div>
      <div>
        {voted ? (
          <div style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: VOTE_COLORS[userVote] + '30', color: VOTE_COLORS[userVote], display: 'inline-block', fontWeight: 500 }}>
            {VOTE_LABELS[userVote]}
          </div>
        ) : (
          <div
            style={{ fontSize: '11px', fontWeight: 500, color: 'white', background: '#2D3DCA', borderRadius: '4px', padding: '4px 0', textAlign: 'center' }}
          >
            Vote now
          </div>
        )}
      </div>
    </div>
  )
}

export default function Explore() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [questions, setQuestions] = useState([])
  const [userVotes, setUserVotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [unansweredOnly, setUnansweredOnly] = useState(false)
  const scrollRefs = useRef({})
  const [userCountry, setUserCountry] = useState(null)

  function scrollRow(domain, direction) {
    const el = scrollRefs.current[domain]
    if (el) el.scrollBy({ left: direction * 320, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    async function fetchData() {
      try {
        // Fetch all published questions with vote counts
        const [{ data: questionsData }, { data: profileData }] = await Promise.all([
          supabase
            .from('questions')
            .select('id, text, category, domain, geo_scope, country_code')
            .not('published_at', 'is', null)
            .lte('published_at', new Date().toISOString())
            .order('created_at', { ascending: false }),
          supabase
            .from('profiles')
            .select('country_code')
            .eq('id', user.id)
            .single(),
        ])

        setUserCountry(profileData?.country_code || null)

        function shuffle(array) {
          for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[array[i], array[j]] = [array[j], array[i]]
          }
          return array
        }

        setQuestions(shuffle(questionsData || []))

        // Fetch user's votes
        const { data: votesData } = await supabase
          .from('votes')
          .select('question_id, choice')
          .eq('user_id', user.id)

        const votesMap = {}
        ;(votesData || []).forEach(v => { votesMap[v.question_id] = v.choice })
        setUserVotes(votesMap)

      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [user])

  function handleThumbnailClick(question) {
    const userVote = userVotes[question.id]
    if (userVote) {
      navigate(`/conversation/${question.id}`)
    } else {
      navigate(`/vote?question=${question.id}`, { state: { from: '/explore' } })
    }
  }

  function isCountrySpecific(q) {
    return q.geo_scope === 'country' || q.geo_scope === 'regional'
  }

  function isForMyCountry(q) {
    if (!isCountrySpecific(q)) return false
    if (!q.country_code || !userCountry) return false
    return q.country_code === userCountry
  }

  function isForOtherCountry(q) {
    if (!isCountrySpecific(q)) return false
    if (!q.country_code || !userCountry) return false
    return q.country_code !== userCountry
  }

  const getQuestionsForDomain = (domain) => {
    return questions.filter(q => {
      if (q.domain !== domain) return false
      if (isCountrySpecific(q)) return false
      if (unansweredOnly && userVotes[q.id]) return false
      return true
    })
  }

  const getMyCountryQuestions = () => {
    return questions.filter(q => {
      if (!isForMyCountry(q)) return false
      if (unansweredOnly && userVotes[q.id]) return false
      return true
    })
  }

  const getOtherCountryQuestions = () => {
    return questions.filter(q => {
      if (!isForOtherCountry(q)) return false
      if (unansweredOnly && userVotes[q.id]) return false
      return true
    })
  }

  if (loading) {
    return (
      <div style={{ maxWidth: '100%', fontFamily: 'Merriweather, serif', padding: '1.25rem', paddingBottom: '80px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ marginBottom: '1.75rem' }}>
            <Skeleton height="13px" width="30%" style={{ marginBottom: '0.75rem' }} />
            <div style={{ display: 'flex', gap: '10px', overflowX: 'hidden' }}>
              {[1, 2, 3].map(j => (
                <Skeleton key={j} width="140px" height="160px" borderRadius="12px" style={{ flexShrink: 0 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '100%', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', minHeight: '100dvh', paddingBottom: '90px', background: '#F9FAFB' }}>

      {/* Header */}
      <div style={{ padding: '1.25rem 1.25rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
          sense<AnimatedWordmark />
        </div>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A' }}>Explore</div>
        <div style={{ width: '60px' }} />
      </div>

      {/* Toggle */}
      <div style={{ padding: '0 1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'inline-flex', background: '#F3F4F6', borderRadius: '8px', padding: '3px' }}>
          <button
            onClick={() => setUnansweredOnly(false)}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              fontSize: '12px', fontWeight: 500, fontFamily: 'Merriweather, serif',
              background: !unansweredOnly ? '#2D3DCA' : 'transparent',
              color: !unansweredOnly ? 'white' : '#6B7280',
            }}
          >
            All questions
          </button>
          <button
            onClick={() => setUnansweredOnly(true)}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              fontSize: '12px', fontWeight: 500, fontFamily: 'Merriweather, serif',
              background: unansweredOnly ? '#2D3DCA' : 'transparent',
              color: unansweredOnly ? 'white' : '#6B7280',
            }}
          >
            Unanswered only
          </button>
        </div>
      </div>

      {/* Domain rows */}
      {DOMAINS.map(domain => {
        const domainQuestions = getQuestionsForDomain(domain)
        if (domainQuestions.length === 0) return null
        return (
          <div key={domain} style={{ marginBottom: '1.75rem' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                {domainLabel(domain)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                  {domainQuestions.length} question{domainQuestions.length !== 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => scrollRow(domain, -1)}
                    aria-label="Scroll left"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => scrollRow(domain, 1)}
                    aria-label="Scroll right"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
            <div
              ref={(el) => (scrollRefs.current[domain] = el)}
              style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingLeft: '1.25rem', paddingRight: '1.25rem', paddingBottom: '8px', scrollbarWidth: 'none' }}
            >
              {domainQuestions.map(question => (
                <QuestionThumbnail
                  key={question.id}
                  question={question}
                  userVote={userVotes[question.id]}
                  onClick={() => handleThumbnailClick(question)}
                />
              ))}
            </div>
          </div>
        )
      })}

{(() => {
        const myCountryQuestions = getMyCountryQuestions()
        if (myCountryQuestions.length === 0) return null
        return (
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                  My Country
                </div>
                <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>
                  Questions specific to where you live
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                  {myCountryQuestions.length} question{myCountryQuestions.length !== 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => scrollRow('__mycountry__', -1)}
                    aria-label="Scroll left"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => scrollRow('__mycountry__', 1)}
                    aria-label="Scroll right"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
            <div
              ref={(el) => (scrollRefs.current['__mycountry__'] = el)}
              style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingLeft: '1.25rem', paddingRight: '1.25rem', paddingBottom: '8px', scrollbarWidth: 'none' }}
            >
              {myCountryQuestions.map(question => (
                <QuestionThumbnail
                  key={question.id}
                  question={question}
                  userVote={userVotes[question.id]}
                  onClick={() => handleThumbnailClick(question)}
                />
              ))}
            </div>
          </div>
        )
      })()}

      {(() => {
        const otherCountryQuestions = getOtherCountryQuestions()
        if (otherCountryQuestions.length === 0) return null
        return (
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                  Around the World
                </div>
                <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>
                  Questions specific to other countries
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                  {otherCountryQuestions.length} question{otherCountryQuestions.length !== 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => scrollRow('__global__', -1)}
                    aria-label="Scroll left"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => scrollRow('__global__', 1)}
                    aria-label="Scroll right"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
            <div
              ref={(el) => (scrollRefs.current['__global__'] = el)}
              style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingLeft: '1.25rem', paddingRight: '1.25rem', paddingBottom: '8px', scrollbarWidth: 'none' }}
            >
              {otherCountryQuestions.map(question => (
                <QuestionThumbnail
                  key={question.id}
                  question={question}
                  userVote={userVotes[question.id]}
                  onClick={() => handleThumbnailClick(question)}
                />
              ))}
            </div>
          </div>
        )
      })()}

      {questions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 1.5rem', color: '#6B7280', fontSize: '14px' }}>
          No questions available yet.
        </div>
      )}

      <BottomNav />
    </div>
  )
}