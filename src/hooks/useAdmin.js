import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useAdmin() {
  const { user, loading: authLoading } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  /* eslint-disable react-hooks/set-state-in-effect -- async admin-status check against the database; result genuinely can't be known until the query resolves */
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
  /* eslint-enable react-hooks/set-state-in-effect */

  return { isAdmin, loading }
}