'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  EmailAuthProvider,
  onIdTokenChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updatePassword,
  type User,
} from 'firebase/auth'
import { auth, initAnalytics } from '@/lib/firebase'
import { ensureProfile } from '@/lib/data/org'

export interface Identity {
  uid: string
  email: string
  displayName: string
  photoURL: string | null
  emailVerified: boolean
}

interface AuthValue {
  user: Identity | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  /** Firebase requires the current password again before changing it. */
  changePassword: (current: string, next: string) => Promise<void>
  /** Reloads the account and forces a fresh ID token, so a just-verified email reaches the security rules. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

const toIdentity = (u: User): Identity => ({
  uid: u.uid,
  email: (u.email ?? '').toLowerCase(),
  displayName: u.displayName || (u.email ?? '').split('@')[0] || 'User',
  photoURL: u.photoURL,
  emailVerified: u.emailVerified,
})

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Identity | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    initAnalytics()
    return onIdTokenChanged(auth(), (u) => {
      setUser(u ? toIdentity(u) : null)
      setLoading(false)
      if (u) ensureProfile(u).catch((err) => console.warn('[auth] profile bootstrap failed', err?.code))
    })
  }, [])

  const refresh = useCallback(async () => {
    const current = auth().currentUser
    if (!current) return
    await current.reload()
    await current.getIdToken(true)
    setUser(toIdentity(current))
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth(), email.trim(), password)
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(auth(), email.trim())
      },
      async changePassword(current, next) {
        const u = auth().currentUser
        if (!u?.email) throw new Error('You are signed out.')
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current))
        await updatePassword(u, next)
      },
      refresh,
      async signOut() {
        await fbSignOut(auth())
        try {
          sessionStorage.clear()
        } catch {
          // Nothing cached to clear.
        }
      },
    }),
    [user, loading, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
