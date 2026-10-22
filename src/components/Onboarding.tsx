'use client'

import { useState, type FormEvent } from 'react'
import AuthCard from '@/components/AuthCard'
import Alert from '@/components/ui/Alert'
import Field from '@/components/ui/Field'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { api } from '@/lib/api'
import { friendlyError } from '@/lib/errors'

export default function Onboarding() {
  const { user, signOut } = useAuth()
  const { setOrgId } = useOrg()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      title="No organization yet"
      subtitle="Team accounts are added by an admin and land in their organization automatically. If you are setting Arrow Tech up for the first time, create the organization here; you will be its owner."
      footer={
        <>
          Signed in as {user?.email}.{' '}
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
