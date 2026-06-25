import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let mounted = true

    // Apply a session+user atomically so the route guard never sees a stale
    // "loading=false, user=null" frame while Supabase is still hydrating.
    const applySession = (nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
    }

    // 1) Resolve the initial session from storage first.
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return
      applySession(initialSession)
      // 2) Only mark loading=false after both getSession() AND the first
      //    onAuthStateChange('INITIAL_SESSION') event have fired. This avoids
      //    the race where getSession resolves with null because the storage
      //    adapter hasn't hydrated yet, the guard redirects to /login, and
      //    then the real session arrives.
      setLoading(false)
    })

    // 3) onAuthStateChange also fires 'INITIAL_SESSION' once storage is ready —
    //    we treat that as the authoritative "ready to render" signal too.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!mounted) return
        applySession(nextSession)
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          setLoading(false)
        }
      }
    )

    // Safety net: if neither callback resolves within 2s, stop showing the
    // loader so the user is never stuck on a blank screen.
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false)
    }, 2000)

    return () => {
      mounted = false
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  const signUp = async (email, password, metadata = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    })
    return { data, error }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const resetPassword = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { data, error }
  }

  const updatePassword = async (newPassword) => {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    return { data, error }
  }

  const updateProfile = async (updates) => {
    const { data, error } = await supabase.auth.updateUser({
      data: updates,
    })
    return { data, error }
  }

  const value = {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    updateProfile,
    isAuthenticated: !!user,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
