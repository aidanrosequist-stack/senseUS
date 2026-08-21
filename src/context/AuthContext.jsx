import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Single shared auth session for the whole app. Previously every
// component that needed the current user called the useAuth hook
// independently — ProtectedRoute, useAdmin, useNotifications, and half
// a dozen page components each ran their own supabase.auth.getSession()
// call and stood up their own onAuthStateChange listener. Since page
// components mount/unmount on every navigation, that meant a single
// page visit could be running several parallel, redundant session
// lookups for the exact same data, each torn down and rebuilt on the
// next click. This provider runs that logic exactly once, at the top
// of the tree, and every consumer just reads the shared result.
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
