import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import { useLongPress, LONG_PRESS_NO_SELECT } from '../hooks/useLongPress'
import CardActionSheet from '../components/ui/CardActionSheet'
import PinButton from '../components/ui/PinButton'
import { IconThumbUp, IconThumbDown } from '@tabler/icons-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useModalFocus } from '../hooks/useModalFocus'
import { HEADER_HEIGHT_PX } from '../components/layout/Header'
import { BOTTOM_NAV_HEIGHT_PX } from '../components/layout/BottomNav'

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f', dec: '#2D3DCA'
}

// Updated 2026-09-03 (second pass), same tier-2 palette shared with
// Explore.jsx, VoteCard.jsx, and Conversation.jsx's VOTE_WASH — see
// Explore.jsx's comment for why. These are the same 4 hex values as
// VOTE_PILL_STYLES's `background` below, so this is now one fewer color
// variant in the file rather than a bespoke shade. Used here as a
// highlight behind dark (#1A1A1A) comment text, which has plenty of
// contrast against this light wash — pure hex swap, no text-color/shadow
// change needed on this file's side.
const VOTE_WASH = {
  yes: '#eef3e0',
  ly: '#faf6d0',
  ln: '#f9ead8',
  no: '#f9d8d8',
}

const VOTE_PILL_STYLES = {
  yes: { background: '#eef3e0', color: '#4d621d' },
  ly: { background: '#faf6d0', color: '#7a6b0e' },
  ln: { background: '#f9ead8', color: '#7a4513' },
  no: { background: '#f9d8d8', color: '#7a1313' },
}

const VOTE_LABELS = {
  yes: 'yes',
  ly: 'leaning yes',
  ln: 'leaning no',
  no: 'no',
}

const COMMENT_SORTS = [
  { key: 'newest', label: 'Newest' },
  { key: 'resonance', label: 'Most resonated' },
  { key: 'replies', label: 'Most replies' },
]

function VoteIcon({ choice, size = 14 }) {
  const color = VOTE_COLORS[choice] || '#6B7280'
  if (choice === 'yes') return <IconThumbUp size={size} color={color} />
  if (choice === 'ly') return <IconThumbUp size={size} color={color} style={{ transform: 'rotate(45deg)' }} />
  if (choice === 'ln') return <IconThumbDown size={size} color={color} style={{ transform: 'rotate(45deg)' }} />
  if (choice === 'no') return <IconThumbDown size={size} color={color} />
  return <span style={{ fontSize: size - 2, color }}>undecided</span>
}

function timeAgo(dateString) {
  const now = new Date()
  const date = new Date(dateString)
  const diff = Math.floor((now - date) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatVoteTimestamp(dateString) {
  const date = new Date(dateString)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  let hours = date.getUTCHours()
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'pm' : 'am'
  hours = hours % 12
  if (hours === 0) hours = 12
  return `${y}.${m}.${d} @ ${hours}:${minutes}${ampm} UTC`
}

function MyCommentCard({ c, navigate, onLongPress }) {
  const longPress = useLongPress(() => onLongPress(c))
  return (
    <div
      onClick={() => { if (!longPress.wasLongPress()) navigate(`/conversation/${c.questions?.id}`) }}
      {...longPress}
      style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', ...LONG_PRESS_NO_SELECT }}
    >
      <div style={{ fontSize: '11px', color: '#0C447C', background: '#E6F1FB', display: 'inline-block', padding: '2px 8px', borderRadius: '20px', marginBottom: '8px' }}>
        {c.questions?.category}
      </div>
      <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '6px', lineHeight: 1.4 }}>
        {c.questions?.text}
      </div>
      <div style={{ fontSize: '14px', color: '#1A1A1A', lineHeight: 1.8, marginBottom: '10px' }}>
        <span
          style={{
            background: VOTE_WASH[c.voteChoice] || '#F9FAFB',
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
            padding: '2px 5px',
            borderRadius: '4px',
          }}
        >
          {c.body}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '14px', fontSize: '11px', color: '#6B7280' }}>
        <span>{c.resonance_count} resonate{c.resonance_count !== 1 ? 's' : ''}</span>
        <span>{c.directReplies} direct repl{c.directReplies !== 1 ? 'ies' : 'y'}</span>
        <span>{c.totalReplies} overall</span>
        <span style={{ marginLeft: 'auto' }}>{timeAgo(c.created_at)}</span>
      </div>
    </div>
  )
}

