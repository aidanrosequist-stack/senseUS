import { useState, useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import LoadingSpinner from './ui/LoadingSpinner'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [checkingProfile, setCheckingProfile] = useState(true)
  const [hasProfile, setHasProfile] = useState(true)

  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- early-out before the async check ever runs
      setCheckingProfile(false)
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate: starting a loading flag before an async profile check, not synchronous derived state
    setCheckingProfile(true)
    supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setHasProfile(!!data)
        setCheckingProfile(false)
      })
    // Depend on user.id (a stable string), not the user object itself.
    // Supabase fires a TOKEN_REFRESHED auth event roughly hourly for
    // every open session, and each one hands back a freshly-deserialized
    // session/user object — same logged-in user, new object reference.
    // Depending on the object would make this effect (and its profiles
    // query) re-run on every one of those refreshes, not just on an
    // actual sign-in/sign-out/account switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user.id, not the user object, is the real dependency (see comment above)
  }, [user?.id])

  if (loading || checkingProfile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        <LoadingSpinner />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (!hasProfile) {
    return <Navigate to="/register" replace />
  }

  return children
}