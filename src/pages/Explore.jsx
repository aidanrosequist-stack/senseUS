import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Skeleton } from '../components/ui/Skeleton'
import { useLongPress } from '../hooks/useLongPress'
import CardActionSheet from '../components/ui/CardActionSheet'
import VisuallyHidden from '../components/ui/VisuallyHidden'
import { usePageTitle } from '../hooks/usePageTitle'

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

function QuestionThumbnail({ question, userVote, onClick, onLongPress }) {
  const voted = !!userVote
  const longPress = useLongPress(() => onLongPress(question))
  const bgColor = voted ? VOTE_COLORS[userVote] : '#FFFFFF'
  const textColor = voted ? 'white' : '#1A1A1A'

  return (
    <div
      onClick={() => { if (!longPress.wasLongPress()) onClick() }}
      {...longPress}
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

function SearchResultCard({ question, userVote, onClick, onLongPress }) {
  const voted = !!userVote
  const longPress = useLongPress(() => onLongPress(question))
  return (
    <div
      onClick={() => { if (!longPress.wasLongPress()) onClick() }}
      {...longPress}
      style={{
        background: voted ? VOTE_COLORS[userVote] : '#FFFFFF',
        border: voted ? 'none' : '0.5px solid #E5E7EB',
        borderRadius: '10px',
        padding: '12px 14px',
        marginBottom: '10px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{
        fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '20px', display: 'inline-block', marginBottom: '8px',
        background: voted ? 'rgba(255,255,255,0.25)' : '#E6F1FB',
        color: voted ? 'white' : '#0C447C',
      }}>
        {question.category}
      </div>
      <div style={{ fontSize: '13px', color: voted ? 'white' : '#1A1A1A', lineHeight: 1.5, marginBottom: voted ? '8px' : 0, fontFamily: 'Merriweather, serif' }}>
        {question.text}
      </div>
      {voted && (
        <div style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(255,255,255,0.25)', color: 'white', display: 'inline-block', fontWeight: 500 }}>
          {VOTE_LABELS[userVote]}
        </div>
      )}
    </div>
  )
}

export default function Explore() {
  usePageTitle('Explore')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [questions, setQuestions] = useState([])
  const [userVotes, setUserVotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [unansweredOnly, setUnansweredOnly] = useState(false)
  const scrollRefs = useRef({})
  const [userCountry, setUserCountry] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionSheetQuestion, setActionSheetQuestion] = useState(null)
  const [showLongPressHint, setShowLongPressHint] = useState(
    localStorage.getItem('senseus_seen_longpress_hint_explore') !== 'true'
  )

  function shareQuestionCard(question) {
    if (!question?.question_number) return
    const url = `https://senseus.app/q/${question.question_number}`
    const shareData = { title: 'senseUS', text: 'What do you think?', url }
    if (navigator.share) {
      navigator.share(shareData).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!')).catch(() => prompt('Copy this link:', url))
    }
  }

  function scrollRow(domain, direction) {
    const el = scrollRefs.current[domain]
    if (el) el.scrollBy({ left: direction * 320, behavior: 'smooth' })
  }

  /* eslint-disable react-hooks/set-state-in-effect -- async data fetch (questions, profile, votes); inherently depends on network results */
  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    async function fetchData() {
      try {
        // Fetch published questions with vote counts. The domain-row browsing
        // UX (below) needs its working set loaded client-side to bucket into
        // rows, so this can't be paginated the normal way without redesigning
        // that UX — but it was previously fetched with no limit at all, which
        // means it grows without bound as the catalog grows. Capping at the
        // 500 most recent published questions keeps the browse experience
        // working exactly as before for the foreseeable future while putting
        // a ceiling on the payload; text search (which does need to reach
        // further back than 500) now runs server-side via search_questions
        // instead of scanning this array, so it isn't limited by this cap.
        const [{ data: questionsData }, { data: profileData }] = await Promise.all([
          supabase
            .from('questions')
            .select('id, text, category, domain, geo_scope, country_code, is_current_event, is_sponsored, archived_at, question_number')
            .not('published_at', 'is', null)
            .lte('published_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(500),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user.id, not the user object, is the real dependency (see ProtectedRoute.jsx for the same pattern). AuthContext hands out a new user object reference on every onAuthStateChange firing, including Supabase's routine hourly token refresh — depending on the whole object here would re-shuffle and re-fetch the whole question list under the user's feet on every refresh.
  }, [user?.id])
  /* eslint-enable react-hooks/set-state-in-effect */

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

  // Previously six separate functions (getQuestionsForDomain × 10 calls,
  // getMyCountryQuestions, getOtherCountryQuestions, getCurrentEventQuestions,
  // getSponsoredQuestions), each its own unmemoized full scan of `questions`,
  // called fresh on every render — including renders triggered by state that
  // has nothing to do with bucketing (e.g. showLongPressHint). One memoized
  // pass here builds every bucket in a single walk over the array, and only
  // recomputes when the inputs that actually affect bucketing change.
  const buckets = useMemo(() => {
    const byDomain = {}
    DOMAINS.forEach(d => { byDomain[d] = [] })
    const myCountry = []
    const otherCountry = []
    const currentEvents = []
    const sponsored = []

    for (const q of questions) {
      if (unansweredOnly && userVotes[q.id]) continue

      if (q.is_sponsored) {
        if (!q.archived_at) sponsored.push(q)
        continue
      }
      if (q.is_current_event) {
        if (!q.archived_at) currentEvents.push(q)
        continue
      }
      if (isCountrySpecific(q)) {
        if (isForMyCountry(q)) myCountry.push(q)
        else if (isForOtherCountry(q)) otherCountry.push(q)
        continue
      }
      if (byDomain[q.domain]) byDomain[q.domain].push(q)
    }

    return { byDomain, myCountry, otherCountry, currentEvents, sponsored }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, unansweredOnly, userVotes, userCountry])

  // Search used to be a client-side .filter() over `questions` on every
  // keystroke — fine while that array was unbounded, but now that the
  // catalog fetch above is capped at the 500 most recent questions (see
  // comment there), an older question wouldn't be searchable at all if
  // search stayed client-side. It now runs server-side via the
  // search_questions RPC instead, debounced so it fires once typing pauses
  // rather than once per keystroke.
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed) {
      setSearchResults([])
      setSearching(false)
      return
    }

    let ignore = false
    setSearching(true)
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('search_questions', { p_query: trimmed })
      if (ignore) return
      setSearchResults((data || []).filter(q => !(unansweredOnly && userVotes[q.id])))
      setSearching(false)
    }, 300)

    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [searchQuery, unansweredOnly, userVotes])

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', boxSizing: 'border-box', background: '#C7C7CC', paddingBottom: '80px' }}>
        <div style={{ padding: '14px', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: '480px', margin: '0 auto', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: '20px', boxShadow: '0 8px 32px rgba(0,0,0,0.22)', padding: '1.25rem' }}>
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
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box', background: '#C7C7CC', paddingBottom: '90px' }}>
    <VisuallyHidden as="h1">Explore</VisuallyHidden>
    <div style={{ padding: '14px', boxSizing: 'border-box' }}>
    {/* No horizontal padding here (unlike Profile/Activity's card) — every
        section below already carries its own '0 1.25rem' inset, which used
        to be measured against the full page width. Padding the card too
        would double up and squeeze the horizontal-scroll rows. */}
    <div style={{ maxWidth: '480px', margin: '0 auto', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: '20px', boxShadow: '0 8px 32px rgba(0,0,0,0.22)', padding: '1.5rem 0' }}>

      {/* Page title */}
      <div style={{ padding: '1.25rem 1.25rem 0', marginBottom: '1rem' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A' }}>Explore</div>
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

      {/* Search */}
      <div style={{ padding: '0 1.25rem', marginBottom: '1.25rem' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search questions..."
          aria-label="Search questions"
          style={{ width: '100%', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'Merriweather, serif', boxSizing: 'border-box' }}
        />
      </div>

{showLongPressHint && (
        <div style={{ margin: '0 1.25rem 1.25rem', background: '#E6F1FB', border: '1px solid #0C447C', borderRadius: '10px', padding: '10px 14px', fontSize: '12px', color: '#0C447C', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <span>Tip: hold a card for more options, like sharing.</span>
          <button
            onClick={() => {
              localStorage.setItem('senseus_seen_longpress_hint_explore', 'true')
              setShowLongPressHint(false)
            }}
            style={{ background: 'none', border: 'none', color: '#0C447C', fontSize: '16px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Domain rows */}
      {searchQuery.trim() ? (
        <div style={{ padding: '0 1.25rem' }}>
          {searching ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '14px' }}>
              Searching...
            </div>
          ) : searchResults.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '14px' }}>
              No questions match "{searchQuery}"
            </div>
          ) : (
            searchResults.map(question => (
              <SearchResultCard
              onLongPress={setActionSheetQuestion}
                key={question.id}
                question={question}
                userVote={userVotes[question.id]}
                onClick={() => handleThumbnailClick(question)}
              />
            ))
          )}
        </div>
      ) : (
      <>
      {(() => {
        const sponsoredQuestions = buckets.sponsored
        if (sponsoredQuestions.length === 0) return null
        return (
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                🏷️ Sponsored
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: '#6B7280' }}>
                  {sponsoredQuestions.length} question{sponsoredQuestions.length !== 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => scrollRow('__sponsored__', -1)}
                    aria-label="Scroll left"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => scrollRow('__sponsored__', 1)}
                    aria-label="Scroll right"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
            <div
              ref={(el) => (scrollRefs.current['__sponsored__'] = el)}
              style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingLeft: '1.25rem', paddingRight: '1.25rem', paddingBottom: '8px', scrollbarWidth: 'none' }}
            >
              {sponsoredQuestions.map(question => (
                <QuestionThumbnail
                onLongPress={setActionSheetQuestion}
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
        const currentEventQuestions = buckets.currentEvents
        if (currentEventQuestions.length === 0) return null
        return (
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                🔴 Current Events
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: '#6B7280' }}>
                  {currentEventQuestions.length} question{currentEventQuestions.length !== 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => scrollRow('__currentevents__', -1)}
                    aria-label="Scroll left"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => scrollRow('__currentevents__', 1)}
                    aria-label="Scroll right"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #D1D5DB', background: 'white', color: '#6B7280', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
            <div
              ref={(el) => (scrollRefs.current['__currentevents__'] = el)}
              style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingLeft: '1.25rem', paddingRight: '1.25rem', paddingBottom: '8px', scrollbarWidth: 'none' }}
            >
              {currentEventQuestions.map(question => (
                <QuestionThumbnail
                onLongPress={setActionSheetQuestion}
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
      {/* Domain rows */}
      {DOMAINS.map(domain => {
        const domainQuestions = buckets.byDomain[domain] || []
        if (domainQuestions.length === 0) return null
        return (
          <div key={domain} style={{ marginBottom: '1.75rem' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                {domainLabel(domain)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: '#6B7280' }}>
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
                onLongPress={setActionSheetQuestion}
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
        const myCountryQuestions = buckets.myCountry
        if (myCountryQuestions.length === 0) return null
        return (
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                  My Country
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                  Questions specific to where you live
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: '#6B7280' }}>
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
                onLongPress={setActionSheetQuestion}
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
        const otherCountryQuestions = buckets.otherCountry
        if (otherCountryQuestions.length === 0) return null
        return (
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                  Around the World
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                  Questions specific to other countries
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: '#6B7280' }}>
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
                onLongPress={setActionSheetQuestion}
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
  </>
      )}

      {questions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 1.5rem', color: '#6B7280', fontSize: '14px' }}>
          No questions available yet.
        </div>
      )}

{actionSheetQuestion && (
        <CardActionSheet
          title={actionSheetQuestion.text}
          onClose={() => setActionSheetQuestion(null)}
          actions={[
            { label: 'Share this question', onClick: () => shareQuestionCard(actionSheetQuestion) },
            { label: 'View', onClick: () => handleThumbnailClick(actionSheetQuestion) },
          ]}
        />
      )}
    </div>
    </div>
    </div>
  )
}