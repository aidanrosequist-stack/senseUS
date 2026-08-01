import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useQuestions(userId) {
  const [questions, setQuestions] = useState([])
  const [usingFallbackPool, setUsingFallbackPool] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) return

    async function fetchQuestions() {
      try {
        // Profile, questions, votes, and skips are independent of each
        // other — fetch them together instead of one round trip at a time.
        const [
          { data: profile },
          { data: allQuestions, error: qError },
          { data: userVotes, error: vError },
          { data: userSkips, error: sError },
        ] = await Promise.all([
          supabase
            .from('profiles')
            .select('country_code')
            .eq('id', userId)
            .single(),
          supabase
            .from('questions')
            .select('id, text, category, domain, is_tracking_anchor, geo_scope, country_code, question_number')
            .not('published_at', 'is', null)
            .lte('published_at', new Date().toISOString())
            .order('created_at', { ascending: false }),
          supabase
            .from('votes')
            .select('question_id')
            .eq('user_id', userId),
          supabase
            .from('question_skips')
            .select('question_id')
            .eq('user_id', userId),
        ])

        if (qError) throw qError
        if (vError) throw vError
        if (sError) throw sError

        const userCountry = profile?.country_code || null
        const votedIds = new Set((userVotes || []).map(v => v.question_id))
        const skippedIds = new Set((userSkips || []).map(s => s.question_id))

        const isCandidate = q => !votedIds.has(q.id) && !skippedIds.has(q.id) && !q.archived_at
        const matchesUser = q => {
          if (q.geo_scope === 'global' || q.geo_scope === 'country_own') return true
          if (q.geo_scope === 'country' || q.geo_scope === 'regional') {
            return userCountry ? q.country_code === userCountry : true
          }
          return true
        }

        // Does the user have any strictly-matching questions left? .some()
        // exits on the first hit instead of building a full pool array just
        // to check its length.
        const hasMatch = allQuestions.some(q => isCandidate(q) && matchesUser(q))

        let unanswered
        let usingFallbackPool = false

        if (hasMatch) {
          // Normal case — sprinkle in non-matching country questions at a low rate
          unanswered = allQuestions.filter(q => {
            if (!isCandidate(q)) return false
            if (matchesUser(q)) return true
            return Math.random() < 0.01
          })
        } else {
          // Matching pool is exhausted — show everything remaining rather
          // than leaving the user with an empty feed
          usingFallbackPool = true
          unanswered = allQuestions.filter(isCandidate)
        }

        // Get vote tallies for each question — one batch call instead of
        // one query per question (previously N+1: a separate full vote-row
        // fetch for every unanswered question in the feed).
        const questionIds = unanswered.map(q => q.id)
        const { data: tallyRows } = await supabase.rpc('get_vote_tallies_batch', {
          p_question_ids: questionIds,
        })

        const talliesById = {}
        for (const row of tallyRows || []) {
          talliesById[row.question_id] = { yes: row.yes, ly: row.ly, ln: row.ln, no: row.no }
        }

        const questionsWithTallies = unanswered.map(q => ({
          ...q,
          votes: talliesById[q.id] || { yes: 0, ly: 0, ln: 0, no: 0 },
          replyCount: 0,
        }))

        // Separate priority and tracking anchors — they always go first.
        // Single pass instead of three separate filter() calls, each doing
        // an O(n) includes() lookup against the priority list.
        const now = new Date()
        const priorityQuestions = []
        const trackingQuestions = []
        const regularQuestions = []
        for (const q of questionsWithTallies) {
          const isPriority = q.is_priority && (!q.priority_expires_at || new Date(q.priority_expires_at) > now)
          if (isPriority) priorityQuestions.push(q)
          else if (q.is_tracking_anchor) trackingQuestions.push(q)
          else regularQuestions.push(q)
        }

        // Stratified sampling by category ratio (regular questions only)
        const categorized = {}
        regularQuestions.forEach(q => {
          if (!categorized[q.category]) categorized[q.category] = []
          categorized[q.category].push(q)
        })

        // Shuffle within each category (Fisher-Yates — unbiased, unlike sort-by-random)
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

Object.keys(categorized).forEach(cat => {
  shuffle(categorized[cat])
})

        // Interleave by ratio
        const total = regularQuestions.length
        const result = []
        const categories = Object.keys(categorized)

        while (result.length < total) {
          let added = false
          for (const cat of categories) {
            if (categorized[cat].length > 0) {
              result.push(categorized[cat].shift())
              added = true
            }
          }
          if (!added) break
        }

        // Tracking questions first, then stratified regular questions
        setUsingFallbackPool(usingFallbackPool)
        setQuestions([...priorityQuestions, ...trackingQuestions, ...result])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchQuestions()
  }, [userId])

  return { questions, loading, error, usingFallbackPool }
}