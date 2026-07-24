import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { IconWaveSine, IconCornerDownRight } from '@tabler/icons-react'
import { checkComment } from '../lib/moderation'

const VOTE_COLORS = {
  yes: '#6d8a1c', ly: '#d9c01a', ln: '#c2731f', no: '#c21f1f', dec: '#2D3DCA'
}

const VOTE_LABELS = {
  yes: 'yes', ly: 'leaning yes', ln: 'leaning no', no: 'no', dec: 'undecided'
}

// Comments are now color-coded by how the commenter voted rather than a
// random per-user hue — a comment's avatar always reflects yes/leaning
// yes/leaning no/no/undecided, same palette as everywhere else on senseUS.
const NEUTRAL_AVATAR_COLOR = '#9CA3AF' // fallback for a comment with no vote on record

const SORT_OPTIONS = [
  { key: 'top', label: 'Top' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
]

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
  const [submitting, setSubmitting] = useState(false)
  const [userResonances, setUserResonances] = useState(new Set())

  const canParticipate = !!userVote

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch question
        const { data: q } = await supabase
          .from('questions')
          .select('id, text, category, question_number')
          .eq('id', questionId)
          .single()
        setQuestion(q)

        // Fetch user's vote on this question
        if (user) {
          const { data: vote } = await supabase
            .from('votes')
            .select('choice')
            .eq('question_id', questionId)
            .eq('user_id', user.id)
            .single()
          setUserVote(vote?.choice || null)
        }

        // Fetch current vote tally for this question, for the breakdown bar.
        // Only yes/ly/ln/no are counted — matches ResultsCard's math,
        // which doesn't include 'dec' (declined) in the yes/no percentage.
        const { data: tallyRow } = await supabase
          .rpc('get_vote_tally', { p_question_id: questionId })
          .single()

        if (tallyRow) {
          setTally({ yes: tallyRow.yes, ly: tallyRow.ly, ln: tallyRow.ln, no: tallyRow.no })
        }

        // Fetch comments with profiles
        const { data: commentsData } = await supabase
          .from('comments')
          .select(`
            id, body, resonance_count, created_at, parent_id, user_id,
            profiles (first_name, last_initial, display_preference, anon_name)
          `)
          .eq('question_id', questionId)
          .eq('is_deleted', false)
          .order('resonance_count', { ascending: false })

        setComments(commentsData || [])

        // Fetch user's resonances
        if (user) {
          const { data: resonances } = await supabase
            .from('comment_resonances')
            .select('comment_id')
            .eq('user_id', user.id)
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
        id, body, resonance_count, created_at, parent_id, user_id,
        profiles (first_name, last_initial, display_preference, anon_name)
      `)
      .single()

    if (!error && data) {
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

  const getReplies = (parentId) => comments.filter(c => c.parent_id === parentId)

  function getVoteColor(comment) {
    const choice = comment.votes?.[0]?.choice
    return VOTE_COLORS[choice] || NEUTRAL_AVATAR_COLOR
  }

  // Top-level comments only, filtered by vote-choice tab, then sorted.
  const filteredComments = useMemo(() => {
    const topLevel = comments.filter(c => !c.parent_id)
    const byFilter = filter === 'all'
      ? topLevel
      : topLevel.filter(c => c.votes?.[0]?.choice === filter)

    const sorted = [...byFilter]
    if (sort === 'top') {
      sorted.sort((a, b) => b.resonance_count - a.resonance_count)
    } else if (sort === 'newest') {
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    } else if (sort === 'oldest') {
      sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    }
    return sorted
  }, [comments, filter, sort])

  // Featured: the single highest-resonance comment from the yes side and
  // from the no side (leaning votes fold into their nearest side, same as
  // the breakdown bar). Only shown on the "All" tab.
  const { topYesComment, topNoComment } = useMemo(() => {
    const topLevel = comments.filter(c => !c.parent_id)
    const yesSide = topLevel.filter(c => ['yes', 'ly'].includes(c.votes?.[0]?.choice))
    const noSide = topLevel.filter(c => ['no', 'ln'].includes(c.votes?.[0]?.choice))

    const best = (arr) => arr.length
      ? arr.reduce((a, b) => (b.resonance_count > a.resonance_count ? b : a))
      : null

    return { topYesComment: best(yesSide), topNoComment: best(noSide) }
  }, [comments])

  const showFeatured = filter === 'all' && (topYesComment || topNoComment)

  function CommentCard({ comment, isReply = false, featured = false }) {
    const displayName = getDisplayName(comment.profiles)
    const voteChoice = comment.votes?.[0]?.choice
    const hasResonated = userResonances.has(comment.id)
    const replies = getReplies(comment.id)
    const avatarColor = getVoteColor(comment)

    return (
      <div style={{ marginLeft: isReply ? '1.5rem' : 0, marginBottom: '12px' }}>
        <div
          style={{
            background: '#FFFFFF',
            border: featured ? `1.5px solid ${avatarColor}` : '0.5px solid #E5E7EB',
            borderRadius: '10px',
            padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            </div>
            <span style={{ fontSize: '10px', color: '#9CA3AF' }}>{timeAgo(comment.created_at)}</span>
          </div>

          <p style={{ fontSize: '14px', color: '#1A1A1A', lineHeight: 1.6, margin: '0 0 10px' }}>
            {comment.body}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={() => comment.user_id !== user?.id && toggleResonate(comment.id)}
              disabled={!canParticipate || comment.user_id === user?.id}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: (canParticipate && comment.user_id !== user?.id) ? 'pointer' : 'default', color: hasResonated ? '#2D3DCA' : '#6B7280', opacity: (canParticipate && comment.user_id !== user?.id) ? 1 : 0.5 }}
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
              {canParticipate && comment.user_id !== user?.id && (
                <button
                  onClick={() => flagComment(comment.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
                  title="Flag this comment"
                >
                  <span style={{ fontSize: '11px', fontFamily: 'Merriweather, serif' }}>⚑</span>
                </button>
              )}
            </div>

            {!isReply && canParticipate && comment.user_id !== user?.id && (
              <button
                onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: '12px', fontFamily: 'Merriweather, serif' }}
              >
                <IconCornerDownRight size={14} />
                {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : 'reply'}
              </button>
            )}

            {comment.user_id === user?.id && (
              <button
                onClick={() => deleteComment(comment.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
                title="Delete this comment"
              >
                <span style={{ fontSize: '11px', fontFamily: 'Merriweather, serif' }}>Delete</span>
              </button>
            )}
          </div>
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
          <CommentCard key={reply.id} comment={reply} isReply />
        ))}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', minHeight: '100dvh', paddingBottom: '100px' }}>

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
      <div style={{ marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '11px', fontWeight: 500, padding: '3px 10px', borderRadius: '20px', background: '#E6F1FB', color: '#0C447C', display: 'inline-block', marginBottom: '6px' }}>
          {question?.category}
        </span>
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

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '0.75rem', overflowX: 'auto', paddingBottom: '4px' }}>
        {['all', 'yes', 'ly', 'ln', 'no'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
              fontSize: '11px', fontWeight: 500, fontFamily: 'Merriweather, serif', whiteSpace: 'nowrap', flexShrink: 0,
              background: filter === f ? (f === 'all' ? '#2D3DCA' : VOTE_COLORS[f]) : '#F3F4F6',
              color: filter === f ? 'white' : '#6B7280',
            }}
          >
            {f === 'all' ? 'All' : VOTE_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Sort control */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>Sort:</span>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setSort(opt.key)}
            style={{
              fontSize: '11px', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'Merriweather, serif',
              color: sort === opt.key ? '#2D3DCA' : '#9CA3AF',
              textDecoration: sort === opt.key ? 'underline' : 'none',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Comment input */}
      <div style={{ marginBottom: '1.5rem' }}>
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

      {/* Featured top comments — one from each side, only on the "All" tab */}
      {showFeatured && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            Top comments
          </div>
          {topYesComment && <CommentCard comment={topYesComment} featured />}
          {topNoComment && <CommentCard comment={topNoComment} featured />}
        </div>
      )}

      {/* Comments */}
      {filteredComments.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '14px' }}>
          No comments yet. {canParticipate ? 'Be the first to share your thoughts.' : 'Vote to join the conversation.'}
        </div>
      ) : (
        filteredComments.map(comment => (
          <CommentCard key={comment.id} comment={comment} />
        ))
      )}

    </div>
  )
}