function ShiftCard({ shift, onLongPress }) {
  const longPress = useLongPress(() => onLongPress(shift))
  return (
    <div {...longPress} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', ...LONG_PRESS_NO_SELECT }}>
      <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, marginBottom: '8px' }}>
        {shift.questions?.text}
      </div>
      <div style={{ width: '100%', height: '6px', borderRadius: '3px', overflow: 'hidden', display: 'flex', background: '#F1F1F1', marginBottom: '6px' }}>
        <div style={{ width: `${shift.pctYes}%`, background: '#6d8a1c', transition: 'width 0.3s ease' }} />
        <div style={{ width: `${shift.pctNo}%`, background: '#c21f1f', transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ fontSize: '11px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
            You voted <VoteIcon choice={shift.choice} size={13} />
          </div>
          <div style={{ fontSize: '10px', color: '#6B7280' }}>
            on {formatVoteTimestamp(shift.created_at)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#4d621d', fontWeight: 700 }}>▲ {shift.pctYes}% yes</span>
            <span style={{ fontSize: '11px', color: '#7a1313', fontWeight: 700 }}>▼ {shift.pctNo}% no</span>
          </div>
          {shift.delta !== null && (
            <div style={{ fontSize: '10px', fontWeight: 700, color: shift.delta > 0 ? '#4d621d' : shift.delta < 0 ? '#7a1313' : '#6B7280' }}>
              {shift.delta > 0 ? `↑ +${shift.delta} pts since you voted` : shift.delta < 0 ? `↓ ${shift.delta} pts since you voted` : 'No shift since you voted'}
            </div>
          )}
          <div style={{ fontSize: '10px', color: '#6B7280' }}>
            {shift.total} {shift.total === 1 ? 'human' : 'humans'} answered to date
          </div>
        </div>
      </div>
    </div>
  )
}

function RevisitCard({ skip, navigate, onLongPress, onRevisit }) {
  const longPress = useLongPress(() => onLongPress(skip))
  return (
    <div {...longPress} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', ...LONG_PRESS_NO_SELECT }}>
      <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.5, marginBottom: '8px' }}>
        {skip.questions?.text}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '11px', color: '#6B7280' }}>
          {skip.questions?.category} · {timeAgo(skip.created_at)}
        </div>
        <button
          onClick={() => onRevisit(skip)}
          style={{ fontSize: '12px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', fontWeight: 500 }}
        >
          Revisit →
        </button>
      </div>
    </div>
  )
}

