import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import { useLongPress, LONG_PRESS_NO_SELECT } from '../hooks/useLongPress'
import CardActionSheet from '../components/ui/CardActionSheet'
import PinButton from '../components/ui/PinButton'
import PartyAddButton from '../components/ui/PartyAddButton'
import SwipeToDelete from '../components/ui/SwipeToDelete'
import { usePartyLists } from '../hooks/usePartyLists'
import PartyListPicker from '../components/party/PartyListPicker'
import { IconThumbUp, IconThumbDown, IconHistory, IconMessageCircle, IconArrowsUpDown, IconRefresh, IconPin, IconConfetti } from '@tabler/icons-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useModalFocus } from '../hooks/useModalFocus'
import InviteFriendCard from '../components/ui/InviteFriendCard'

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f'
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
  // Defensive only — every real votes row is yes/ly/ln/no (the only
  // choices cast_vote() has ever accepted since migration 099 removed
  // the dead 'dec' value, confirmed zero rows ever used it).
  return null
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

// timeAgo's counterpart for a FUTURE timestamp — used for an open party's
// expires_at. A straight reuse of timeAgo would silently misreport this
// (its diff is always negative for a future date, which every one of its
// branches treats as "under 60 seconds").
function timeUntil(dateString) {
  const now = new Date()
  const date = new Date(dateString)
  const diff = Math.floor((date - now) / 1000)
  if (diff <= 0) return 'expiring soon'
  if (diff < 3600) return `expires in ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `expires in ${Math.floor(diff / 3600)}h`
  return `expires in ${Math.floor(diff / 86400)}d`
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

// Visible pin icon added 2026-11-02 (Aidan noticed the Comments tab was
// the one place a comment showed up with no way to pin it except the
// longpress sheet, unlike every other pinned-content surface) — same
// top-right placement/size as PinnedCommentCard/PinnedQuestionCard below,
// `position: relative` added to the wrapper for it to anchor against.
// The longpress sheet's own "Pin this comment"/"Unpin this comment"
// entry (see this card's call site) stays too, same as how
// PartyQuestionCard/PinnedQuestionCard both keep their own longpress
// sheet alongside a visible one-tap icon elsewhere in this file — a
// second way to reach the same action, not a replacement for it.
function MyCommentCard({ c, navigate, pinned, onTogglePin, onLongPress }) {
  const longPress = useLongPress(() => onLongPress(c))
  return (
    <div
      onClick={() => { if (!longPress.wasLongPress()) navigate(`/conversation/${c.questions?.id}`) }}
      {...longPress}
      style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', position: 'relative', ...LONG_PRESS_NO_SELECT }}
    >
      <PinButton pinned={pinned} onToggle={onTogglePin} size={15} style={{ position: 'absolute', top: '10px', right: '10px' }} />
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
  // Was `${row.first_name} ${row.last_initial}.` unconditionally -- when
  // last_initial is genuinely null (a 'full'-preference account with no
  // last name on file, e.g. one that slipped through before Register.jsx
  // required it), a template literal stringifies JS null as the literal
  // text "null", rendering as "Debman null." instead of just "Debman".
  // Matches the guard AdminReports.jsx already had in the one place that
  // got this right.
  return `${row.first_name}${row.last_initial ? ` ${row.last_initial}.` : ''}`
}

// A pinned question — bold question text as the main content (this is
// what you're being reminded of), category + your vote status (or "Not
// voted yet") as the quick info below. No longpress sheet here (unlike
// the other tabs' cards) — the pin icon is the direct one-tap unpin, and
// tapping the card just opens the question, same single-purpose pattern
// PinButton already uses on Explore/Conversation.
function PinnedQuestionCard({ pin, navigate, onTogglePin, onLongPress }) {
  const longPress = useLongPress(() => onLongPress(pin))
  return (
    <div
      onClick={() => { if (!longPress.wasLongPress()) navigate(pin.userVoteChoice ? `/conversation/${pin.question_id}` : `/vote?question=${pin.question_id}`) }}
      {...longPress}
      style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', position: 'relative', ...LONG_PRESS_NO_SELECT }}
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

// One row in the "?Party" tab's own per-list curated view — same shape as
// PinnedQuestionCard just above (standing per-user lists over the same
// kind of row), swapping PinButton for PartyAddButton since this list is
// one of the user's own party_lists (migration 098), not pinned_questions.
// "added" is always true here — this card only ever renders for a
// question already in the list, tapping the button removes it.
function PartyQuestionCard({ item, navigate, onToggleParty, onLongPress }) {
  const longPress = useLongPress(() => onLongPress(item))
  return (
    <div
      onClick={() => { if (!longPress.wasLongPress()) navigate(item.userVoteChoice ? `/conversation/${item.question_id}` : `/vote?question=${item.question_id}`) }}
      {...longPress}
      style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', position: 'relative', ...LONG_PRESS_NO_SELECT }}
    >
      <PartyAddButton added onToggle={onToggleParty} size={15} style={{ position: 'absolute', top: '10px', right: '10px' }} />
      <div style={{ fontSize: '11px', color: '#0C447C', background: '#E6F1FB', display: 'inline-block', padding: '2px 8px', borderRadius: '20px', marginBottom: '8px' }}>
        {item.category}
      </div>
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.4, marginBottom: '8px', paddingRight: '22px' }}>
        {item.text}
      </div>
      {item.userVoteChoice ? (
        <span style={{
          fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: 700,
          background: '#FFFFFF', border: `1.5px solid ${VOTE_COLORS[item.userVoteChoice]}`, color: VOTE_PILL_STYLES[item.userVoteChoice]?.color,
        }}>
          You voted {VOTE_LABELS[item.userVoteChoice]}
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
function PinnedCommentCard({ pin, navigate, onTogglePin, onLongPress }) {
  const displayName = getDisplayName(pin)
  const longPress = useLongPress(() => onLongPress(pin))
  return (
    <div
      onClick={() => { if (!longPress.wasLongPress()) navigate(`/conversation/${pin.question_id}`) }}
      {...longPress}
      style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', position: 'relative', ...LONG_PRESS_NO_SELECT }}
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

// Remembers which of the 6 tabs below was open, across navigating away
// from /activity and back (Aidan, 2026-11-02: "when you navigate from
// whatever tab you were on in /activity, go back to the same tab") --
// this page remounts fresh on every visit (it's a plain route under
// AppShell, not kept alive like AppShell itself), so a plain useState
// default always reset to 'history'. Not anything another user needs to
// see or that belongs in the database, so localStorage rather than a new
// column -- same reasoning as AdminDashboard's own CARD_ORDER_KEY just
// above this file's own equivalent, and the same try/catch-and-fall-back
// shape, for the same reason (private browsing / storage disabled should
// just silently not persist, never break the page).
const ACTIVITY_TAB_KEY = 'senseus_activity_tab'
// Keep in sync with the tab `key`s defined in the tab-bar render below --
// an unrecognized or stale stored value (an old key from a tab that's
// since been renamed or removed) falls back to the default rather than
// selecting a tab that no longer exists.
const ACTIVITY_TAB_KEYS = ['history', 'comments', 'shifts', 'revisit', 'pinned', 'party']

function loadActivityTab() {
  try {
    const stored = localStorage.getItem(ACTIVITY_TAB_KEY)
    return ACTIVITY_TAB_KEYS.includes(stored) ? stored : 'history'
  } catch {
    return 'history'
  }
}

function saveActivityTab(key) {
  try {
    localStorage.setItem(ACTIVITY_TAB_KEY, key)
  } catch {
    // Private browsing / storage disabled -- the tab just won't be
    // remembered next visit. Not worth surfacing an error for.
  }
}

export default function Activity() {
  usePageTitle('Your Activity')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState(loadActivityTab)
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

  // "?Party" state. migration 098 replaced the old flat party_questions
  // table with party_lists/party_list_questions (multiple named lists) —
  // usePartyLists() is eager (fetches on mount), same reasoning as
  // pinnedQuestionIds above: every longpress sheet below needs an
  // accurate Add/Remove label regardless of whether the Party tab itself
  // has been opened yet. partyListCards (the full card data — question
  // text/category/vote status — for each list's own curation view) and
  // myParties (every party the user hosts or has joined, via
  // get_my_parties()) are both lazy, loaded only once the tab is
  // actually opened, same as the Pinned tab's own lists.
  const partyLists = usePartyLists()
  const [partyPickerQuestionId, setPartyPickerQuestionId] = useState(null)
  const [partyListCards, setPartyListCards] = useState(new Map()) // list_id -> cardItem[]
  const [myParties, setMyParties] = useState([])
  const [expandedListId, setExpandedListId] = useState(null)
  const [newListName, setNewListName] = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [listError, setListError] = useState(null)
  const [editingListId, setEditingListId] = useState(null)
  const [editingListName, setEditingListName] = useState('')
  const [requestHeadcount, setRequestHeadcount] = useState(2)
  const [requestName, setRequestName] = useState('')
  const [creatingParty, setCreatingParty] = useState(false)
  const [partyCreateError, setPartyCreateError] = useState(null)
  // Same one-time dismissible callout pattern as Explore.jsx's own
  // longpress hint (senseus_seen_longpress_hint_explore) — Aidan's own
  // near-final copy, lightly wordsmithed to name the actual UI (the +
  // icon / longpress menu) rather than the more abstract "select it".
  const [showPartyTooltip, setShowPartyTooltip] = useState(
    localStorage.getItem('senseus_seen_party_tab_tooltip') !== 'true'
  )

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

  // migration 098: party_questions (one flat list) is replaced by
  // party_lists/party_list_questions (multiple named lists) — see
  // usePartyLists.js. Keeps this a single tap for the 0-or-1-list case
  // (everyone, until they deliberately make a second list); only opens
  // the picker once "add to which list" is actually ambiguous.
  async function togglePartyQuestion(questionId) {
    if (!user) return
    const result = await partyLists.smartToggle(questionId)
    if (result?.needsPicker) {
      setPartyPickerQuestionId(questionId)
      return
    }
    if (result?.error) {
      alert(result.error.message || 'Something went wrong — please try again.')
      return
    }
    // Invalidate the Party tab's own cached card data (built from a
    // separate questions-table join, not just the id sets above) so it
    // refetches next time that tab is opened, rather than trying to
    // guess which list this toggle just changed from here.
    setLoadedTabs(prev => { const s = new Set(prev); s.delete('party'); return s })
  }

  async function shareQuestion(question) {
    if (!question?.question_number) return
    // Share links no longer carry ?ref=<your id> (migration 108) — see
    // VoteCard.jsx's shareQuestion() comment for the full reasoning.
    const url = `https://senseus.app/q/${question.question_number}`
    const shareData = { title: 'senseUS', text: 'What do you think?', url }
    if (navigator.share) {
      // try/await/catch, not .catch() chained onto the call — on Aidan's
      // real device, navigator.share() was throwing SYNCHRONOUSLY rather
      // than returning a rejected promise. A bare `.catch()` never even
      // gets attached when the call itself throws, so the exception
      // propagated straight up through this handler and into the
      // longpress menu's own onClick wrapper (CardActionSheet.jsx:
      // `action.onClick(); onClose()`), which is why the menu never
      // closed and no error ever surfaced. await-ing inside try/catch
      // catches both forms the same way, matching every other share
      // handler in the app.
      //
      // claim_share() now fires AFTER starting the share call, not
      // before (2026-11-08) — calling it first was itself breaking
      // navigator.share() on Aidan's device (confirmed via VoteCard's
      // and InviteFriendCard's identical buttons, which started working
      // the instant that call was removed). Still fires unconditionally
      // right after, so "credit on click regardless of completion"
      // (migration 108) is unaffected.
      try {
        const sharePromise = navigator.share(shareData)
        // Promise.resolve(...) wrap: see InviteFriendCard.jsx's invite()
        // comment -- .rpc() with no params returns a bare thenable
        // that doesn't implement .catch() in this build.
        Promise.resolve(supabase.rpc('claim_share')).catch(() => {})
        await sharePromise
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('navigator.share failed:', err)
          alert(`Couldn't open the share sheet (${err?.message || err?.name || 'unknown error'}). Here's the link:\n\n${url}`)
        }
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      alert('Link copied to clipboard!')
    } catch (err) {
      console.error('Clipboard write failed:', err)
      alert(`Couldn't copy automatically. Here's the link:\n\n${url}`)
      prompt('Copy this link:', url)
    }
  }

  async function shareComment(comment) {
    if (!comment.questions?.question_number) return
    const url = `https://senseus.app/q/${comment.questions.question_number}#comment-${comment.id}`
    const shareData = { title: 'senseUS', text: 'Join the conversation on senseUS', url }
    if (navigator.share) {
      // See shareQuestion() above — same sync-throw fix, and same
      // claim_share()-ordering/wrap fix.
      try {
        const sharePromise = navigator.share(shareData)
        Promise.resolve(supabase.rpc('claim_share')).catch(() => {})
        await sharePromise
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('navigator.share failed:', err)
          alert(`Couldn't open the share sheet (${err?.message || err?.name || 'unknown error'}). Here's the link:\n\n${url}`)
        }
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      alert('Link copied to clipboard!')
    } catch (err) {
      console.error('Clipboard write failed:', err)
      alert(`Couldn't copy automatically. Here's the link:\n\n${url}`)
      prompt('Copy this link:', url)
    }
  }

  async function startComparison() {
    setComparisonLinkError(null)

    // As of migration 079, comparison_tokens has zero standing grants —
    // a direct insert() here 403s unconditionally now (this call site
    // was missed when Compare.jsx's own startNewComparison() was moved
    // over to the RPC at the time). create_comparison_token() sets
    // sender_id from auth.uid() server-side and returns the same
    // { token } shape a direct insert().select('token') used to.
    const { data, error } = await supabase.rpc('create_comparison_token').single()

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
          question_number: p.questions.question_number,
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

  // Builds the Party tab's own per-list card data — question text/
  // category/number plus each curated question's own userVoteChoice
  // (useful here specifically: it's how someone curating a list sees at
  // a glance which of their own picks they still need to vote on before
  // a party they start can ever complete). usePartyLists() already has
  // the raw list_id -> question_id membership; this is the one extra
  // join (against questions, then votes) needed to render real cards.
  async function fetchPartyListCards() {
    const allQuestionIds = new Set()
    for (const set of partyLists.listQuestionIds.values()) {
      for (const qId of set) allQuestionIds.add(qId)
    }
    const questionIds = [...allQuestionIds]

    if (questionIds.length === 0) {
      setPartyListCards(new Map())
      return
    }

    const [{ data: questionsData }, { data: votesData }] = await Promise.all([
      supabase.from('questions').select('id, text, category, question_number').in('id', questionIds),
      supabase.from('votes').select('question_id, choice').eq('user_id', user.id).in('question_id', questionIds),
    ])

    const questionMap = {}
    ;(questionsData || []).forEach(q => { questionMap[q.id] = q })
    const voteMap = {}
    ;(votesData || []).forEach(v => { voteMap[v.question_id] = v.choice })

    const cardsByList = new Map()
    for (const list of partyLists.lists) {
      const ids = [...(partyLists.listQuestionIds.get(list.id) || [])]
      cardsByList.set(list.id, ids
        .filter(id => questionMap[id])
        .map(id => ({
          question_id: id,
          text: questionMap[id].text,
          category: questionMap[id].category,
          question_number: questionMap[id].question_number,
          userVoteChoice: voteMap[id] || null,
        }))
      )
    }
    setPartyListCards(cardsByList)
  }

  async function fetchMyParties() {
    const { data } = await supabase.rpc('get_my_parties')
    setMyParties(data || [])
  }

  // Swipe-to-delete on a completed/expired party row (see SwipeToDelete
  // and its disabled={p.status === 'open'} below -- an open party can't
  // be swiped at all, matching hide_party()'s own server-side check).
  // RPC-only, like every other write against question_party_participants
  // (migration 095's own header) -- and per Aidan's explicit call
  // (2026-10-29), this only ever touches the caller's own participant
  // row (hidden_at), never a real delete of the party itself, so it
  // never affects what any other participant sees. Migration
  // 097_hide_completed_parties.sql.
  async function hideParty(partyId) {
    const { error } = await supabase.rpc('hide_party', { p_party_id: partyId })
    if (error) { alert(error.message || 'Something went wrong — please try again.'); return }
    setMyParties(prev => prev.filter(p => p.party_id !== partyId))
  }

  async function fetchParty() {
    // usePartyLists() fetches eagerly on mount, but the Party tab can be
    // opened before that settles — refetch() first guarantees the list/
    // membership data this card-building pass joins against is current.
    await partyLists.refetch()
    await Promise.all([fetchPartyListCards(), fetchMyParties()])
  }

  async function handleCreateList() {
    const name = newListName.trim()
    if (!name) return
    setListError(null)
    setCreatingList(true)
    const { error } = await partyLists.createList(name)
    setCreatingList(false)
    if (error) { setListError(error.message || 'Something went wrong — please try again.'); return }
    setNewListName('')
    setPartyListCards(prev => new Map(prev)) // new list starts with no cards; next render picks it up via partyLists.lists
  }

  function startRenameList(list) {
    setEditingListId(list.id)
    setEditingListName(list.name)
  }

  async function saveRenameList() {
    const name = editingListName.trim()
    if (!name || !editingListId) { setEditingListId(null); return }
    const { error } = await partyLists.renameList(editingListId, name)
    if (error) alert(error.message || 'Something went wrong — please try again.')
    setEditingListId(null)
  }

  // Deleting a list only removes the curation list itself — any party
  // already created from it is an independent snapshot (question_party_
  // questions carries no reference back to party_lists) and is
  // completely unaffected, per the discussion with Aidan on exactly this
  // question (2026-11-01).
  async function handleDeleteList(listId) {
    if (!window.confirm('Delete this list? Any ?Party! already created from it keeps working fine — this only removes the curation list itself.')) return
    const { error } = await partyLists.deleteList(listId)
    if (error) { alert(error.message || 'Something went wrong — please try again.'); return }
    setPartyListCards(prev => { const m = new Map(prev); m.delete(listId); return m })
    if (expandedListId === listId) setExpandedListId(null)
  }

  // Creates a new party from one specific list's current curation
  // (create_party() snapshots party_list_questions for that list_id
  // server-side — migration 098) with the host's own declared headcount,
  // then immediately offers the resulting invite link via the same
  // share()/clipboard-fallback idiom every other share button in this
  // app already uses (InviteFriendCard, shareQuestion).
  async function handleRequestParty(listId, headcount, name) {
    setPartyCreateError(null)
    setCreatingParty(true)
    const { data, error } = await supabase.rpc('create_party', { p_list_id: listId, p_headcount: headcount, p_name: name || null }).single()
    setCreatingParty(false)

    if (error || !data) {
      setPartyCreateError(error?.message || 'Something went wrong creating your party. Please try again.')
      return
    }

    setRequestName('')

    const url = `https://senseus.app/party/${data.invite_token}`
    // Wording is Aidan's own exact phrasing (2026-11-02, revised same day
    // to add the party's name back in after an earlier pass dropped it).
    // No name set -> drop the "called X" clause entirely rather than
    // rendering it with something empty/awkward in its place.
    const trimmedPartyName = name?.trim()
    const shareData = {
      title: 'senseUS',
      text: trimmedPartyName
        ? `I made a ?Party! called ${trimmedPartyName}, and want your input! Click here to accept and vote!`
        : 'I made a ?Party! and want your input! Click here to accept and vote!',
      url,
    }

    if (navigator.share) {
      // navigator.share() must be called before claim_share(), not
      // after — see VoteCard.jsx's shareQuestion() comment. The bonus
      // still counts toward the sharing integrity-weight bonus the
      // moment this fires (migration 108), regardless of whether the
      // share sheet below is completed — just ordered so it doesn't
      // break the call itself.
      try {
        const sharePromise = navigator.share(shareData)
        // Promise.resolve(...) wrap: see InviteFriendCard.jsx's invite()
        // comment -- .rpc() with no params returns a bare thenable
        // that doesn't implement .catch() in this build.
        Promise.resolve(supabase.rpc('claim_share')).catch(() => {})
        await sharePromise
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('navigator.share failed:', err)
          alert(`Couldn't open the share sheet (${err?.message || err?.name || 'unknown error'}). Here's the link:\n\n${url}`)
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(url)
        alert('Party invite link copied to clipboard!')
      } catch (err) {
        console.error('Clipboard write failed:', err)
        alert(`Couldn't copy automatically. Here's the link:\n\n${url}`)
        prompt('Copy this link:', url)
      }
    }

    fetchMyParties()
  }

  const FETCHERS = {
    comments: fetchComments,
    shifts: fetchShifts,
    revisit: fetchRevisit,
    history: fetchHistory,
    pinned: fetchPinned,
    party: fetchParty,
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

  // AppShell's <main> reserves Header/BottomNav's real heights via
  // padding (2026-11-01), so '100%' here lands on exactly the space
  // between them -- no page-local calc() needed.
  return (
    <div style={{ minHeight: '100%', boxSizing: 'border-box', background: '#C7C7CC', paddingBottom: '80px' }}>
    <div style={{ padding: '14px', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: 'var(--senseus-card-radius)', boxShadow: 'var(--senseus-card-shadow)' }}>

      {/* Page title */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Activity</h1>
      </div>

      {/* Tabs — icon + tiny label, stacked (Aidan, 2026-10-30: pure icons
          weren't clear enough on their own, back to a visible name under
          each one — same icon-on-top/label-below shape as BottomNav's own
          primary nav). Icon size bumped from 20 to 30 (50% bigger, per
          Aidan's ask) — aria-label/title are redundant with the now-visible
          label but kept anyway, consistent with every other labeled icon
          control in this app. Icon choices: IconArrowsUpDown for Shifts
          (up/down side by side) and IconRefresh for Revisit (a single
          arrow circling back) were the two Aidan specifically wanted
          checked for availability — confirmed present in the installed
          @tabler/icons-react (3.44.0). */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '1.5rem', background: '#F3F4F6', padding: '4px', borderRadius: '10px' }}>
        {[
          { key: 'history', label: 'History', icon: IconHistory },
          { key: 'comments', label: 'Comments', icon: IconMessageCircle },
          { key: 'shifts', label: 'Shifts', icon: IconArrowsUpDown },
          { key: 'revisit', label: 'Revisit', icon: IconRefresh },
          { key: 'pinned', label: 'Pinned', icon: IconPin },
          { key: 'party', label: '?Party!', icon: IconConfetti },
        ].map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); saveActivityTab(t.key) }}
              aria-label={t.label}
              aria-current={tab === t.key ? 'page' : undefined}
              title={t.label}
              style={{
                flex: 1, padding: '6px 2px', background: tab === t.key ? '#2D3DCA' : 'transparent',
                color: tab === t.key ? 'white' : '#6B7280', border: 'none', borderRadius: '8px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '3px', cursor: 'pointer',
              }}
            >
              <Icon size={30} />
              <span style={{ fontSize: '9px', fontWeight: tab === t.key ? 700 : 400, fontFamily: 'Merriweather, serif', lineHeight: 1, whiteSpace: 'nowrap' }}>
                {t.label}
              </span>
            </button>
          )
        })}
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
                      pinned={pinnedCommentIds.has(c.id)}
                      onTogglePin={() => togglePinComment(c.id)}
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
                          {
                            label: partyLists.lists.length > 1
                              ? 'Add to a ?Party! list'
                              : partyLists.isInAnyList(comment.questions?.id) ? 'Remove from ?Party! list' : 'Add to ?Party! list',
                            onClick: () => togglePartyQuestion(comment.questions?.id),
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
                          {
                            label: partyLists.lists.length > 1
                              ? 'Add to a ?Party! list'
                              : partyLists.isInAnyList(s.questions?.id) ? 'Remove from ?Party! list' : 'Add to ?Party! list',
                            onClick: () => togglePartyQuestion(s.questions?.id),
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
                          {
                            label: partyLists.lists.length > 1
                              ? 'Add to a ?Party! list'
                              : partyLists.isInAnyList(s.questions?.id) ? 'Remove from ?Party! list' : 'Add to ?Party! list',
                            onClick: () => togglePartyQuestion(s.questions?.id),
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
              {/* Above "Compare your vote history" per Aidan's request */}
              <InviteFriendCard />
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
                          {
                            label: partyLists.lists.length > 1
                              ? 'Add to a ?Party! list'
                              : partyLists.isInAnyList(v.questions?.id) ? 'Remove from ?Party! list' : 'Add to ?Party! list',
                            onClick: () => togglePartyQuestion(v.questions?.id),
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
                        onLongPress={(p) => setActionSheet({
                          title: p.text,
                          actions: [
                            { label: 'View this question', onClick: () => navigate(`/conversation/${p.question_id}`) },
                            ...(p.userVoteChoice
                              ? [{ label: 'Change my vote', onClick: () => navigate(`/vote?question=${p.question_id}&currentVote=${p.userVoteChoice}`) }]
                              : []),
                            { label: 'Share this question', onClick: () => shareQuestion({ question_number: p.question_number }) },
                            { label: 'Unpin this question', onClick: () => togglePinQuestion(p.question_id) },
                            {
                              label: partyLists.lists.length > 1
                                ? 'Add to a ?Party! list'
                                : partyLists.isInAnyList(p.question_id) ? 'Remove from ?Party! list' : 'Add to ?Party! list',
                              onClick: () => togglePartyQuestion(p.question_id),
                            },
                          ],
                        })}
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
                        onLongPress={(p) => setActionSheet({
                          title: p.question_text,
                          actions: [
                            { label: 'View this question', onClick: () => navigate(`/conversation/${p.question_id}`) },
                            // Only offered on your own pinned comment — get_pinned_comments()'s
                            // vote_choice is the comment's own frozen snapshot, which for someone
                            // ELSE's comment isn't the current viewer's vote at all, so "change my
                            // vote" wouldn't mean anything reliable there.
                            ...(p.is_own
                              ? [{ label: 'Change my vote', onClick: () => navigate(`/vote?question=${p.question_id}&currentVote=${p.vote_choice}`) }]
                              : []),
                            { label: 'Share this question', onClick: () => shareQuestion({ question_number: p.question_number }) },
                            ...(p.question_number
                              ? [{
                                  label: 'Share this comment',
                                  onClick: () => shareComment({ id: p.comment_id, questions: { question_number: p.question_number } }),
                                }]
                              : []),
                            { label: 'Unpin this comment', onClick: () => togglePinComment(p.comment_id) },
                            {
                              label: partyLists.lists.length > 1
                                ? 'Add to a ?Party! list'
                                : partyLists.isInAnyList(p.question_id) ? 'Remove from ?Party! list' : 'Add to ?Party! list',
                              onClick: () => togglePartyQuestion(p.question_id),
                            },
                          ],
                        })}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {tab === 'party' && (
            <div>
              {showPartyTooltip && (
                <div style={{ marginBottom: '1.25rem', background: '#E6F1FB', border: '1px solid #0C447C', borderRadius: '10px', padding: '10px 14px', fontSize: '12px', color: '#0C447C', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', lineHeight: 1.5 }}>
                  <span>Make a list of up to 10 questions, pick how many people you're inviting (2–6, including you), and send it out. Tap the + on any question's card (or use its long-press menu) to add it to a list.</span>
                  <button
                    onClick={() => {
                      localStorage.setItem('senseus_seen_party_tab_tooltip', 'true')
                      setShowPartyTooltip(false)
                    }}
                    style={{ background: 'none', border: 'none', color: '#0C447C', fontSize: '16px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>
              )}

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '8px' }}>
                  Your Lists
                </div>

                {partyLists.lists.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '13px', background: '#F9FAFB', borderRadius: '10px', marginBottom: '12px' }}>
                    <div style={{ fontSize: '28px', marginBottom: '0.5rem' }}>❓</div>
                    No lists yet. Make one below, then tap the + on any question's card (or use its long-press menu) to add it.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
                    {partyLists.lists.map(list => {
                      const cards = partyListCards.get(list.id) || []
                      const expanded = expandedListId === list.id
                      const isEditing = editingListId === list.id
                      return (
                        <div key={list.id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden' }}>
                          <div
                            onClick={() => setExpandedListId(expanded ? null : list.id)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', cursor: 'pointer' }}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editingListName}
                                onChange={(e) => setEditingListName(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveRenameList() }}
                                onBlur={saveRenameList}
                                style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: '#1A1A1A', fontFamily: 'Merriweather, serif', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '4px 8px', marginRight: '8px' }}
                              />
                            ) : (
                              <span
                                style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}
                                onClick={(e) => { e.stopPropagation(); startRenameList(list) }}
                              >
                                {list.name}
                              </span>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                              <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{cards.length}/10</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteList(list.id) }}
                                style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '12px', cursor: 'pointer', padding: 0 }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>

                          {expanded && (
                            <div style={{ padding: '0 14px 14px' }}>
                              {cards.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '1.5rem 0', color: '#6B7280', fontSize: '12px' }}>
                                  No questions yet. Tap the + on any question's card, or use its long-press menu, to add one here.
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                                  {cards.map(item => (
                                    <SwipeToDelete key={item.question_id} onDelete={() => {
                                      partyLists.removeFromList(list.id, item.question_id)
                                      setPartyListCards(prev => { const m = new Map(prev); m.set(list.id, (m.get(list.id) || []).filter(c => c.question_id !== item.question_id)); return m })
                                    }}>
                                      <PartyQuestionCard
                                        item={item}
                                        navigate={navigate}
                                        onToggleParty={() => {
                                          partyLists.removeFromList(list.id, item.question_id)
                                          setPartyListCards(prev => { const m = new Map(prev); m.set(list.id, (m.get(list.id) || []).filter(c => c.question_id !== item.question_id)); return m })
                                        }}
                                        onLongPress={(p) => setActionSheet({
                                          title: p.text,
                                          actions: [
                                            { label: 'View this question', onClick: () => navigate(`/conversation/${p.question_id}`) },
                                            ...(p.userVoteChoice
                                              ? [{ label: 'Change my vote', onClick: () => navigate(`/vote?question=${p.question_id}&currentVote=${p.userVoteChoice}`) }]
                                              : [{ label: 'Vote on this question', onClick: () => navigate(`/vote?question=${p.question_id}`) }]),
                                            { label: 'Share this question', onClick: () => shareQuestion({ question_number: p.question_number }) },
                                            { label: 'Remove from this list', onClick: () => {
                                              partyLists.removeFromList(list.id, p.question_id)
                                              setPartyListCards(prev => { const m = new Map(prev); m.set(list.id, (m.get(list.id) || []).filter(c => c.question_id !== p.question_id)); return m })
                                            } },
                                          ],
                                        })}
                                      />
                                    </SwipeToDelete>
                                  ))}
                                </div>
                              )}

                              <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px' }}>
                                Name it? (optional)
                              </div>
                              <input
                                value={requestName}
                                onChange={(e) => setRequestName(e.target.value)}
                                placeholder="?Party!"
                                maxLength={60}
                                style={{
                                  width: '100%', boxSizing: 'border-box', marginBottom: '10px', padding: '8px 10px',
                                  fontSize: '13px', color: '#1A1A1A', fontFamily: 'Merriweather, serif',
                                  border: '1px solid #D1D5DB', borderRadius: '6px',
                                }}
                              />

                              <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px' }}>
                                How many people, including you? (2–6)
                              </div>
                              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                                {[2, 3, 4, 5, 6].map(n => (
                                  <button
                                    key={n}
                                    onClick={() => setRequestHeadcount(n)}
                                    style={{
                                      flex: 1, padding: '7px 0', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                                      background: requestHeadcount === n ? '#2D3DCA' : '#F3F4F6',
                                      color: requestHeadcount === n ? 'white' : '#6B7280',
                                      border: 'none', fontFamily: 'Merriweather, serif',
                                    }}
                                  >
                                    {n}
                                  </button>
                                ))}
                              </div>

                              <button
                                onClick={() => handleRequestParty(list.id, requestHeadcount, requestName)}
                                disabled={cards.length === 0 || creatingParty}
                                style={{
                                  width: '100%', padding: '8px', background: '#2D3DCA', color: 'white', border: 'none',
                                  borderRadius: '8px', fontSize: '13px', fontWeight: 700, fontFamily: 'Merriweather, serif',
                                  cursor: (cards.length === 0 || creatingParty) ? 'default' : 'pointer',
                                  opacity: (cards.length === 0 || creatingParty) ? 0.6 : 1,
                                }}
                              >
                                {creatingParty ? 'Creating your party…' : 'Request a ?Party!'}
                              </button>
                              {partyCreateError && (
                                <p style={{ fontSize: '12px', color: '#991B1B', marginTop: '6px', marginBottom: 0 }}>{partyCreateError}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateList() }}
                    placeholder="New list name"
                    style={{ flex: 1, fontSize: '13px', fontFamily: 'Merriweather, serif', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '8px 10px' }}
                  />
                  <button
                    onClick={handleCreateList}
                    disabled={!newListName.trim() || creatingList}
                    style={{
                      padding: '8px 14px', background: '#F3F4F6', color: '#2D3DCA', border: 'none', borderRadius: '8px',
                      fontSize: '13px', fontWeight: 700, fontFamily: 'Merriweather, serif',
                      cursor: (!newListName.trim() || creatingList) ? 'default' : 'pointer',
                      opacity: (!newListName.trim() || creatingList) ? 0.6 : 1,
                    }}
                  >
                    + New List
                  </button>
                </div>
                {listError && (
                  <p style={{ fontSize: '12px', color: '#991B1B', marginTop: '6px', marginBottom: 0 }}>{listError}</p>
                )}
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '8px' }}>
                  Your Parties
                </div>
                {myParties.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '13px', background: '#F9FAFB', borderRadius: '10px' }}>
                    No parties yet — make a list above, then request one.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {myParties.map(p => (
                      <SwipeToDelete key={p.party_id} onDelete={() => hideParty(p.party_id)} disabled={p.status === 'open'}>
                        <div
                          onClick={() => navigate(`/party/${p.invite_token}`)}
                          style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                              {p.party_name || (p.is_host ? 'You hosted' : 'You joined')}
                            </span>
                            <span style={{
                              fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
                              background: p.status === 'open' ? '#E6F1FB' : p.status === 'completed' ? '#eef3e0' : '#F3F4F6',
                              color: p.status === 'open' ? '#0C447C' : p.status === 'completed' ? '#4d621d' : '#6B7280',
                            }}>
                              {p.status === 'open' ? 'Open' : p.status === 'completed' ? 'Completed' : 'Expired'}
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#6B7280' }}>
                            {p.party_name && `${p.is_host ? 'You hosted' : 'You joined'} · `}
                            {p.question_count} question{p.question_count === 1 ? '' : 's'} · {p.participant_count}/{p.capacity} joined
                            {p.status === 'open' && ` · ${timeUntil(p.expires_at)}`}
                            {p.status === 'completed' && p.completed_at && ` · completed ${timeAgo(p.completed_at)}`}
                          </div>
                        </div>
                      </SwipeToDelete>
                    ))}
                  </div>
                )}
              </div>
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

      {partyPickerQuestionId && (
        <PartyListPicker
          questionId={partyPickerQuestionId}
          lists={partyLists.lists}
          listQuestionIds={partyLists.listQuestionIds}
          onToggleList={(listId, questionId) => {
            const already = partyLists.listQuestionIds.get(listId)?.has(questionId)
            return already ? partyLists.removeFromList(listId, questionId) : partyLists.addToList(listId, questionId)
          }}
          onCreateList={async (name) => {
            const { data: newList, error: createError } = await partyLists.createList(name)
            if (createError) return { error: createError }
            return partyLists.addToList(newList.id, partyPickerQuestionId)
          }}
          onClose={() => {
            setPartyPickerQuestionId(null)
            setLoadedTabs(prev => { const s = new Set(prev); s.delete('party'); return s })
          }}
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
