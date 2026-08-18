import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useAdmin() {
  const { user, loading: authLoading } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    
    if (!user) {
      setIsAdmin(false)
      setLoading(false)
      return
    }

    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!error && data?.is_admin === true) {
          setIsAdmin(true)
        } else {
          setIsAdmin(false)
        }
        setLoading(false)
      })
  }, [user, authLoading])

  return { isAdmin, loading }
}