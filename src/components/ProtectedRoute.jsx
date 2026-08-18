import { useState, useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [checkingProfile, setCheckingProfile] = useState(true)
  const [hasProfile, setHasProfile] = useState(true)

  useEffect(() => {
    if (!user) {
      setCheckingProfile(false)
      return
    }
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
  }, [user])

  if (loading || checkingProfile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
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