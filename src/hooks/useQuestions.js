import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const CANDIDATE_BATCH_SIZE = 75

export function useQuestions(userId) {
  const [questions, setQuestions] = useState([])
  const [usingFallbackPool, setUsingFallbackPool] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) return

    async function fetchQuestions() {
      try {
        // Country is needed before calling get_candidate_questions (it
        // uses it to prioritize matching questions), so this one fetch
        // has to happen first rather than in parallel with the rest.
        const { data: profile } = await supabase
          .from('profiles')
          .select('country_code')
          .eq('id', userId)
          .single()

        const userCountry = profile?.country_code || null

        // The database now does the heavy lifting that used to happen
        // here in JS: excluding every question this user has already
        // voted on or skipped (via NOT EXISTS, not by shipping the
        // user's full vote/skip history to the browser to compare), and
        // excluding archived questions. Returns a bounded batch instead
        // of the entire question table — this is what actually stops
        // both the question bank and each user's vote history from
        // making every single feed load slower as both grow over time.
        const { data: candidatesRaw, error: candidatesError } = await supabase
          .rpc('get_candidate_questions', {
            p_user_id: userId,
            p_country_code: userCountry,
            p_limit: CANDIDATE_BATCH_SIZE,
          })

        if (candidatesError) throw candidatesError

        const sponsoredIds = (candidatesRaw || []).filter(q => q.is_sponsored).map(q => q.id)
        const { data: sponsors } = sponsoredIds.length
          ? await supabase
              .from('public_sponsors')
              .select('question_id, sponsor_name')
              .in('question_id', sponsoredIds)
          : { data: [] }
        const sponsorByQuestion = new Map((sponsors || []).map(s => [s.question_id, s.sponsor_name]))

        const candidates = (candidatesRaw || []).map(q => ({
          ...q,
          sponsor_name: sponsorByQuestion.get(q.id) || null,
        }))

        // Everything below here is unchanged from before — it just now
        // runs against the smaller candidate batch instead of every
        // published question, since exclusion (voted/skipped/archived)
        // already happened in the database.
        const matchesUser = q => {
          if (q.geo_scope === 'global' || q.geo_scope === 'country_own') return true
          if (q.geo_scope === 'country' || q.geo_scope === 'regional') {
            return userCountry ? q.country_code === userCountry : true
          }
          return true
        }

        const hasMatch = candidates.some(matchesUser)

        let unanswered
        let usingFallbackPool = false

        if (hasMatch) {
          // Normal case — sprinkle in non-matching country questions at a low rate
          unanswered = candidates.filter(q => {
            if (matchesUser(q)) return true
            return Math.random() < 0.01
          })
        } else {
          // Matching pool is exhausted — show everything remaining rather
          // than leaving the user with an empty feed
          usingFallbackPool = true
          unanswered = candidates
        }

        // Get vote tallies for each question — one batch call instead of
        // one query per question.
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
