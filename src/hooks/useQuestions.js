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
        // Get all published questions
        const { data: allQuestions, error: qError } = await supabase
          .from('questions')
          .select('id, text, category, domain')
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
        const unanswered = allQuestions.filter(q => !votedIds.has(q.id))

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

        // Stratified sampling by category ratio
        const categorized = {}
        questionsWithTallies.forEach(q => {
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

        setQuestions(result)
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