function HistoryCard({ vote, snapshotMap, onLongPress }) {
  const longPress = useLongPress(() => onLongPress(vote))
  const todaySnap = snapshotMap[vote.questions?.id]?.today
  const weekSnap = snapshotMap[vote.questions?.id]?.sevenDaysAgo
  const currentPctYes = todaySnap?.pct_yes || 0
  const currentPctNo = todaySnap?.pct_no || 0
  const trend = weekSnap ? currentPctYes - weekSnap.pct_yes : null

  return (
    <div {...longPress} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '12px 14px', ...LONG_PRESS_NO_SELECT }}>
      <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.5 }}>
        {vote.questions?.text}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px' }}>
        <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 300 }}>
          {vote.questions?.category} · {timeAgo(vote.created_at)}
        </div>
      </div>
      {/* Moved down from the top-right corner of the card, and restyled to
          match Explore's voted-state badge (white background, darker
          border in the vote's own color) instead of the old flat-color
          pill — same VOTE_COLORS/VOTE_PILL_STYLES hex values Explore's
          VOTE_BOLD/VOTE_BADGE_TEXT already reuse, so this isn't a new
          palette, just the same one applied the same way. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
        <span style={{ fontSize: '11px', color: '#6B7280' }}>You voted:</span>
        <div style={{
          padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap',
          background: '#FFFFFF', border: `1.5px solid ${VOTE_COLORS[vote.choice]}`, color: VOTE_PILL_STYLES[vote.choice]?.color,
        }}>
          {VOTE_LABELS[vote.choice]}
        </div>
      </div>
      {todaySnap && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ width: '100%', height: '6px', borderRadius: '3px', overflow: 'hidden', display: 'flex', background: '#F1F1F1', marginBottom: '4px' }}>
            <div style={{ width: `${currentPctYes}%`, background: '#6d8a1c' }} />
            <div style={{ width: `${currentPctNo}%`, background: '#c21f1f' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '10px', color: '#6B7280' }}>
              <span style={{ color: '#4d621d', fontWeight: 700 }}>{currentPctYes}% yes</span>
              {' · '}
              <span style={{ color: '#7a1313', fontWeight: 700 }}>{currentPctNo}% no</span>
              {' · '}
              {todaySnap.total_votes} {todaySnap.total_votes === 1 ? 'human' : 'humans'}
            </div>
            {trend !== null && (
              <div style={{ fontSize: '10px', fontWeight: 700, color: trend > 0 ? '#4d621d' : trend < 0 ? '#7a1313' : '#6B7280' }}>
                {trend > 0 ? '▲' : trend < 0 ? '▼' : '—'}
                {trend !== 0 ? ` ${Math.abs(trend)}% this week` : ' no change'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Matches Conversation.jsx's getDisplayName(profile) exactly — get_pinned_comments()
// (migration 077) returns the same display fields flattened onto the row
// instead of nested under a `profiles` key, so this takes the row itself.
function getDisplayName(row) {
  if (!row) return 'Anonymous'
  if (row.display_preference === 'anon') return row.anon_name || 'Anonymous'
  if (row.display_preference === 'first_only') return row.first_name
  return `${row.first_name} ${row.last_initial}.`
}

// A pinned question — bold question text as the main content (this is
// what you're being reminded of), category + your vote status (or "Not
// voted yet") as the quick info below. No longpress sheet here (unlike
// the other tabs' cards) — the pin icon is the direct one-tap unpin, and
// tapping the card just opens the question, same single-purpose pattern
// PinButton already uses on Explore/Conversation.
function PinnedQuestionCard({ pin, navigate, onTogglePin }) {
  return (
    <div
      onClick={() => navigate(pin.userVoteChoice ? `/conversation/${pin.question_id}` : `/vote?question=${pin.question_id}`)}
      style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', position: 'relative' }}
    >
      <PinButton pinned onToggle={onTogglePin} size={15} style={{ position: 'absolute', top: '10px', right: '10px' }} />
      <div style={{ fontSize: '11px', color: '#0C447C', background: '#E6F1FB', display: 'inline-block', padding: '2px 8px', borderRadius: '20px', marginBottom: '8px' }}>
        {pin.category}
      </div>
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.4, marginBottom: '8px', paddingRight: '22px' }}>
        {pin.text}
      </div>
      {pin.userVoteChoice ? (
        <span style={{
          fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: 700,
          background: '#FFFFFF', border: `1.5px solid ${VOTE_COLORS[pin.userVoteChoice]}`, color: VOTE_PILL_STYLES[pin.userVoteChoice]?.color,
        }}>
          You voted {VOTE_LABELS[pin.userVoteChoice]}
        </span>
      ) : (
        <span style={{ fontSize: '11px', fontWeight: 500, color: '#2D3DCA' }}>Not voted yet</span>
      )}
    </div>
  )
}

// A pinned comment — the question it belongs to bold at the top for
// context (you need to know what this was about before the comment makes
// sense), the comment itself below it, quick info (who said it, when,
// their vote stance) beneath that.
function PinnedCommentCard({ pin, navigate, onTogglePin }) {
  const displayName = getDisplayName(pin)
  return (
    <div
      onClick={() => navigate(`/conversation/${pin.question_id}`)}
      style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', position: 'relative' }}
    >
      <PinButton pinned onToggle={onTogglePin} size={15} style={{ position: 'absolute', top: '10px', right: '10px' }} />
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.4, marginBottom: '8px', paddingRight: '22px' }}>
        {pin.question_text}
      </div>
      {pin.is_removed ? (
        <div style={{ fontSize: '13px', color: '#6B7280', fontStyle: 'italic', marginBottom: '8px' }}>
          [deleted by user]
        </div>
      ) : (
        <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.6, marginBottom: '8px' }}>
          <span style={{ background: VOTE_WASH[pin.vote_choice] || '#F9FAFB', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', padding: '2px 5px', borderRadius: '4px' }}>
            {pin.body}
          </span>
        </div>
      )}
      <div style={{ fontSize: '11px', color: '#6B7280' }}>
        {pin.is_own ? 'You' : displayName} · {timeAgo(pin.created_at)}
      </div>
    </div>
  )
}

export default function Activity() {
  usePageTitle('Your Activity')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('history')
  const [commentSort, setCommentSort] = useState('newest')
  const [myComments, setMyComments] = useState([])
  const [commentsHasMore, setCommentsHasMore] = useState(false)
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false)
  const COMMENTS_PAGE_SIZE = 50
  const [shifts, setShifts] = useState([])
  const [skipped, setSkipped] = useState([])
  const [votes, setVotes] = useState([])
  const [snapshotMap, setSnapshotMap] = useState({})
  const [actionSheet, setActionSheet] = useState(null)

  // Pin state (migration 077) — just the id sets, fetched eagerly (not
  // gated behind the lazy per-tab loading below) since the Comments tab's
  // own longpress sheet needs an accurate Pin/Unpin label regardless of
  // whether the Pinned tab has been opened yet this visit. The Pinned
  // tab's own fetcher (added alongside it) loads the full card data
  // (question text, comment body, etc.) separately and keeps these two
  // sets in sync with whatever it finds.
  const [pinnedCommentIds, setPinnedCommentIds] = useState(new Set())
  const [pinnedQuestionIds, setPinnedQuestionIds] = useState(new Set())
  const [pinnedQuestionsList, setPinnedQuestionsList] = useState([])
  const [pinnedCommentsList, setPinnedCommentsList] = useState([])
  const [pinnedView, setPinnedView] = useState('questions')

  // Comparison-link modal: startComparison() used to rely entirely on
  // navigator.share() / navigator.clipboard succeeding, with nothing
  // rendered if both silently failed or were unavailable (the reported
  // bug — the token was created server-side but the user never saw the
  // link). Now we always show it here as the reliable path, and offer
  // the device share sheet as an optional extra inside the modal.
  const [comparisonLink, setComparisonLink] = useState(null)
  const [comparisonLinkError, setComparisonLinkError] = useState(null)
  const [comparisonCopyState, setComparisonCopyState] = useState('idle')
  const comparisonPanelRef = useModalFocus(!!comparisonLink, () => setComparisonLink(null))

  // Each tab's data is fetched only once, the first time that tab is
  // actually opened — not all four upfront on page load. loadedTabs
  // tracks which ones have already been fetched; tabLoading tracks
  // whether the currently-open tab's own fetch is still in flight.
  const [loadedTabs, setLoadedTabs] = useState(new Set())
  const [tabLoading, setTabLoading] = useState(true)

  // Eager, outside the lazy per-tab system above — just the id sets, a
  // cheap single-column query each, run once on mount regardless of
  // which tab is open first.
  useEffect(() => {
    if (!user) return
    let cancelled = false

    Promise.all([
      supabase.from('pinned_comments').select('comment_id').eq('user_id', user.id),
      supabase.from('pinned_questions').select('question_id').eq('user_id', user.id),
    ]).then(([{ data: comments }, { data: questions }]) => {
      if (cancelled) return
      setPinnedCommentIds(new Set((comments || []).map(c => c.comment_id)))
      setPinnedQuestionIds(new Set((questions || []).map(q => q.question_id)))
    }).catch(err => console.error(err))

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user?.id, not the user object, same reasoning as the tab-loading effect below.
  }, [user?.id])

  // Optimistic toggles, same insert/delete shape as Conversation.jsx's
  // toggleResonate/toggleCommentPin — used by both the Comments tab's
  // longpress sheet and the Pinned tab's own pin icons.
  async function togglePinComment(commentId) {
    if (!user) return
    const isPinned = pinnedCommentIds.has(commentId)
    if (isPinned) {
      const { error } = await supabase.from('pinned_comments').delete()
        .eq('comment_id', commentId).eq('user_id', user.id)
      if (error) { alert('Something went wrong — please try again.'); return }
      setPinnedCommentIds(prev => { const s = new Set(prev); s.delete(commentId); return s })
      setPinnedCommentsList(prev => prev.filter(c => c.comment_id !== commentId))
    } else {
      const { error } = await supabase.from('pinned_comments').insert({ comment_id: commentId, user_id: user.id })
      if (error) { alert('Something went wrong — please try again.'); return }
      setPinnedCommentIds(prev => new Set([...prev, commentId]))
    }
  }

  async function togglePinQuestion(questionId) {
    if (!user) return
    const isPinned = pinnedQuestionIds.has(questionId)
    if (isPinned) {
      const { error } = await supabase.from('pinned_questions').delete()
        .eq('question_id', questionId).eq('user_id', user.id)
      if (error) { alert('Something went wrong — please try again.'); return }
      setPinnedQuestionIds(prev => { const s = new Set(prev); s.delete(questionId); return s })
      setPinnedQuestionsList(prev => prev.filter(q => q.question_id !== questionId))
    } else {
      const { error } = await supabase.from('pinned_questions').insert({ question_id: questionId, user_id: user.id })
      if (error) { alert('Something went wrong — please try again.'); return }
      setPinnedQuestionIds(prev => new Set([...prev, questionId]))
    }
  }

  function shareQuestion(question) {
    if (!question?.question_number) return
    const url = `https://senseus.app/q/${question.question_number}`
    const shareData = { title: 'senseUS', text: 'What do you think?', url }
    if (navigator.share) {
      navigator.share(shareData).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!')).catch(() => prompt('Copy this link:', url))
    }
  }

  function shareComment(comment) {
    if (!comment.questions?.question_number) return
    const url = `https://senseus.app/q/${comment.questions.question_number}#comment-${comment.id}`
    const shareData = { title: 'senseUS', text: 'Join the conversation on senseUS', url }
    if (navigator.share) {
      navigator.share(shareData).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!')).catch(() => prompt('Copy this link:', url))
    }
  }

  async function startComparison() {
    setComparisonLinkError(null)
    const { data, error } = await supabase
      .from('comparison_tokens')
      .insert({ sender_id: user.id })
      .select('token')
      .single()

    if (error || !data) {
      setComparisonLinkError('Something went wrong creating your link. Please try again.')
      return
    }

    // Always surface the link in-app rather than depending solely on
    // navigator.share()/clipboard succeeding — both can fail silently
    // (no native share sheet in some environments, clipboard permission
    // denied, etc.) with nothing visible to the user. The modal below is
    // the reliable path; device share is offered as an extra button
    // inside it, on demand rather than auto-fired.
    setComparisonLink(`https://senseus.app/compare/${data.token}`)
    setComparisonCopyState('idle')
  }

  async function copyComparisonLink() {
    if (!comparisonLink) return
    try {
      await navigator.clipboard.writeText(comparisonLink)
      setComparisonCopyState('copied')
      setTimeout(() => setComparisonCopyState('idle'), 2000)
    } catch {
      setComparisonCopyState('manual')
    }
  }

  async function shareComparisonLink() {
    if (!comparisonLink) return
    const shareData = { title: 'senseUS', text: 'Compare voting histories with me on senseUS', url: comparisonLink }
    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // User cancelled the share sheet — not an error, the link modal is still open behind it
      }
    } else {
      copyComparisonLink()
    }
  }

  // Shared by the initial load and "load more" — fetches one page of the
  // user's own comments plus the reply-count/vote-choice enrichment that
  // used to happen once for the whole (unbounded) list.
  async function fetchCommentsPage(offset) {
    const { data: rawPageComments, error: commentsError } = await supabase
      .from('comments')
      .select(`
        id, body, created_at, resonance_count,
        questions (id, text, category, question_number)
      `)
      .eq('user_id', user.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + COMMENTS_PAGE_SIZE - 1)

    // Previously silently swallowed — if this fetch ever comes back empty
    // because of a real error rather than the user genuinely having no
    // comments, this makes that visible in the console instead of just
    // showing an empty tab with no explanation.
    if (commentsError) {
      console.error('fetchComments: comments query failed', commentsError)
      return []
    }
    if (!rawPageComments?.length) return []

    // Same RLS-null-on-join situation as fetchRevisit below — a comment
    // the user posted on a since-pulled question still belongs to them,
    // but `questions` comes back null. Drop those rather than showing a
    // comment card for a question that's no longer visible to anyone but
    // admins (migration 071_pull_question_moderation.sql).
    const pageComments = rawPageComments.filter(c => c.questions)
    if (!pageComments.length) return []

    // Used to fetch every non-deleted comment on the entire platform just
    // to build a reply-count map for these few dozen comments — scales
    // with total platform comment volume, not with how many comments this
    // one user has made. get_comment_reply_counts walks the reply tree
    // server-side, scoped to exactly these comment ids.
    const commentIds = pageComments.map(c => c.id)
    const { data: replyCounts, error: replyCountsError } = await supabase.rpc('get_comment_reply_counts', {
      p_comment_ids: commentIds,
    })
    if (replyCountsError) console.error('fetchComments: get_comment_reply_counts failed', replyCountsError)
    const countsByComment = new Map(
      (replyCounts || []).map(r => [r.comment_id, { direct: Number(r.direct_replies), total: Number(r.total_replies) }])
    )

    const questionIds = [...new Set(pageComments.map(c => c.questions?.id).filter(Boolean))]
    const { data: ownVotes } = questionIds.length
      ? await supabase
          .from('votes')
          .select('question_id, choice')
          .eq('user_id', user.id)
          .in('question_id', questionIds)
      : { data: [] }
    const voteByQuestion = new Map((ownVotes || []).map(v => [v.question_id, v.choice]))

    return pageComments.map(c => ({
      ...c,
      directReplies: countsByComment.get(c.id)?.direct || 0,
      totalReplies: countsByComment.get(c.id)?.total || 0,
      voteChoice: voteByQuestion.get(c.questions?.id),
    }))
  }

  async function fetchComments() {
    // Was capped at a flat 50 with no way to see anything older — a
    // long-tenured, active commenter (more than 50 comments) would have
    // older comments silently vanish from this tab, including ones with
    // replies. Now paginated: this loads the first page, and "Load more"
    // (below) fetches the rest on demand instead of dropping them.
    const page = await fetchCommentsPage(0)
    setMyComments(page)
    setCommentsHasMore(page.length === COMMENTS_PAGE_SIZE)
  }

  async function loadMoreComments() {
    setCommentsLoadingMore(true)
    try {
      const page = await fetchCommentsPage(myComments.length)
      setMyComments(prev => [...prev, ...page])
      setCommentsHasMore(page.length === COMMENTS_PAGE_SIZE)
    } finally {
      setCommentsLoadingMore(false)
    }
  }

  async function fetchShifts() {
    const { data: userVotes } = await supabase
      .from('votes')
      .select(`
        choice, created_at, pct_yes_at_vote,
        questions (id, text, category, question_number)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    // `questions` comes back null for a vote on a since-pulled question
    // (RLS — migration 071_pull_question_moderation.sql) — filter those out
    // before `.questions.id` below, which would otherwise throw.
    const userVotesWithQuestion = (userVotes || []).filter(v => v.questions)

    if (userVotesWithQuestion.length > 0) {
      const questionIds = userVotesWithQuestion.map(v => v.questions.id)
      const { data: tallyRows } = await supabase.rpc('get_vote_tallies_batch', {
        p_question_ids: questionIds,
      })
      const totalsById = {}
      for (const row of tallyRows || []) {
        const weightedTotal = Number(row.yes) + Number(row.ly) + Number(row.ln) + Number(row.no)
        totalsById[row.question_id] = {
          pctYes: weightedTotal > 0 ? Math.round(((Number(row.yes) + Number(row.ly)) / weightedTotal) * 100) : 0,
          total: Number(row.total),
        }
      }
      const shiftsWithCurrent = userVotesWithQuestion.map(vote => {
        const t = totalsById[vote.questions.id] || { pctYes: 0, total: 0 }
        const hasBaseline = vote.pct_yes_at_vote !== null && vote.pct_yes_at_vote !== undefined
        const delta = hasBaseline ? t.pctYes - vote.pct_yes_at_vote : null
        return { ...vote, pctYes: t.pctYes, pctNo: 100 - t.pctYes, total: t.total, delta }
      })

      function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[array[i], array[j]] = [array[j], array[i]]
        }
        return array
      }

      setShifts(shuffle(shiftsWithCurrent))
    } else {
      setShifts([])
    }
  }

  async function fetchRevisit() {
    // Capped at 50 for the same reason as fetchComments above — this list
    // was previously unbounded and would grow indefinitely for a user who
    // skips a lot of questions.
    const { data: skipsData } = await supabase
      .from('question_skips')
      .select('id, question_id, created_at, questions (id, text, category, question_number)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    // The embedded `questions` join respects that table's RLS — a
    // question_skips row survives (it's the user's own), but `questions`
    // comes back null if the question it points to is no longer visible to
    // them (pulled for moderation — see migration
    // 071_pull_question_moderation.sql — or otherwise unpublished). Drop
    // those here rather than rendering a blank/broken card for a question
    // that no longer exists from this user's point of view.
    setSkipped((skipsData || []).filter(skip => skip.questions))
  }

  async function fetchHistory() {
    // Capped at 50 — same reasoning as fetchComments/fetchRevisit. A
    // long-tenured user's full vote history could otherwise be thousands
    // of unbounded, unvirtualized rows.
    const { data: votesData } = await supabase
      .from('votes')
      .select(`
        id, choice, created_at, updated_at, pct_yes_at_vote, pct_no_at_vote,
        questions (id, text, category, question_number)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    const questionIds = (votesData || []).map(v => v.questions?.id).filter(Boolean)
    let newSnapshotMap = {}
    if (questionIds.length > 0) {
      const today = new Date()
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]
      const todayStr = today.toISOString().split('T')[0]

      const { data: snapshots } = await supabase
        .from('question_snapshots')
        .select('question_id, pct_yes, pct_no, total_votes, snapshot_date')
        .in('question_id', questionIds)
        .in('snapshot_date', [todayStr, sevenDaysAgoStr])

      ;(snapshots || []).forEach(s => {
        if (!newSnapshotMap[s.question_id]) newSnapshotMap[s.question_id] = {}
        if (s.snapshot_date === todayStr) newSnapshotMap[s.question_id].today = s
        if (s.snapshot_date === sevenDaysAgoStr) newSnapshotMap[s.question_id].sevenDaysAgo = s
      })
    }

    // Same RLS-null-on-join situation as fetchRevisit/fetchShifts — drop a
    // past vote on a since-pulled question rather than rendering a blank
    // history card for it (migration 071_pull_question_moderation.sql).
    setVotes((votesData || []).filter(v => v.questions))
    setSnapshotMap(newSnapshotMap)
  }

  const sortedComments = useMemo(() => {
    const arr = [...myComments]
    if (commentSort === 'resonance') arr.sort((a, b) => b.resonance_count - a.resonance_count)
    else if (commentSort === 'replies') arr.sort((a, b) => b.totalReplies - a.totalReplies)
    else arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return arr
  }, [myComments, commentSort])

  // Pinned questions: no RPC needed (questions carry no other user's
  // identity — same reasoning Explore.jsx's own direct fetch already
  // relies on). A nested select through pinned_questions, plus a second
  // query for the user's own votes on just those questions so each card
  // can show "you voted X" / "not voted yet".
  async function fetchPinnedQuestions() {
    const { data: pinsData } = await supabase
      .from('pinned_questions')
      .select('question_id, created_at, questions (id, text, category, question_number)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const questionIds = (pinsData || []).map(p => p.question_id)
    const voteMap = {}
    if (questionIds.length > 0) {
      const { data: votesData } = await supabase
        .from('votes')
        .select('question_id, choice')
        .eq('user_id', user.id)
        .in('question_id', questionIds)
      ;(votesData || []).forEach(v => { voteMap[v.question_id] = v.choice })
    }

    // Same RLS-null-on-join guard as fetchRevisit/fetchShifts/fetchHistory
    // — drops a pin whose question was hard-deleted (cascade should have
    // already removed the pin row itself, but this is a harmless backstop
    // rather than rendering a blank card).
    setPinnedQuestionsList(
      (pinsData || [])
        .filter(p => p.questions)
        .map(p => ({
          question_id: p.question_id,
          text: p.questions.text,
          category: p.questions.category,
          userVoteChoice: voteMap[p.question_id] || null,
        }))
    )
  }

  // Pinned comments: DOES go through an RPC (get_pinned_comments(),
  // migration 077) — unlike questions, a pinned comment can belong to
  // another user, and this app never sends another user's raw user_id to
  // the client (same reasoning as get_conversation_comments()).
  async function fetchPinnedComments() {
    const { data } = await supabase.rpc('get_pinned_comments')
    setPinnedCommentsList(data || [])
  }

  async function fetchPinned() {
    await Promise.all([fetchPinnedQuestions(), fetchPinnedComments()])
  }

  const FETCHERS = {
    comments: fetchComments,
    shifts: fetchShifts,
    revisit: fetchRevisit,
    history: fetchHistory,
    pinned: fetchPinned,
  }

  // Runs whenever the active tab changes (including the very first render,
  // for whichever tab is the default) — fetches that tab's data only if
  // it hasn't been loaded yet this visit.
  useEffect(() => {
    if (!user) return
    if (loadedTabs.has(tab)) return

    let cancelled = false
    setTabLoading(true)

    FETCHERS[tab]()
      .catch(err => console.error(err))
      .finally(() => {
        if (cancelled) return
        setLoadedTabs(prev => new Set(prev).add(tab))
        setTabLoading(false)
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user?.id, not the user object, is the real dependency (see ProtectedRoute.jsx for the same pattern). AuthContext hands out a new user object reference on every onAuthStateChange firing, including Supabase's routine hourly token refresh — the loadedTabs guard above already prevents a real re-fetch in that case, but there's no reason to re-invoke the effect at all.
  }, [tab, user?.id])

  return (
    <div style={{ minHeight: `calc(100dvh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`, boxSizing: 'border-box', background: '#C7C7CC', paddingBottom: '80px' }}>
    <div style={{ padding: '14px', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: 'var(--senseus-card-radius)', boxShadow: 'var(--senseus-card-shadow)' }}>

      {/* Page title */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Activity</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '1.5rem', background: '#F3F4F6', padding: '4px', borderRadius: '10px' }}>
        {[
          { key: 'history', label: 'History' },
          { key: 'comments', label: 'Comments' },
          { key: 'shifts', label: 'Shifts' },
          { key: 'revisit', label: 'Revisit' },
          { key: 'pinned', label: 'Pinned' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '8px', background: tab === t.key ? '#2D3DCA' : 'transparent',
              color: tab === t.key ? 'white' : '#6B7280', border: 'none', borderRadius: '8px',
              fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tabLoading ? (
        <div>
          <SkeletonCard style={{ marginBottom: '8px' }} />
          <SkeletonCard style={{ marginBottom: '8px' }} />
          <SkeletonCard />
        </div>
      ) : (
        <div style={{ animation: 'senseus-content-in 0.35s ease' }}>
          {/* Comments tab */}
          {tab === 'comments' && (
            <div>
              {myComments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '0.5rem' }}>💬</div>
                  No comments yet. Vote on a question to join the conversation.
                </div>
              ) : (
                <>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', background: '#F3F4F6', padding: '3px', borderRadius: '8px' }}>
                  {COMMENT_SORTS.map(s => (
                    <button
                      key={s.key}
                      onClick={() => setCommentSort(s.key)}
                      style={{
                        // Matches the blue-active segmented-pill pattern used
                        // elsewhere (Explore's All/Unanswered toggle, Compare's
                        // match-mode toggle) instead of the white-pill style
                        // this one had drifted to.
                        flex: 1, padding: '6px 4px', background: commentSort === s.key ? '#2D3DCA' : 'transparent',
                        color: commentSort === s.key ? 'white' : '#6B7280', border: 'none', borderRadius: '6px',
                        fontSize: '11px', fontWeight: commentSort === s.key ? 700 : 500, cursor: 'pointer',
                        fontFamily: 'Merriweather, serif',
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {sortedComments.map(c => (
                    <MyCommentCard
                      key={c.id}
                      c={c}
                      navigate={navigate}
                      onLongPress={(comment) => setActionSheet({
                        title: comment.questions?.text,
                        // "View this question" first and "Change my vote"
                        // second, same ordering as every other longpress
                        // sheet in this file — and change-vote added here
                        // for the first time, since a comment is tied to a
                        // real vote just like History/Shifts are.
                        actions: [
                          { label: 'View this question', onClick: () => navigate(`/conversation/${comment.questions?.id}`) },
                          { label: 'Change my vote', onClick: () => navigate(`/vote?question=${comment.questions?.id}&currentVote=${comment.voteChoice}`) },
                          { label: 'Share this question', onClick: () => shareQuestion(comment.questions) },
                          { label: 'Share your comment', onClick: () => shareComment(comment) },
                          {
                            label: pinnedCommentIds.has(comment.id) ? 'Unpin this comment' : 'Pin this comment',
                            onClick: () => togglePinComment(comment.id),
                          },
                        ],
                      })}
                    />
                  ))}
                </div>
                {commentsHasMore && (
                  <button
                    onClick={loadMoreComments}
                    disabled={commentsLoadingMore}
                    style={{
                      width: '100%', marginTop: '12px', padding: '10px', background: '#F3F4F6',
                      color: '#2D3DCA', border: 'none', borderRadius: '8px', fontSize: '13px',
                      fontWeight: 600, cursor: commentsLoadingMore ? 'default' : 'pointer',
                      fontFamily: 'Merriweather, serif', opacity: commentsLoadingMore ? 0.6 : 1,
                    }}
                  >
                    {commentsLoadingMore ? 'Loading…' : 'Load more'}
                  </button>
                )}
                </>
              )}
            </div>
          )}

          {/* Shifts tab */}
          {tab === 'shifts' && (
            <div>
              {/* This explanation isn't new — it was already here as plain
                  gray text, which is exactly the problem: "Shifts" isn't a
                  self-explanatory label the way History/Comments/Revisit
                  are, so the one sentence explaining it needs to actually
                  get read, not blend into body copy competing with the
                  real content below it. Same colored-callout treatment as
                  the other contextual tips in the app (Explore's long-press
                  tip, Profile's settings pointer) — no dismiss button,
                  since this is standing context for the tab, not a
                  one-time thing to clear out of the way. */}
              <div style={{ fontSize: '12px', color: '#0C447C', lineHeight: 1.6, marginBottom: '1rem', background: '#E6F1FB', border: '1px solid #0C447C', borderRadius: '10px', padding: '10px 14px' }}>
                <strong>See how public opinion is trending</strong> on questions you've answered. On the left is a timestamp of when you voted and how. On the right is the current total vote count, current yes/no percentage, and how the percentage has shifted since you voted.
              </div>
              {shifts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '0.5rem' }}>📈</div>
                  No shifts yet. Vote on some questions to see how they're trending.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {shifts.map(shift => (
                    <ShiftCard
                      key={shift.questions?.id || shift.created_at}
                      shift={shift}
                      onLongPress={(s) => setActionSheet({
                        title: s.questions?.text,
                        actions: [
                          { label: 'View this question', onClick: () => navigate(`/conversation/${s.questions?.id}`) },
                          { label: 'Change my vote', onClick: () => navigate(`/vote?question=${s.questions?.id}&currentVote=${s.choice}`) },
                          { label: 'Share this question', onClick: () => shareQuestion(s.questions) },
                          {
                            label: pinnedQuestionIds.has(s.questions?.id) ? 'Unpin this question' : 'Pin this question',
                            onClick: () => togglePinQuestion(s.questions?.id),
                          },
                        ],
                      })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'revisit' && (
            <div>
              {skipped.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '0.5rem' }}>📥</div>
                  Nothing here. Questions you choose not to see disappear from your feed and show up here instead.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {skipped.map(skip => (
                    <RevisitCard
                      key={skip.id}
                      skip={skip}
                      navigate={navigate}
                      onLongPress={(s) => setActionSheet({
                        title: s.questions?.text,
                        // No "Change my vote" here — a skipped question has
                        // no vote on it yet to change (that's what the
                        // card's own "Revisit →" button is for).
                        actions: [
                          { label: 'View this question', onClick: () => navigate(`/conversation/${s.questions?.id}`) },
                          { label: 'Share this question', onClick: () => shareQuestion(s.questions) },
                          {
                            label: pinnedQuestionIds.has(s.questions?.id) ? 'Unpin this question' : 'Pin this question',
                            onClick: () => togglePinQuestion(s.questions?.id),
                          },
                        ],
                      })}
                      onRevisit={async (s) => {
                        const { error } = await supabase.from('question_skips').delete().eq('id', s.id)
                        if (error) {
                          alert('Something went wrong: ' + error.message)
                          return
                        }
                        setSkipped(prev => prev.filter(x => x.id !== s.id))
                        navigate(`/vote?question=${s.question_id}`)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div>
              <button
                onClick={startComparison}
                style={{ width: '100%', padding: '8px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
              >
                Compare your vote history with a friend
              </button>
              {comparisonLinkError && (
                <p style={{ fontSize: '12px', color: '#991B1B', marginTop: '6px', marginBottom: 0 }}>{comparisonLinkError}</p>
              )}
              <div style={{ marginBottom: '1.5rem' }} />

              {votes.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#6B7280', textAlign: 'center', padding: '2rem 0' }}>
                  <span style={{ display: 'block', fontSize: '32px', marginBottom: '0.5rem' }}>🗳️</span>
                  No votes yet — head to the vote feed to get started.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {votes.map((vote) => (
                    <HistoryCard
                      key={vote.id}
                      vote={vote}
                      snapshotMap={snapshotMap}
                      onLongPress={(v) => setActionSheet({
                        title: v.questions?.text,
                        // These two buttons used to live under the card
                        // itself — removed so long-pressing the card (this
                        // sheet) becomes the one way to reach them, right
                        // from the start rather than a fallback most people
                        // never discover.
                        actions: [
                          { label: 'View this question', onClick: () => navigate(`/conversation/${v.questions?.id}`) },
                          { label: 'Change my vote', onClick: () => navigate(`/vote?question=${v.questions?.id}&currentVote=${v.choice}`) },
                          { label: 'Share this question', onClick: () => shareQuestion(v.questions) },
                          {
                            label: pinnedQuestionIds.has(v.questions?.id) ? 'Unpin this question' : 'Pin this question',
                            onClick: () => togglePinQuestion(v.questions?.id),
                          },
                        ],
                      })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'pinned' && (
            <div>
              {/* Questions/Comments toggle — same segmented-pill pattern as
                  the Comments tab's own sort toggle just above. */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', background: '#F3F4F6', padding: '3px', borderRadius: '8px' }}>
                {[
                  { key: 'questions', label: 'Questions' },
                  { key: 'comments', label: 'Comments' },
                ].map(v => (
                  <button
                    key={v.key}
                    onClick={() => setPinnedView(v.key)}
                    style={{
                      flex: 1, padding: '6px 4px', background: pinnedView === v.key ? '#2D3DCA' : 'transparent',
                      color: pinnedView === v.key ? 'white' : '#6B7280', border: 'none', borderRadius: '6px',
                      fontSize: '11px', fontWeight: pinnedView === v.key ? 700 : 500, cursor: 'pointer',
                      fontFamily: 'Merriweather, serif',
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {pinnedView === 'questions' ? (
                pinnedQuestionsList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
                    <div style={{ fontSize: '32px', marginBottom: '0.5rem' }}>📌</div>
                    No pinned questions yet. Tap the pin icon on any question to save it here.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {pinnedQuestionsList.map(pin => (
                      <PinnedQuestionCard
                        key={pin.question_id}
                        pin={pin}
                        navigate={navigate}
                        onTogglePin={() => togglePinQuestion(pin.question_id)}
                      />
                    ))}
                  </div>
                )
              ) : (
                pinnedCommentsList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem 0', color: '#6B7280', fontSize: '14px' }}>
                    <div style={{ fontSize: '32px', marginBottom: '0.5rem' }}>📌</div>
                    No pinned comments yet. Tap the pin icon on any comment to save it here.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {pinnedCommentsList.map(pin => (
                      <PinnedCommentCard
                        key={pin.comment_id}
                        pin={pin}
                        navigate={navigate}
                        onTogglePin={() => togglePinComment(pin.comment_id)}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}

      {actionSheet && (
        <CardActionSheet
          title={actionSheet.title}
          actions={actionSheet.actions}
          onClose={() => setActionSheet(null)}
        />
      )}

      {comparisonLink && (
        <div
          onClick={() => setComparisonLink(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '1.5rem', boxSizing: 'border-box',
          }}
        >
          <div
            ref={comparisonPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Compare your vote history with a friend"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFFFFF', borderRadius: '16px', padding: '1.5rem',
              maxWidth: '360px', width: '100%', fontFamily: 'Merriweather, serif',
              outline: 'none',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
              Your comparison link is ready
            </div>
            <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.6, marginBottom: '1rem' }}>
              Send this to a friend. Once they open it and accept, you'll both see how your votes line up.
            </p>
            <div style={{
              fontSize: '12px', color: '#1A1A1A', background: '#F3F4F6', borderRadius: '8px',
              padding: '10px 12px', marginBottom: '0.75rem', wordBreak: 'break-all', userSelect: 'all',
            }}>
              {comparisonLink}
            </div>
            {comparisonCopyState === 'manual' && (
              <p style={{ fontSize: '12px', color: '#991B1B', marginBottom: '0.75rem' }}>
                Couldn't copy automatically — select the link above and copy it manually.
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '0.75rem' }}>
              <button
                onClick={copyComparisonLink}
                style={{ flex: 1, padding: '10px', background: comparisonCopyState === 'copied' ? '#4d621d' : '#F3F4F6', color: comparisonCopyState === 'copied' ? 'white' : '#1A1A1A', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
              >
                {comparisonCopyState === 'copied' ? 'Copied!' : 'Copy link'}
              </button>
              {typeof navigator !== 'undefined' && navigator.share && (
                <button
                  onClick={shareComparisonLink}
                  style={{ flex: 1, padding: '10px', background: '#F3F4F6', color: '#1A1A1A', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                >
                  Share...
                </button>
              )}
            </div>
            <button
              onClick={() => setComparisonLink(null)}
              style={{ width: '100%', padding: '10px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
    </div>
  )
}
