import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useQuestions(userId) {
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) return

    async function fetchQuestions() {
      try {
        // Get user's country code
        const { data: profile } = await supabase
          .from('profiles')
          .select('country_code')
          .eq('id', userId)
          .single()

        const userCountry = profile?.country_code || null

        // Get all published questions
        const { data: allQuestions, error: qError } = await supabase
          .from('questions')
          .select('id, text, category, domain, is_tracking_anchor, geo_scope')
          .not('published_at', 'is', null)
          .lte('published_at', new Date().toISOString())
          .order('created_at', { ascending: false })

        if (qError) throw qError

        // Get questions this user has already voted on
        const { data: userVotes, error: vError } = await supabase
          .from('votes')
          .select('question_id')
          .eq('user_id', userId)

        if (vError) throw vError

        const votedIds = new Set((userVotes || []).map(v => v.question_id))

        // Filter out already-voted questions
        // For country/regional questions that don't match user — only include ~1% of the time
        const unanswered = allQuestions.filter(q => {
          if (votedIds.has(q.id)) return false
          if (q.geo_scope === 'global' || q.geo_scope === 'country_own') return true
          if (q.geo_scope === 'country' || q.geo_scope === 'regional') {
            // We don't have per-question country tag yet so treat all country questions
            // as potentially non-matching — include at 1% rate unless user is in a 
            // country we know the question targets (future improvement)
            // For now: if user has a country, include country questions at 1% rate
            // This is conservative — better to show less than overwhelm with irrelevant questions
            if (!userCountry) return true // no country on profile — show everything
            return Math.random() < 0.01 // 1% chance
          }
          return true
        })

        // Get vote tallies for each question
        const questionsWithTallies = await Promise.all(
          unanswered.map(async (q) => {
            const { data: tally } = await supabase
              .from('votes')
              .select('choice')
              .eq('question_id', q.id)

            const counts = { yes: 0, ly: 0, ln: 0, no: 0 }
            ;(tally || []).forEach(v => {
              if (counts[v.choice] !== undefined) counts[v.choice]++
            })

            return {
              ...q,
              votes: counts,
              replyCount: 0,
            }
          })
        )

        // Separate tracking anchors — they always go first
        const trackingQuestions = questionsWithTallies.filter(q => q.is_tracking_anchor)
        const regularQuestions = questionsWithTallies.filter(q => !q.is_tracking_anchor)

        // Stratified sampling by category ratio (regular questions only)
        const categorized = {}
        regularQuestions.forEach(q => {
          if (!categorized[q.category]) categorized[q.category] = []
          categorized[q.category].push(q)
        })

        // Shuffle within each category
        Object.keys(categorized).forEach(cat => {
          categorized[cat].sort(() => Math.random() - 0.5)
        })

        // Interleave by ratio
        const total = questionsWithTallies.length
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
        setQuestions([...trackingQuestions, ...result])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchQuestions()
  }, [userId])

  return { questions, loading, error }
}