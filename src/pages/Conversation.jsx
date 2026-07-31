import { useState, useEffect, useMemo } from 'react'
import Header from '../components/layout/Header'
import BottomNav from '../components/layout/BottomNav'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconWaveSine, IconCornerDownRight, IconNews } from '@tabler/icons-react'
import { checkComment } from '../lib/moderation'

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f', dec: '#2D3DCA'
}

const VOTE_LABELS = {
  yes: 'yes', ly: 'leaning yes', ln: 'leaning no', no: 'no', dec: 'undecided'
}

const VOTE_WASH = {
  yes: '#DAE9AF',
  ly: '#EEE5AA',
  ln: '#EBCDAD',
  no: '#EBADAD',
}

// Comments are color-coded by how the commenter voted rather than a
// random per-user hue — a comment's avatar always reflects yes/leaning
// yes/leaning no/no/undecided, same palette as everywhere else on senseUS.
const NEUTRAL_AVATAR_COLOR = '#9CA3AF' // fallback for a comment with no vote on record

const MAX_REPLY_DEPTH = 2 // comment (0) -> reply (1) -> reply (2), then no further replying

function timeAgo(dateString) {
  const now = new Date()
  const date = new Date(dateString)
  const diff = Math.floor((now - date) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function getDisplayName(profile) {
  if (!profile) return 'Anonymous'
  if (profile.display_preference === 'anon') return profile.anon_name || 'Anonymous'
  if (profile.display_preference === 'first_only') return profile.first_name
  return `${profile.first_name} ${profile.last_initial}.`
}

function getVoteColor(comment) {
  const choice = comment.votes?.[0]?.choice
  return VOTE_COLORS[choice] || NEUTRAL_AVATAR_COLOR
}

// Matches the segmented bar in ResultsCard.jsx — same colors, same
// yes/no percentage math (leaning votes fold into their nearest side).
function VoteBreakdownBar({ tally }) {
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
    <div style={{ marginBottom: '1.25rem' }}>
      <div
        style={{
          width: '100%',
          height: '8px',
          borderRadius: '4px',
          overflow: 'hidden',
          display: 'flex',
          background: '#F1F1F1',
        }}
      >
        {segments.map((seg) => (
          <div
            key={seg.key}
            style={{
              width: total > 0 ? `${(seg.value / total) * 100}%` : '25%',
              background: VOTE_COLORS[seg.key],
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '12px',
          marginTop: '4px',
        }}
      >
        <span style={{ color: '#4d6214' }}>{pctYes}% yes</span>
        <span style={{ color: '#8a1616' }}>{pctNo}% no</span>
      </div>
      <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '6px' }}>
        {total.toLocaleString()} verified humans answered
      </div>
    </div>
  )
}

// A genuine, stable, top-level component — NOT defined inside Conversation().
// Everything it needs comes through props. This is the actual fix for the
// "keyboard disappears after every letter" bug: when CommentCard used to be
// defined inside Conversation's own function body, every keystroke updated
// Conversation's state, which re-ran Conversation's whole function, which
// redefined CommentCard as a brand-new function on every render. React saw
// that as a completely different component and threw away + rebuilt every
// comment card (including whatever you were typing into) on every character.
// A component defined at module scope never has that identity problem.
function CommentCard({
  comment,
  depth = 0,
  featured = false,
  pinned = false,
  comments,
  user,
  canParticipate,
  userResonances,
  replyingTo,
  setReplyingTo,
  replyText,
  setReplyText,
  editingId,
  setEditingId,
  editText,
  setEditText,
  submitting,
  toggleResonate,
  shareComment,
  flagComment,
  deleteComment,
  updateComment,
  submitComment,
}) {
  const displayName = getDisplayName(comment.profiles)
  const voteChoice = comment.votes?.[0]?.choice
  const hasResonated = userResonances.has(comment.id)
  const replies = comments.filter(c => c.parent_id === comment.id)
  const avatarColor = getVoteColor(comment)
  const isOwn = comment.user_id === user?.id
  const isEditing = editingId === comment.id

  // Shared props every recursive reply needs — same list every time,
  // just the comment/depth changing per call.
  const sharedProps = {
    comments, user, canParticipate, userResonances,
    replyingTo, setReplyingTo, replyText, setReplyText,
    editingId, setEditingId, editText, setEditText, submitting,
    toggleResonate, shareComment, flagComment, deleteComment, updateComment, submitComment,
  }

  return (
    <div style={{ marginLeft: depth > 0 ? `${depth * 1.25}rem` : 0, marginBottom: '12px' }}>
      <div
        style={{
          background: '#FFFFFF',
          border: (featured || pinned) ? `1.5px solid ${avatarColor}` : '0.5px solid #E5E7EB',
          borderRadius: '10px',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '10px', color: 'white', fontWeight: 700 }}>
                {displayName.charAt(0)}
              </span>
            </div>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A1A' }}>{displayName}</span>
            {voteChoice && (
              <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: VOTE_COLORS[voteChoice] + '20', color: VOTE_COLORS[voteChoice], fontWeight: 500 }}>
                {VOTE_LABELS[voteChoice]}
              </span>
            )}
            {featured && (
              <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#F3F4F6', color: '#6B7280', fontWeight: 500 }}>
                Top {voteChoice === 'yes' || voteChoice === 'ly' ? 'yes' : 'no'} comment
              </span>
            )}
            {pinned && (
              <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#F3F4F6', color: '#6B7280', fontWeight: 500 }}>
                Your comment
              </span>
            )}
            {comment.edited_at && !comment.is_removed && (
              <span style={{ fontSize: '10px', color: '#9CA3AF', fontStyle: 'italic' }}>
                --edited--
              </span>
            )}
          </div>
          <span style={{ fontSize: '10px', color: '#9CA3AF' }}>{timeAgo(comment.created_at)}</span>
        </div>

        {comment.is_removed ? (
          <p style={{ fontSize: '14px', color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.6, margin: '0 0 10px' }}>
            [deleted by user]
          </p>
        ) : isEditing ? (
          <div style={{ marginBottom: '10px' }}>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              style={{ width: '100%', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '8px', fontSize: '14px', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', resize: 'none' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={() => updateComment(comment.id)}
                disabled={!editText.trim()}
                style={{ padding: '6px 14px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontFamily: 'Merriweather, serif', opacity: !editText.trim() ? 0.5 : 1 }}
              >
                Save
              </button>
              <button
                onClick={() => { setEditingId(null); setEditText('') }}
                style={{ padding: '6px 14px', background: '#F3F4F6', color: '#6B7280', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p
            style={{
              fontSize: '14px',
              color: '#1A1A1A',
              lineHeight: 1.6,
              margin: '0 0 10px',
              padding: '8px 10px',
              borderRadius: '6px',
              background: VOTE_WASH[voteChoice] || '#F9FAFB',
            }}
          >
            {comment.body}
          </p>
        )}

        {!comment.is_removed && !isEditing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <button
              onClick={() => !isOwn && toggleResonate(comment.id)}
              disabled={!canParticipate || isOwn}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: (canParticipate && !isOwn) ? 'pointer' : 'default', color: hasResonated ? '#2D3DCA' : '#6B7280', opacity: (canParticipate && !isOwn) ? 1 : 0.5 }}
            >
              <IconWaveSine size={14} />
              <span style={{ fontSize: '12px', fontFamily: 'Merriweather, serif' }}>{comment.resonance_count}</span>
            </button>

            <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
              <button
                onClick={() => shareComment(comment.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
                title="Share this comment"
              >
                <span style={{ fontSize: '11px', fontFamily: 'Merriweather, serif' }}>⤴</span>
                <span style={{ fontSize: '11px', fontFamily: 'Merriweather, serif' }}>Share</span>
              </button>
              {canParticipate && !isOwn && (
                <button
                  onClick={() => flagComment(comment.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
                  title="Flag this comment"
                >
                  <span style={{ fontSize: '11px', fontFamily: 'Merriweather, serif' }}>⚑</span>
                </button>
              )}
            </div>

            {depth < MAX_REPLY_DEPTH && canParticipate && !isOwn && (
              <button
                onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: '12px', fontFamily: 'Merriweather, serif' }}
              >
                <IconCornerDownRight size={14} />
                {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : 'reply'}
              </button>
            )}

            {isOwn && (
              <>
                <button
                  onClick={() => { setEditingId(comment.id); setEditText(comment.body) }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
                  title="Edit this comment"
                >
                  <span style={{ fontSize: '11px', fontFamily: 'Merriweather, serif' }}>Edit</span>
                </button>
                <button
                  onClick={() => deleteComment(comment.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
                  title="Delete this comment"
                >
                  <span style={{ fontSize: '11px', fontFamily: 'Merriweather, serif' }}>Delete</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {replyingTo === comment.id && (
        <div style={{ marginTop: '6px', marginLeft: '1.5rem' }}>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            rows={2}
            style={{ width: '100%', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '8px', fontSize: '13px', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', resize: 'none' }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button
              onClick={() => submitComment(replyText, comment.id)}
              disabled={submitting || !replyText.trim()}
              style={{ padding: '6px 14px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontFamily: 'Merriweather, serif', opacity: submitting || !replyText.trim() ? 0.5 : 1 }}
            >
              Reply
            </button>
            <button
              onClick={() => { setReplyingTo(null); setReplyText('') }}
              style={{ padding: '6px 14px', background: '#F3F4F6', color: '#6B7280', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {replies.length > 0 && replies.map(reply => (
        <CommentCard key={reply.id} comment={reply} depth={depth + 1} {...sharedProps} />
      ))}
    </div>
  )
}

export default function Conversation() {
  const { questionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [question, setQuestion] = useState(null)
  const [comments, setComments] = useState([])
  const [userVote, setUserVote] = useState(null)
  const [tally, setTally] = useState({ yes: 0, ly: 0, ln: 0, no: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('top')
  const [newComment, setNewComment] = useState('')
  const [replyingTo, setReplyingTo] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [userResonances, setUserResonances] = useState(new Set())

  const canParticipate = !!userVote

  useEffect(() => {
    async function fetchData() {
      try {
        // None of these six queries depend on each other's results, so
        // fetch them all together instead of one round trip at a time.
        const [
          { data: q },
          { data: vote },
          { data: tallyRow },
          { data: commentsData },
          { data: votesForQuestion },
          { data: resonances },
        ] = await Promise.all([
          supabase
            .from('questions')
            .select('id, text, category, question_number')
            .eq('id', questionId)
            .single(),
          user
            ? supabase
                .from('votes')
                .select('choice')
                .eq('question_id', questionId)
                .eq('user_id', user.id)
                .single()
            : Promise.resolve({ data: null }),
          // Current vote tally for this question, for the breakdown bar.
          // Only yes/ly/ln/no are counted — matches ResultsCard's math,
          // which doesn't include 'dec' (declined) in the yes/no percentage.
          supabase
            .rpc('get_vote_tally', { p_question_id: questionId })
            .single(),
          // Comments — no embedded profile join here. The real profiles
          // table only allows reading your own row, so an embedded join
          // silently returned null for everyone but yourself. Public
          // display fields are fetched separately below via public_profiles.
          supabase
            .from('comments')
            .select(`
              id, body, resonance_count, created_at, parent_id, user_id, edited_at, is_removed
            `)
            .eq('question_id', questionId)
            .eq('is_deleted', false)
            .order('resonance_count', { ascending: false }),
          // Comments don't have a direct DB relationship to votes (they're
          // linked only by matching user_id + question_id), so we fetch
          // every vote on this question separately (via the public_votes
          // view, since the real votes table is also locked to "own row
          // only") and merge each commenter's own choice in — this is what
          // colors each comment by how that person actually voted. This is
          // fetched once per page load, so a vote change elsewhere won't
          // recolor a comment until the next visit to this page.
          supabase
            .from('public_votes')
            .select('user_id, choice')
            .eq('question_id', questionId),
          user
            ? supabase
                .from('comment_resonances')
                .select('comment_id')
                .eq('user_id', user.id)
            : Promise.resolve({ data: null }),
        ])

        setQuestion(q)
        setUserVote(vote?.choice || null)

        if (tallyRow) {
          setTally({ yes: tallyRow.yes, ly: tallyRow.ly, ln: tallyRow.ln, no: tallyRow.no })
        }

        const voteByUser = new Map((votesForQuestion || []).map(v => [v.user_id, v.choice]))

        const commenterIds = [...new Set((commentsData || []).map(c => c.user_id))]
        const { data: commenterProfiles } = commenterIds.length
          ? await supabase
              .from('public_profiles')
              .select('id, first_name, last_initial, display_preference, anon_name')
              .in('id', commenterIds)
          : { data: [] }
        const profileById = new Map((commenterProfiles || []).map(p => [p.id, p]))

        const commentsWithVotes = (commentsData || []).map(c => ({
          ...c,
          profiles: profileById.get(c.user_id) || null,
          votes: [{ choice: voteByUser.get(c.user_id) }],
        }))

        setComments(commentsWithVotes)

        if (user) {
          setUserResonances(new Set((resonances || []).map(r => r.comment_id)))
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [questionId, user])

  async function submitComment(body, parentId = null) {
    if (!body.trim() || !user) return

    const check = checkComment(body)
    if (!check.allowed) {
      alert(check.reason)
      return
    }

    setSubmitting(true)
    const { data, error } = await supabase
      .from('comments')
      .insert({
        question_id: questionId,
        user_id: user.id,
        body: body.trim(),
        parent_id: parentId,
        is_flagged: check.flagged || false,
      })
      .select(`
        id, body, resonance_count, created_at, parent_id, user_id, edited_at, is_removed,
        profiles (first_name, last_initial, display_preference, anon_name)
      `)
      .single()

    if (error) {
      if (error.code === '23505') {
        alert('You\'ve already shared your top-level comment on this question. You can edit it instead.')
      } else {
        alert('Something went wrong posting your comment.')
      }
      setSubmitting(false)
      return
    }

    if (data) {
      const newCommentWithVote = { ...data, votes: [{ choice: userVote }] }
      setComments(prev => parentId
        ? [...prev, newCommentWithVote]
        : [newCommentWithVote, ...prev]
      )
      if (parentId) {
        setReplyingTo(null)
        setReplyText('')
      } else {
        setNewComment('')
      }
    }
    setSubmitting(false)
  }

  async function updateComment(commentId) {
    if (!editText.trim() || !user) return

    const check = checkComment(editText)
    if (!check.allowed) {
      alert(check.reason)
      return
    }

    const { error } = await supabase
      .from('comments')
      .update({
        body: editText.trim(),
        edited_at: new Date().toISOString(),
        is_flagged: check.flagged || false,
      })
      .eq('id', commentId)
      .eq('user_id', user.id)

    if (error) {
      alert('Something went wrong saving your edit.')
      return
    }

    setComments(prev => prev.map(c => c.id === commentId
      ? { ...c, body: editText.trim(), edited_at: new Date().toISOString() }
      : c
    ))
    setEditingId(null)
    setEditText('')
  }

  async function toggleResonate(commentId) {
    if (!user) return
    const hasResonated = userResonances.has(commentId)

    if (hasResonated) {
      await supabase.from('comment_resonances').delete()
        .eq('comment_id', commentId).eq('user_id', user.id)
      setUserResonances(prev => { const s = new Set(prev); s.delete(commentId); return s })
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, resonance_count: c.resonance_count - 1 } : c))
    } else {
      await supabase.from('comment_resonances').insert({ comment_id: commentId, user_id: user.id })
      setUserResonances(prev => new Set([...prev, commentId]))
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, resonance_count: c.resonance_count + 1 } : c))
    }
  }

  async function shareComment(commentId) {
    if (!question?.question_number) return

    const url = `https://senseus.app/q/${question.question_number}#comment-${commentId}`
    const shareData = {
      title: 'senseUS',
      text: 'Join the conversation on senseUS',
      url,
    }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // User cancelled the share sheet — not an error, do nothing
      }
      return
    }

    try {
      await navigator.clipboard.writeText(url)
      alert('Link copied to clipboard!')
    } catch {
      prompt('Copy this link:', url)
    }
  }

  async function deleteComment(commentId) {
    const hasReplies = comments.some(c => c.parent_id === commentId)

    if (hasReplies) {
      const confirmed = confirm(
        'This comment has replies, so deleting it would remove those too. Instead, we\'ll clear your comment\'s text but leave the thread intact. Continue?'
      )
      if (!confirmed) return

      const { error } = await supabase
        .from('comments')
        .update({ is_removed: true, body: '[deleted by user]' })
        .eq('id', commentId)
        .eq('user_id', user.id)

      if (error) {
        alert('Something went wrong removing your comment.')
        return
      }

      setComments(prev => prev.map(c => c.id === commentId
        ? { ...c, is_removed: true, body: '[deleted by user]' }
        : c
      ))
      return
    }

    if (!confirm('Delete this comment? This cannot be undone.')) return

    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', user.id)

    if (error) {
      alert('Something went wrong deleting your comment.')
      return
    }

    setComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId))
  }

  async function flagComment(commentId) {
    if (!user) return
    const { error: insertError } = await supabase.from('comment_flags').insert({
      comment_id: commentId,
      user_id: user.id,
    })
    if (insertError) {
      if (insertError.code === '23505') {
        alert('You\'ve already flagged this comment.')
      }
      // Any other error: fail silently, don't increment
      return
    }
    await supabase.rpc('increment_flag_count', { comment_id: commentId })
    alert('Thank you — this comment has been flagged for review.')
  }

  // Your own top-level comment, if you have one — pinned separately,
  // never shown again inside the regular ranked list below.
  const myComment = useMemo(() => {
    if (!user) return null
    return comments.find(c => c.user_id === user.id && !c.parent_id) || null
  }, [comments, user])

  // Top-level comments only, filtered by vote-choice tab, then sorted.
  // Your own comment (shown pinned separately) and the two featured
  // comments are excluded here so nothing appears twice.
  const filteredComments = useMemo(() => {
    const topLevel = comments.filter(c => !c.parent_id && c.id !== myComment?.id)
    let byFilter = filter === 'all'
      ? topLevel
      : topLevel.filter(c => c.votes?.[0]?.choice === filter)

    if (filter === 'all') {
      const yesSide = topLevel.filter(c => ['yes', 'ly'].includes(c.votes?.[0]?.choice))
      const noSide = topLevel.filter(c => ['no', 'ln'].includes(c.votes?.[0]?.choice))
      const best = (arr) => arr.length ? arr.reduce((a, b) => (b.resonance_count > a.resonance_count ? b : a)) : null
      const featuredIds = new Set([best(yesSide)?.id, best(noSide)?.id].filter(Boolean))
      byFilter = byFilter.filter(c => !featuredIds.has(c.id))
    }

    const sorted = [...byFilter]
    if (sort === 'top') {
      sorted.sort((a, b) => b.resonance_count - a.resonance_count)
    } else if (sort === 'newest') {
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    } else if (sort === 'oldest') {
      sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    }
    return sorted
  }, [comments, filter, sort, myComment])

  // Featured: the single highest-resonance comment from the yes side and
  // from the no side (leaning votes fold into their nearest side, same as
  // the breakdown bar). Only shown on the "All" tab. Your own comment is
  // excluded here too, since it's already pinned separately.
  const { topYesComment, topNoComment } = useMemo(() => {
    const topLevel = comments.filter(c => !c.parent_id && c.id !== myComment?.id)
    const yesSide = topLevel.filter(c => ['yes', 'ly'].includes(c.votes?.[0]?.choice))
    const noSide = topLevel.filter(c => ['no', 'ln'].includes(c.votes?.[0]?.choice))

    const best = (arr) => arr.length
      ? arr.reduce((a, b) => (b.resonance_count > a.resonance_count ? b : a))
      : null

    return { topYesComment: best(yesSide), topNoComment: best(noSide) }
  }, [comments, myComment])

  const showFeatured = filter === 'all' && (topYesComment || topNoComment)

  // Bundled once here so every CommentCard render site below can just
  // spread the same object instead of repeating this long prop list.
  const cardProps = {
    comments, user, canParticipate, userResonances,
    replyingTo, setReplyingTo, replyText, setReplyText,
    editingId, setEditingId, editText, setEditText, submitting,
    toggleResonate, shareComment, flagComment, deleteComment, updateComment, submitComment,
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box', background: '#C7C7CC' }}>
      <Header />
      <div style={{ padding: '14px', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', paddingBottom: '100px', background: '#FFFFFF', borderRadius: '20px', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <button
          onClick={() => navigate(-1)}
          style={{ fontSize: '13px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', padding: 0 }}
        >
          ← back
        </button>
      </div>

      {/* Question */}
      <div style={{ marginBottom: '0.75rem' }}>
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', lineHeight: 1.5, margin: 0 }}>
          {question?.text}
        </h1>
        {userVote && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#6B7280' }}>
            You voted <span style={{ color: VOTE_COLORS[userVote], fontWeight: 700 }}>{VOTE_LABELS[userVote]}</span>
          </div>
        )}
      </div>

      {/* Vote breakdown bar */}
      <VoteBreakdownBar tally={tally} />

      <button
        onClick={() => navigate(`/make-up-my-mind/${questionId}`)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#FFFFFF', border: '1.5px solid #2D3DCA', color: '#2D3DCA', borderRadius: '8px', padding: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif', marginBottom: '0.75rem' }}
      >
        <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#2D3DCA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconNews size={14} color="white" />
        </span>
        Additional Research
      </button>

      <div style={{ borderBottom: '5px solid #E5E7EB', marginBottom: '1rem' }} />

      {/* Comment input — replaced by your own pinned comment once you've posted one */}
      {myComment ? (
        <div style={{ marginBottom: '1rem' }}>
          <CommentCard comment={myComment} pinned {...cardProps} />
        </div>
      ) : (
        <div style={{ marginBottom: '1rem' }}>
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={canParticipate ? 'Share your thoughts...' : 'vote to speak your mind'}
            disabled={!canParticipate}
            rows={3}
            style={{
              width: '100%', border: '1px solid #D1D5DB', borderRadius: '10px',
              padding: '10px', fontSize: '14px', fontFamily: 'Merriweather, serif',
              boxSizing: 'border-box', resize: 'none',
              background: canParticipate ? 'white' : '#F9FAFB',
              color: canParticipate ? '#1A1A1A' : '#9CA3AF',
            }}
          />
          {canParticipate && (
            <button
              onClick={() => submitComment(newComment)}
              disabled={submitting || !newComment.trim()}
              style={{
                marginTop: '8px', padding: '9px 20px', background: '#2D3DCA', color: 'white',
                border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Merriweather, serif',
                opacity: submitting || !newComment.trim() ? 0.5 : 1,
              }}
            >
              {submitting ? 'Posting...' : 'Post'}
            </button>
          )}
        </div>
      )}

      <div style={{ borderBottom: '0.5px solid #E5E7EB', marginBottom: '1rem' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', flex: 1, paddingBottom: '2px' }}>
          {[
            { key: 'all', label: 'All', wash: '#E6F1FB', bold: '#2D3DCA', text: '#0C447C' },
            { key: 'yes', label: 'Yes', wash: '#F4F8EC', bold: VOTE_COLORS.yes, text: VOTE_COLORS.yes },
            { key: 'ly', label: 'LY', wash: '#FBF8E4', bold: VOTE_COLORS.ly, text: '#7a6b0e' },
            { key: 'ln', label: 'LN', wash: '#FBF1E6', bold: VOTE_COLORS.ln, text: VOTE_COLORS.ln },
            { key: 'no', label: 'No', wash: '#FBEAEA', bold: VOTE_COLORS.no, text: VOTE_COLORS.no },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                fontSize: '11px', fontWeight: 500, fontFamily: 'Merriweather, serif', whiteSpace: 'nowrap', flexShrink: 0,
                background: filter === f.key ? f.bold : f.wash,
                color: filter === f.key ? 'white' : f.text,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          style={{ fontSize: '11px', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '5px 8px', fontFamily: 'Merriweather, serif', background: 'white', flexShrink: 0 }}
        >
          <option value="top">Sort: Top</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>

      {/* Featured top comments — one from each side, only on the "All" tab */}
      {showFeatured && (
        <div style={{ marginBottom: '0.75rem' }}>
          {topYesComment && <CommentCard comment={topYesComment} featured {...cardProps} />}
          {topNoComment && <CommentCard comment={topNoComment} featured {...cardProps} />}
        </div>
      )}

      {/* Comments */}
      {filteredComments.length === 0 && !showFeatured && !myComment ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '14px' }}>
          No comments yet. {canParticipate ? 'Be the first to share your thoughts.' : 'Vote to join the conversation.'}
        </div>
      ) : (
        filteredComments.map(comment => (
          <CommentCard key={comment.id} comment={comment} {...cardProps} />
        ))
      )}

        </div>
      </div>
      <BottomNav />
    </div>
  )
}
