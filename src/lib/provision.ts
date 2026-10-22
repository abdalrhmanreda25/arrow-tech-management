'use client'

import { deleteApp, initializeApp } from 'firebase/app'
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  initializeAuth,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { connectFirestoreEmulator, doc, getDoc, initializeFirestore, memoryLocalCache, serverTimestamp, writeBatch } from 'firebase/firestore'
import type { Role } from '@domain/types'
import { api } from './api'
import { auth, firebaseConfig, USE_EMULATORS } from './firebase'

export interface NewAccount {
  orgId: string
  email: string
  displayName: string
  role: Role
  password: string
  /** Also email a link so the person can choose their own password. */
  sendResetLink: boolean
}

/**
 * Creates a team account and its membership from an admin's browser, with
 * Firebase client SDK methods only.
 *
 * The new account is created in a second, in-memory Firebase app, so the
 * admin stays signed in. It then joins the org through a single-use invite the
 * admin created a moment earlier: firestore.rules only let it take exactly the
 * invited role, and only for its own email.
 */
export async function provisionAccount(input: NewAccount) {
  const email = input.email.trim().toLowerCase()
  const displayName = input.displayName.trim()
  if (displayName.length < 1 || displayName.length > 80) throw new Error('Enter the person’s name (up to 80 characters).')
  if (input.password.length < 8) throw new Error('Use a temporary password of at least 8 characters.')

  const { inviteId } = await api.createInvite({ orgId: input.orgId, email, role: input.role })

  const app = initializeApp(firebaseConfig, `provision-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  try {
    const secondaryAuth = initializeAuth(app, { persistence: inMemoryPersistence })
    const secondaryDb = initializeFirestore(app, { localCache: memoryLocalCache() })
    if (USE_EMULATORS) {
      connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9095', { disableWarnings: true })
      connectFirestoreEmulator(secondaryDb, '127.0.0.1', 8085)
    }

    let uid: string
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, input.password)
      await updateProfile(cred.user, { displayName })
      uid = cred.user.uid
    } catch (err) {
      if ((err as { code?: string }).code === 'auth/email-already-in-use') {
        // The person already has an account (another org, or an earlier attempt):
        // hand back the invite link instead of a new account.
        return { status: 'existing' as const, inviteId }
      }
      throw err
    }

    const invite = doc(secondaryDb, 'orgs', input.orgId, 'invites', inviteId)
    const snapshot = await getDoc(invite)
    const batch = writeBatch(secondaryDb)
    batch.set(doc(secondaryDb, 'users', uid), { displayName, email, photoURL: null, title: '', createdAt: serverTimestamp() })
    batch.set(doc(secondaryDb, 'orgs', input.orgId, 'members', uid), {
      uid,
      orgId: input.orgId,
      orgName: snapshot.get('orgName') ?? '',
      role: input.role,
      status: 'active',
      email,
      displayName,
      joinedAt: serverTimestamp(),
      inviteId,
      invitedBy: snapshot.get('invitedBy'),
    })
    batch.update(invite, { status: 'accepted', acceptedBy: uid, acceptedAt: serverTimestamp() })
    batch.set(doc(secondaryDb, 'orgs', input.orgId, 'auditLogs', `${inviteId}-joined`), {
      action: 'member.account_created',
      actorId: uid,
      targetType: 'member',
      targetId: uid,
      details: { email, role: input.role, createdBy: snapshot.get('invitedBy') },
      at: serverTimestamp(),
    })
    await batch.commit()
    await signOut(secondaryAuth)

    if (input.sendResetLink) await sendPasswordResetEmail(auth(), email)
    return { status: 'created' as const, uid, inviteId }
  } finally {
    await deleteApp(app)
  }
}

/** Emails a password-reset link; the only reset a client app can trigger for someone else. */
export const sendPasswordReset = (email: string) => sendPasswordResetEmail(auth(), email)
