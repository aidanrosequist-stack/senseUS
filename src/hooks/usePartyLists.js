import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// migration: 098_party_lists_capacity_submission.sql — party_questions
// (one flat, unnamed, per-user curation list) is replaced by party_lists
// (a user's own named lists) + party_list_questions (each list's own
// curated questions, capped at 10 per list server-side via
// enforce_party_list_questions_cap). Shared here because Explore.jsx and
// Activity.jsx (several tabs' own long-press menus, plus Activity's
// dedicated "?Party" tab) all need the exact same fetch/toggle/cap-error
// logic against these two tables, and duplicating it per file risked the
// two copies drifting.
//
// "Add to ?Party list" used to be an unambiguous single toggle against the
// one flat list everyone had. With multiple named lists, adding a question
// is ambiguous once the user has more than one — isInAnyList/smartToggle
// below keep the OLD single-tap behavior for the common 0-or-1-list case
// (every existing user, until they deliberately make a second list) and
// signal the caller to show a picker only once there's a real choice to
// make. See PartyListPicker.jsx for that picker UI.
export function usePartyLists() {
  const { user } = useAuth()
  const [lists, setLists] = useState([]) // [{ id, name, created_at }]
  const [listQuestionIds, setListQuestionIds] = useState(new Map()) // list_id -> Set<question_id>
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }

    const [{ data: listsData }, { data: lqData }] = await Promise.all([
      supabase.from('party_lists').select('id, name, created_at').eq('user_id', user.id).order('created_at'),
      // No explicit filter needed — RLS ("Users can view own list
      // questions") already scopes this to lists the caller owns.
      supabase.from('party_list_questions').select('list_id, question_id'),
    ])

    setLists(listsData || [])

    const map = new Map()
    for (const row of lqData || []) {
      if (!map.has(row.list_id)) map.set(row.list_id, new Set())
      map.get(row.list_id).add(row.question_id)
    }
    setListQuestionIds(map)
    setLoading(false)
  }, [user])

  useEffect(() => {
    refetch()
  }, [refetch])

  function isInAnyList(questionId) {
    for (const set of listQuestionIds.values()) {
      if (set.has(questionId)) return true
    }
    return false
  }

  function countInList(listId) {
    return listQuestionIds.get(listId)?.size || 0
  }

  async function createList(name) {
    if (!user) return { data: null, error: new Error('Not signed in') }
    const { data, error } = await supabase
      .from('party_lists')
      .insert({ user_id: user.id, name })
      .select('id, name, created_at')
      .single()

    if (!error) setLists(prev => [...prev, data])
    return { data, error }
  }

  async function renameList(listId, name) {
    const { error } = await supabase.from('party_lists').update({ name }).eq('id', listId)
    if (!error) setLists(prev => prev.map(l => (l.id === listId ? { ...l, name } : l)))
    return { error }
  }

  async function deleteList(listId) {
    const { error } = await supabase.from('party_lists').delete().eq('id', listId)
    if (!error) {
      setLists(prev => prev.filter(l => l.id !== listId))
      setListQuestionIds(prev => {
        const m = new Map(prev)
        m.delete(listId)
        return m
      })
    }
    return { error }
  }

  async function addToList(listId, questionId) {
    const { error } = await supabase.from('party_list_questions').insert({ list_id: listId, question_id: questionId })
    if (!error) {
      setListQuestionIds(prev => {
        const m = new Map(prev)
        const s = new Set(m.get(listId) || [])
        s.add(questionId)
        m.set(listId, s)
        return m
      })
    }
    // On a 10/10 list, enforce_party_list_questions_cap raises a plain
    // Postgres exception — error.message is already the right thing to
    // show the user as-is ("You can curate up to 10 questions per list.").
    return { error }
  }

  async function removeFromList(listId, questionId) {
    const { error } = await supabase.from('party_list_questions').delete().eq('list_id', listId).eq('question_id', questionId)
    if (!error) {
      setListQuestionIds(prev => {
        const m = new Map(prev)
        const s = new Set(m.get(listId) || [])
        s.delete(questionId)
        m.set(listId, s)
        return m
      })
    }
    return { error }
  }

  // The single-tap fast path for the long-press "Add/Remove from ?Party
  // list" action everywhere outside the dedicated ?Party tab. Returns
  // { needsPicker: true } instead of acting once there's real ambiguity
  // (2+ lists) — the caller shows PartyListPicker in that case.
  async function smartToggle(questionId) {
    if (lists.length === 0) {
      const { data: newList, error: createError } = await createList('My List')
      if (createError) return { error: createError }
      return addToList(newList.id, questionId)
    }

    if (lists.length === 1) {
      const onlyListId = lists[0].id
      const already = listQuestionIds.get(onlyListId)?.has(questionId)
      return already ? removeFromList(onlyListId, questionId) : addToList(onlyListId, questionId)
    }

    return { needsPicker: true }
  }

  return {
    lists,
    listQuestionIds,
    loading,
    refetch,
    isInAnyList,
    countInList,
    createList,
    renameList,
    deleteList,
    addToList,
    removeFromList,
    smartToggle,
  }
}
