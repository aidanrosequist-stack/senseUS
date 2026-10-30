import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuestions } from '../hooks/useQuestions'
import QuestionFlow from '../components/vote/QuestionFlow'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { HEADER_HEIGHT_PX } from '../components/layout/Header'
import { BOTTOM_NAV_HEIGHT_PX } from '../components/layout/BottomNav'
import VisuallyHidden from '../components/ui/VisuallyHidden'
import { usePageTitle } from '../hooks/usePageTitle'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function Vote() {
  usePageTitle('Vote')
  const { user } = useAuth()
  const { questions, loading, error, usingFallbackPool } = useQuestions(user?.id)
  // This used to be a useState *initializer* reading usingFallbackPool
  // directly — but useQuestions starts with usingFallbackPool false and
  // only sets it (asynchronously, after its fetch resolves) once
  // loading finishes. A useState initializer only runs once, on this
  // component's very first render, when usingFallbackPool is always
  // still false — so this notice was never actually showing for anyone,
  // regardless of whether the fallback pool genuinely kicked in. An
  // effect that reacts to usingFallbackPool actually changing fixes it.
  const [showGlobalNotice, setShowGlobalNotice] = useState(false)
  useEffect(() => {
    if (usingFallbackPool && localStorage.getItem('senseus_seen_global_notice') !== 'true') {
      setShowGlobalNotice(true)
    }
  }, [usingFallbackPool])
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const targetQuestionId = searchParams.get('question')
  const currentVoteParam = searchParams.get('currentVote')
  const location = useLocation()
  const from = location.state?.from || '/vote'
  const [targetQuestion, setTargetQuestion] = useState(null)
  const [pinnedQuestions, setPinnedQuestions] = useState(new Set())
  const [partyQuestions, setPartyQuestions] = useState(new Set())

  // Same fetch-once-per-user shape as Explore.jsx's pinnedQuestions —
  // loaded independently here rather than threaded in from Explore since
  // this page can be reached directly (bottom nav, a deep link) without
  // ever visiting Explore first.
  useEffect(() => {
    if (!user) {
      setPinnedQuestions(new Set())
      setPartyQuestions(new Set())
      return
    }
    let cancelled = false
    async function fetchPinnedAndParty() {
      const [{ data: pinned }, { data: party }] = await Promise.all([
        supabase.from('pinned_questions').select('question_id').eq('user_id', user.id),
        supabase.from('party_questions').select('question_id').eq('user_id', user.id),
      ])
      if (!cancelled) {
        setPinnedQuestions(new Set((pinned || []).map(row => row.question_id)))
        setPartyQuestions(new Set((party || []).map(row => row.question_id)))
      }
    }
    fetchPinnedAndParty()
    return () => { cancelled = true }
  }, [user?.id])

  // Optimistic toggle, same shape as Explore.jsx's togglePinQuestion.
  async function togglePinQuestion(questionId) {
    if (!user) return
    const isPinned = pinnedQuestions.has(questionId)

    if (isPinned) {
      const { error } = await supabase.from('pinned_questions').delete()
        .eq('question_id', questionId).eq('user_id', user.id)
      if (error) { alert('Something went wrong — please try again.'); return }
      setPinnedQuestions(prev => { const s = new Set(prev); s.delete(questionId); return s })
    } else {
      const { error } = await supabase.from('pinned_questions').insert({ question_id: questionId, user_id: user.id })
      if (error) { alert('Something went wrong — please try again.'); return }
      setPinnedQuestions(prev => new Set([...prev, questionId]))
    }
  }

  // Same shape as togglePinQuestion, against party_questions (migration
  // 095_question_parties.sql) — the standing "? Party" curation list.
  // Capped at 10 by a server-side trigger; that rejection's own message
  // ("You can curate up to 10 questions for a party.") is already
  // friendly enough to show directly, unlike the generic fallback used
  // for anything else going wrong.
  async function togglePartyQuestion(questionId) {
    if (!user) return
    const isAdded = partyQuestions.has(questionId)

    if (isAdded) {
      const { error } = await supabase.from('party_questions').delete()
        .eq('question_id', questionId).eq('user_id', user.id)
      if (error) { alert('Something went wrong — please try again.'); return }
      setPartyQuestions(prev => { const s = new Set(prev); s.delete(questionId); return s })
    } else {
      const { error } = await supabase.from('party_questions').insert({ question_id: questionId, user_id: user.id })
      if (error) { alert(error.message || 'Something went wrong — please try again.'); return }
      setPartyQuestions(prev => new Set([...prev, questionId]))
    }
  }

  useEffect(() => {
    if (!targetQuestionId || !user) return

    // A deep link like /vote?question=<id> (shares, "change your vote",
    // notifications) used to always fetch that question separately, even
    // when it's already sitting in the batch useQuestions just loaded —
    // the common case for a freshly shared, still-unanswered question.
    // Skip the extra round trip when it's already there.
    if (questions.some(q => q.id === targetQuestionId)) return

    async function fetchTargetQuestion() {
      const { data } = await supabase
        .from('questions')
        .select('id, text, category, domain, geo_scope, question_number, is_sponsored')
        .eq('id', targetQuestionId)
        .single()

      if (data) {
        const { data: tallyRow } = await supabase
          .rpc('get_vote_tally', { p_question_id: targetQuestionId })
          .single()

        const counts = tallyRow
          ? { yes: tallyRow.yes, ly: tallyRow.ly, ln: tallyRow.ln, no: tallyRow.no }
          : { yes: 0, ly: 0, ln: 0, no: 0 }

        let sponsorName = null
        if (data.is_sponsored) {
          const { data: sponsor } = await supabase
            .from('public_sponsors')
            .select('sponsor_name')
            .eq('question_id', targetQuestionId)
            .maybeSingle()
          sponsorName = sponsor?.sponsor_name || null
        }

        // This question missed the fresh useQuestions() batch above for
        // one of two reasons: get_candidate_questions already excludes
        // anything this user has voted on or skipped, OR it's a
        // brand-new deep link (Explore, a share, /q/:number) to a
        // question that batch just hasn't surfaced yet. Those two cases
        // need different treatment below (already-voted vs. genuinely
        // new), so look up whether a vote actually exists now rather
        // than assuming from context. votes_user_id_question_id_key
        // (migration 000) makes this a single indexed-row lookup, not a
        // scan.
        //
        // This used to trust the URL's own ?currentVote= param instead
        // (only set by Activity.jsx's "Change my vote" links) — which
        // silently went stale the moment someone reached this same URL
        // a second time after their vote had changed. Concretely: vote
        // via a plain Explore/share link (/vote?question=<id>, no
        // currentVote param at all) -> tap "Join the conversation" ->
        // comment -> tap "< back" (Conversation.jsx's navigate(-1)) ->
        // lands right back on that same /vote?question=<id> URL. The
        // fresh batch correctly excludes the now-voted question, so this
        // effect's fallback fetch runs again — and with no currentVote
        // param to fall back on, the vote card rendered as if never
        // voted at all (Aidan, 2026-09-28), even though the vote itself
        // was recorded correctly (confirmed via /activity). A live
        // lookup here is correct regardless of which link shape got the
        // user here or how stale the URL in their history is.
        const { data: myVoteRow } = await supabase
          .from('votes')
          .select('choice')
          .eq('user_id', user.id)
          .eq('question_id', targetQuestionId)
          .maybeSingle()

        setTargetQuestion({ ...data, votes: counts, replyCount: 0, sponsor_name: sponsorName, myVoteChoice: myVoteRow?.choice ?? null })
      }
    }

    fetchTargetQuestion()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user?.id, not the user object, is the real dependency (see ProtectedRoute.jsx for the same pattern). AuthContext hands out a new user object reference on every onAuthStateChange firing, including Supabase's routine hourly token refresh.
  }, [targetQuestionId, user?.id, questions])

  async function handleVote(questionId, choice) {
    if (!user) return null

    // integrity_weight_at_vote and pct_yes_at_vote/pct_no_at_vote are no
    // longer computed here — the secure_vote_fields_trigger on the votes
    // table overwrites both server-side on every insert/update, so the
    // client can no longer influence a vote's weight or recorded tally
    // snapshot. See migration 007_secure_vote_fields.sql.
    //
    // This used to be up to four sequential round trips: a SELECT to
    // check for an existing vote (just to know whether to increment
    // answers_count), the upsert itself, a conditional increment RPC,
    // then a separate tally refetch. Casting a vote is the single
    // most-repeated action in the app, so that's now one round trip via
    // cast_vote, which does all four steps server-side in one
    // transaction and returns the fresh tally directly. See migration
    // 017_cast_vote_rpc.sql.
    const { data: freshTally, error: voteError } = await supabase
      .rpc('cast_vote', { p_question_id: questionId, p_choice: choice })
      .single()

    if (voteError) {
      console.error('Vote error:', voteError)
      throw new Error('Your vote could not be saved. Please check your connection and try again.')
    }

    // cast_vote() rejects a vote fired under 1 second after the same
    // user's last one (any question) by returning normally with
    // rejected_reason set, rather than raising — see migration
    // 055_cast_vote_cooldown.sql for why it's a return value here and
    // not a thrown Postgres exception. Surface it as a distinct message
    // rather than lumping it in with an actual save failure.
    if (freshTally?.rejected_reason === 'cooldown') {
      throw new Error("You're voting a little too fast — give it a second and try again.")
    }

    // A question can be pulled from moderation after it was already loaded
    // into this client's feed (or reached via a deep link/stale tab) — see
    // migration 071_pull_question_moderation.sql. cast_vote() rejects the
    // attempt the same way it rejects a cooldown (return normally with
    // rejected_reason set, not a thrown exception, so the block itself
    // still logs durably) rather than silently recording nothing.
    if (freshTally?.rejected_reason === 'question_pulled') {
      throw new Error('This question is no longer available.')
    }

    // was_new_vote/answers_count (migration 073) let QuestionFlow decide
    // authoritatively whether this is the account's genuine first-ever
    // vote, instead of the old localStorage-only guess — see that
    // migration's own comment for why answers_count alone isn't enough
    // on its own (a change to your one-and-only vote wouldn't increment
    // it either) and was_new_vote is needed alongside it.
    return freshTally
      ? { yes: freshTally.yes, ly: freshTally.ly, ln: freshTally.ln, no: freshTally.no, wasNewVote: freshTally.was_new_vote, answersCount: freshTally.answers_count }
      : { yes: 0, ly: 0, ln: 0, no: 0, wasNewVote: false, answersCount: null }
  }
  
  async function handleHideQuestion(questionId) {
    if (!user) return
    const { error } = await supabase.from('question_skips').insert({ user_id: user.id, question_id: questionId })
    if (error) {
      console.error('Hide question error:', error)
      throw new Error('This question could not be hidden. Please try again.')
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100svh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        <LoadingSpinner label="Loading questions..." />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100svh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#7a1313' }}>
        Error loading questions. Please try again.
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        // This used to be a flat 100dvh, sized on the assumption that
        // Header was rendered inside this same div (its old first child).
        // Now Header lives above this in AppShell, so this div only gets
        // the rest of the viewport underneath it — hence the subtraction.
        height: `calc(100svh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`,
        background: '#C7C7CC',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '0',
        // No paddingBottom here anymore — this height calc already
        // subtracts BottomNav's real height above, so there's nothing left
        // for extra bottom padding to clear. The 74px that used to be here
        // predates BottomNav switching to `position: sticky` (see its own
        // comment): back when it was `fixed`, it could overlap this page's
        // content, so padding was needed to hold content clear of it.
        // Sticky already reserves its own space in the document flow, so
        // this had become 74px of pure dead space under the vote card —
        // and, worse, 74px *less* height for the card itself to work with,
        // which is what was contributing to content getting clipped at the
        // bottom of some cards.
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <VisuallyHidden as="h1">Vote</VisuallyHidden>
      {showGlobalNotice && (
        <div style={{ position: 'absolute', top: '60px', left: '16px', right: '16px', background: '#2D3DCA', color: 'white', borderRadius: '10px', padding: '12px 14px', fontSize: '13px', fontFamily: 'Merriweather, serif', zIndex: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <span>You've answered everything from your country and around the world — now showing questions from other countries too.</span>
          <button
            onClick={() => {
              localStorage.setItem('senseus_seen_global_notice', 'true')
              setShowGlobalNotice(false)
            }}
            style={{ background: 'none', border: 'none', color: 'white', fontSize: '18px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}
      <div style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px',
        boxSizing: 'border-box',
      }}>
      {from !== '/vote' && (
        <button
          onClick={() => navigate(from)}
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            background: 'rgba(255,255,255,0.85)',
            border: 'none',
            borderRadius: '20px',
            padding: '6px 14px',
            fontSize: '12px',
            color: '#1A1A1A',
            cursor: 'pointer',
            fontFamily: 'Merriweather, serif',
            zIndex: 10,
          }}
        >
          ← back
        </button>
      )}
      <div
        // maxHeight used to be an unconditional inline 760px, on every
        // screen size. That's fine on an actual phone (available height
        // between header and footer rarely clears ~760px there), but on
        // any taller viewport — a big phone, and every desktop browser
        // window — the card stopped growing at 760px and just sat
        // centered in its flex parent, leaving large, equal gray gaps
        // above and below it (confirmed directly: at a 1187px-tall
        // container the card rendered at ~758px, matching this cap
        // almost exactly). That's the "too big" gap Aidan reported
        // 2026-10-29 — not the card being too big, the dead space around
        // it. senseus-vote-card-shell (index.css) now only applies this
        // cap at the same >=768px breakpoint every other desktop-only
        // treatment in this app already uses, so mobile always fills the
        // real available height and only wide desktop windows keep the
        // phone-card aspect ratio this cap was actually for.
        className="senseus-vote-card-shell"
        style={{
          width: '100%',
          maxWidth: '420px',
          height: '100%',
          borderRadius: 'var(--senseus-card-radius)',
          overflow: 'hidden',
          border: '0.5px solid #E5E7EB',
          boxShadow: 'var(--senseus-card-shadow)',
          background: '#FFFFFF',
          boxSizing: 'border-box',
        }}
      >
        <QuestionFlow
          questions={questions}
          onVote={handleVote}
          onHideQuestion={handleHideQuestion}
          targetQuestionId={targetQuestionId}
          targetQuestion={targetQuestion}
          // Once targetQuestion has loaded, its myVoteChoice (a live
          // lookup — see the fetch above) is authoritative and always
          // wins, including when it's null (confirmed no vote), which
          // must be able to override a stale ?currentVote= left over
          // from an earlier visit to this same URL. Falling back to the
          // raw currentVoteParam before that fetch resolves is defensive
          // only — QuestionFlow doesn't actually consume this prop until
          // targetQuestion is set either way.
          initialVoteForTarget={targetQuestion ? (targetQuestion.myVoteChoice ?? null) : currentVoteParam}
          pinnedQuestions={pinnedQuestions}
          onTogglePinQuestion={togglePinQuestion}
          partyQuestions={partyQuestions}
          onTogglePartyQuestion={togglePartyQuestion}
        />
      </div>
    </div>
    </div>
  )
}