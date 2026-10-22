'use client'

import { useState, type FormEvent } from 'react'
import AuthCard from '@/components/AuthCard'
import Alert from '@/components/ui/Alert'
import Field from '@/components/ui/Field'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { api } from '@/lib/api'
import { friendlyError } from '@/lib/errors'

function VerifyEmail() {
  const { user, resendVerification, refresh, signOut } = useAuth()
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pending, setPending] = useState(false)

  const run = async (fn: () => Promise<void>, ok: string) => {
    setPending(true)
    setStatus(null)
    try {
      await fn()
      setStatus({ type: 'success', text: ok })
    } catch (err) {
      setStatus({ type: 'error', text: friendlyError(err) })
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCard title="Verify your email" subtitle={`We sent a link to ${user?.email}. Open it, then come back here.`}>
      {status ? <Alert type={status.type}>{status.text}</Alert> : null}
      <div className="stack">
        <button className="btn btn-accent btn-block" disabled={pending} onClick={() => run(refresh, 'Checked. If you verified, this page will continue.')}>
          I have verified my email
        </button>
        <button className="btn btn-secondary btn-block" disabled={pending} onClick={() => run(resendVerification, 'A new link is on its way.')}>
          Resend the link
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => signOut()}>
          Use a different account
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>
        A verified email is required to create an organization or accept an invite, so invites cannot be claimed by someone who only typed your address.
      </p>
    </AuthCard>
  )
}

export default function Onboarding() {
  const { user, signOut } = useAuth()
  const { setOrgId } = useOrg()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user?.emailVerified) return <VerifyEmail />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const { orgId } = await api.createOrganization({ name, timeZone })
      setOrgId(orgId)
    } catch (err) {
      setError(friendlyError(err))
      setPending(false)
    }
  }

  return (
    <AuthCard
      title="Set up your organization"
      subtitle="Create a workspace for your company, or open the invite link a teammate sent you."
      footer={
        <>
          Signed in as {user.email}.{' '}
          <button type="button" className="text-link" onClick={() => signOut()}>
            Sign out
          </button>
        </>
      }
    >
      {error ? <Alert type="error">{error}</Alert> : null}
      <form className="stack" onSubmit={submit}>
        <Field label="Organization name" hint="You will be its owner. You can rename it later.">
          {(p) => <input {...p} className="input" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Arrow Tech" />}
        </Field>
        <button className="btn btn-accent btn-block" disabled={pending || name.trim().length < 2}>
          {pending ? 'Creating...' : 'Create organization'}
        </button>
      </form>
    </AuthCard>
  )
}
