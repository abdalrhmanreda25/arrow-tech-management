'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import AuthCard from '@/components/AuthCard'
import Alert from '@/components/ui/Alert'
import { FullPageSpinner } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { api } from '@/lib/api'
import { friendlyError } from '@/lib/errors'
import { ROLE_LABELS } from '@domain/roles'
import type { Role } from '@/lib/types'

interface Preview {
  orgName: string
  role: Role
  email: string
  status: string
  expired: boolean
}

function InviteInner() {
  const params = useSearchParams()
  const router = useRouter()
  const { user, loading, refresh, resendVerification, signOut } = useAuth()
  const orgId = params.get('org') ?? ''
  const inviteId = params.get('invite') ?? ''
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const here = `/invite/?${params.toString()}`

  useEffect(() => {
    if (!user || !orgId || !inviteId) return
    api
      .previewInvite({ orgId, inviteId })
      .then(setPreview)
      .catch((err) => setError(friendlyError(err)))
  }, [user, orgId, inviteId])

  if (loading) return <FullPageSpinner />
  if (!orgId || !inviteId) {
    return <AuthCard title="Invite link incomplete"><Alert type="error">This link is missing parts. Copy the full link from the invite.</Alert></AuthCard>
  }
  if (!user) {
    return (
      <AuthCard title="You have been invited" subtitle="Sign in or create an account with the invited email address to join.">
        <div className="stack">
          <Link className="btn btn-accent btn-block" href={`/signup/?next=${encodeURIComponent(here)}`}>Create account</Link>
          <Link className="btn btn-secondary btn-block" href={`/login/?next=${encodeURIComponent(here)}`}>Sign in</Link>
        </div>
      </AuthCard>
    )
  }

  const accept = async () => {
    setPending(true)
    setError(null)
    try {
      await refresh()
      const res = await api.acceptInvite({ orgId, inviteId })
      try {
        localStorage.setItem('arrow.activeOrg', res.orgId)
      } catch {
        // Falls back to the first org.
      }
      router.replace('/dashboard/')
    } catch (err) {
      setError(friendlyError(err))
      setPending(false)
    }
  }

  return (
    <AuthCard title={preview ? `Join ${preview.orgName}` : 'Checking invite'} subtitle={preview ? `You were invited as ${ROLE_LABELS[preview.role]}.` : undefined}>
      {error ? <Alert type="error">{error}</Alert> : null}
      {!user.emailVerified ? (
        <Alert type="error">
          Verify {user.email} first. <button className="text-link" onClick={() => resendVerification()}>Resend link</button>
        </Alert>
      ) : null}
      {preview?.expired ? <Alert type="error">This invite has expired. Ask an admin for a new one.</Alert> : null}
      <div className="stack">
        <button className="btn btn-accent btn-block" disabled={!preview || pending || preview.expired} onClick={accept}>
          {pending ? 'Joining...' : 'Accept invite'}
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => signOut()}>
          Not {user.email}? Sign out
        </button>
      </div>
    </AuthCard>
  )
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteInner />
    </Suspense>
  )
}
