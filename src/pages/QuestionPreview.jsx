import { useState, useEffect, useCallback, useRef } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f',
}

export default function QuestionPreview() {
  usePageTitle('Question Preview')
  const { number } = useParams()
  const originNumber = useRef(parseInt(number, 10))
  const [currentNum, setCurrentNum] = useState(parseInt(number, 10))
  const { user } = useAuth()
  const [question, setQuestion] = useState(null)
  const [tally, setTally] = useState({ yes: 0, ly: 0, ln: 0, no: 0 })
  const [loading, setLoading] = useState(true)
  const [sliding, setSliding] = useState(null)
  const [maxNumber, setMaxNumber] = useState(null)
  const [hasVoted, setHasVoted] = useState(false)

  const minAllowed = Math.max(1, originNumber.current - 2)
  const maxAllowed = originNumber.current + 2

  const [sharedComment, setSharedComment] = useState(false)

  /* eslint-disable-next-line react-hooks/set-state-in-effect -- reads window.location.hash on mount; a reasonable candidate for a lazy useState initializer if this file gets revisited, but suppressing for now to match today's approach */
  useEffect(() => {
    const hash = window.location.hash
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads window.location.hash on mount
    if (hash && hash.startsWith('#comment-')) {
      setSharedComment(true)
    }
  }, [])

   /* eslint-disable react-hooks/set-state-in-effect -- async question/tally fetch */
  useEffect(() => {
    // Nothing previously guarded against out-of-order responses. Rapid
    // navigation (a held arrow key before the goTo fix above, or just
    // fast swiping/network jitter — this page is the target of shared
    // links, so traffic bursts are the expected case) could let an
    // earlier question's fetch resolve after a later one, silently
    // showing mismatched question text/tallies. `ignore` is flipped in
    // the cleanup below whenever a newer effect run supersedes this one,
    // and every setState is skipped once that happens.
    let ignore = false

    async function fetchData() {
      setLoading(true)
      try {
        const { data: q } = await supabase
          .from('questions')
          .select('id, text, category, domain, question_number')
          .eq('question_number', currentNum)
          .not('published_at', 'is', null)
          .lte('published_at', new Date().toISOString())
          .eq('human_moderation_required', false)
          .single()

        if (ignore) return
        if (!q) { setLoading(false); return }
        setQuestion(q)

        const { data: tallyRow } = await supabase
          .rpc('get_vote_tally', { p_question_id: q.id })
          .single()

        if (ignore) return
        setTally(tallyRow
          ? { yes: tallyRow.yes, ly: tallyRow.ly, ln: tallyRow.ln, no: tallyRow.no }
          : { yes: 0, ly: 0, ln: 0, no: 0 }
        )

         if (user) {
          const { data: voteRow } = await supabase
            .from('votes')
            .select('id')
            .eq('user_id', user.id)
            .eq('question_id', q.id)
            .maybeSingle()
          if (ignore) return
          setHasVoted(!!voteRow)
        } else {
          if (ignore) return
          setHasVoted(false)
        }

        if (!maxNumber) {
          const { data: maxQ } = await supabase
            .from('questions')
            .select('question_number')
            .not('published_at', 'is', null)
            .order('question_number', { ascending: false })
            .limit(1)
            .single()
          if (ignore) return
          if (maxQ) setMaxNumber(maxQ.question_number)
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    fetchData()

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user?.id, not the user object, is the real dependency (see ProtectedRoute.jsx for the same pattern). AuthContext hands out a new user object reference on every onAuthStateChange firing, including Supabase's routine hourly token refresh.
  }, [currentNum, user?.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  const canGoPrev = currentNum > 1 && currentNum > minAllowed
  const canGoNext = (!maxNumber || currentNum < maxNumber) && currentNum < maxAllowed

  const goTo = useCallback((direction) => {
    // The wheel handler below debounces itself with a 600ms timeout, but
    // nothing previously stopped goTo itself from being called again
    // while a transition was already in flight — and keydown auto-repeats
    // continuously while a key is held. A held or rapidly-tapped arrow
    // key could queue several unconditional advances within one 280ms
    // transition window, each re-triggering fetchData's question/tally/
    // vote-check round trip, on a page whose whole purpose is receiving
    // shared-link traffic bursts. Bailing out while `sliding` is already
    // set closes that off, the same way the wheel handler debounces.
    if (sliding) return
    if (direction === 'next' && !canGoNext) return
    if (direction === 'prev' && !canGoPrev) return
    setSliding(direction === 'next' ? 'up' : 'down')
    setTimeout(() => {
      setSliding(null)
      setCurrentNum(prev => direction === 'next' ? prev + 1 : prev - 1)
    }, 280)
  }, [canGoNext, canGoPrev, sliding])

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'ArrowDown') goTo('next')
      if (e.key === 'ArrowUp') goTo('prev')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goTo])

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
    <div style={{ width: '100%', minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: '#C7C7CC', fontFamily: 'Merriweather, serif' }}>

      {/* Header — never re-renders */}
      <div style={{ background: '#FFFFFF', padding: '0.85rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 8px rgba(0,0,0,0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img
            src="/senseUS-logo.png"
            alt="senseUS"
            style={{ height: '40px', width: 'auto' }}
          />
          <div>
            <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
              sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
            </div>
            <div style={{ fontSize: '9px', color: '#6B7280', letterSpacing: '0.04em', marginTop: '1px' }}>
              real humans. real opinions. real truth.
            </div>
          </div>
        </div>
          <Link
              to={user && hasVoted
                ? `/conversation/${question?.id}`
                : user
                ? `/vote?question=${question?.id}`
                : sharedComment
                ? `/register?from=q&q=${currentNum}`
                : `/register`
              }
          style={{ fontSize: '12px', fontWeight: 700, color: '#FFFFFF', background: '#2D3DCA', padding: '6px 14px', borderRadius: '20px', textDecoration: 'none' }}
        >
          Join free
        </Link>
      </div>

      {/* Card area — only this slides */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem', overflow: 'hidden' }}>
        <div style={{ width: '100%', maxWidth: '420px', ...slideStyle }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem 0' }}><LoadingSpinner /></div>
          ) : !question ? (
            <div style={{ textAlign: 'center', color: '#6B7280', padding: '3rem 0' }}>Question not found.</div>
          ) : (
            <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '1.5rem', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '10px', fontWeight: 500, padding: '3px 10px', borderRadius: '20px', background: '#E6F1FB', color: '#0C447C' }}>
                  {question.category}
                </span>
                <span style={{ fontSize: '11px', color: '#6B7280' }}>#{question.question_number}</span>
              </div>

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
                    <span style={{ color: '#6B7280', fontSize: '11px' }}>{total.toLocaleString()} verified humans answered</span>
                    <span style={{ color: '#8a1616', fontWeight: 500 }}>{pctNo}% no</span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1.25rem', textAlign: 'center' }}>
                  Be the first to vote on this question.
                </div>
              )}

              <div style={{ height: '1px', background: '#E5E7EB', marginBottom: '1rem' }} />

            {sharedComment && (
              <div style={{ background: '#E6F1FB', border: '1px solid #0C447C', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px', fontSize: '12px', color: '#0C447C', lineHeight: 1.6, textAlign: 'center' }}>
                Someone shared a comment with you. Join senseUS to vote, see the conversation, and share yours.
              </div>
            )}

            <Link
              to={user && hasVoted
                ? `/conversation/${question?.id}`
                : user
                ? `/vote?question=${question?.id}`
                : sharedComment
                ? `/register?from=q&q=${currentNum}`
                : `/register?from=q&q=${currentNum}`
              }
              style={{ display: 'block', width: '100%', padding: '12px', background: '#2D3DCA', color: 'white', borderRadius: '10px', fontSize: '14px', fontWeight: 700, textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box', marginBottom: '8px' }}
            >
              {user && hasVoted
                ? 'Go to the conversation'
                : user
                ? 'Vote on this question'
                : sharedComment
                ? 'Join to see the comment'
                : 'Vote on this question'}
            </Link>
            {!user && (
              <div style={{ textAlign: 'center', fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>
                Already have an account?{' '}
                <Link
                  to="/login"
                  state={{ from: `/q/${currentNum}` }}
                  style={{ color: '#2D3DCA', fontWeight: 500, textDecoration: 'none' }}
                >
                  Log in
                </Link>
              </div>
            )}
            <div style={{ textAlign: 'center', fontSize: '12px', color: '#6B7280' }}>
              Join senseUS — free, verified, no ads
            </div>
            </div>
          )}

          {/* Nav hints */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
            {canGoPrev && (
              <div style={{ background: 'rgba(255,255,255,0.85)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#6B7280', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
                ↑ prev
              </div>
            )}
            {canGoNext && (
              <div style={{ background: 'rgba(255,255,255,0.85)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#6B7280', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
                ↓ next
              </div>
            )}
            {!canGoPrev && !canGoNext && (
              <div style={{ background: 'rgba(255,255,255,0.85)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#6B7280', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
                Join senseUS to see all {maxNumber} questions
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Footer — never re-renders */}
      <div style={{ background: '#FFFFFF', padding: '0.85rem 1.25rem', borderTop: '0.5px solid #E5E7EB', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '10px', color: '#6B7280' }}>© Gudboi Enterprises, LLC</div>
         <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <Link to="/privacy" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Privacy</Link>
            <Link to="/terms" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Terms</Link>
            <Link to="/how-it-works" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>How It Works</Link>
            <Link to="/ethos" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Our Ethos</Link>
          </div>
        </div>
      </div>

    </div>
  )
}