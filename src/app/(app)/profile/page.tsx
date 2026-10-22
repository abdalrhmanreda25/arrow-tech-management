'use client'

import { useState, type FormEvent } from 'react'
import { updateProfile as updateAuthProfile } from 'firebase/auth'
import PageHeader from '@/components/ui/PageHeader'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import { Avatar, Panel } from '@/components/ui/Bits'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { updateMyProfile } from '@/lib/data/org'
import { auth } from '@/lib/firebase'
import { friendlyError } from '@/lib/errors'
import { ROLE_LABELS } from '@domain/roles'

function PasswordForm({ onChange }: { onChange: (current: string, next: string) => Promise<void> }) {
  const toast = useToaster()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 8) return setError('Use at least 8 characters.')
    setPending(true)
    setError(null)
    try {
      await onChange(current, next)
      setCurrent('')
      setNext('')
      toast.success('Password changed')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ marginTop: 16 }}>
      <h3 className="small">Change password</h3>
      <p className="muted small">If an admin created your account, replace the temporary password here.</p>
      {error ? <Alert type="error">{error}</Alert> : null}
      <Field label="Current password">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
      <Field label="New password" hint="At least 8 characters.">{(p) => <input {...p} className="input" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
      <div><button className="btn btn-secondary" disabled={pending || !current || !next}>{pending ? 'Saving...' : 'Change password'}</button></div>
    </form>
  )
}

export default function ProfilePage() {
  const { user, refresh, changePassword } = useAuth()
  const { memberships, member } = useOrg()
  const toast = useToaster()
  const me = member(user?.uid)
  const [name, setName] = useState(me?.displayName ?? user?.displayName ?? '')
  const [title, setTitle] = useState(me?.title ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: { displayName: string; title?: string; photoURL?: string | null }) => {
    await updateMyProfile(user!.uid, memberships, patch)
    const current = auth().currentUser
    if (current) await updateAuthProfile(current, { displayName: patch.displayName, ...(patch.photoURL !== undefined ? { photoURL: patch.photoURL } : {}) })
    await refresh()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await save({ displayName: name.trim(), title: title.trim() })
      toast.success('Profile saved')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <PageHeader title="Profile" description="Your name and title are shown to teammates in every organization you belong to." />
      <div className="grid-2">
        <Panel title="Your details">
          <form className="stack" onSubmit={submit}>
            {error ? <Alert type="error">{error}</Alert> : null}
            <div className="row">
              <Avatar name={name || user?.displayName || ''} uid={user?.uid} src={user?.photoURL} size={56} />
            </div>
            <Field label="Display name">{(p) => <input {...p} className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Title" optional hint="For example: Frontend engineer">{(p) => <input {...p} className="input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <div><button className="btn btn-accent" disabled={pending || !name.trim()}>{pending ? 'Saving...' : 'Save'}</button></div>
          </form>
        </Panel>
        <Panel title="Account">
          <dl className="detail-list">
            <div className="value-row"><dt>Email</dt><dd>{user?.email}</dd></div>
          </dl>
          <PasswordForm onChange={changePassword} />
          <h3 className="small" style={{ margin: '16px 0 8px' }}>Organizations</h3>
          <ul className="stack-sm">
            {memberships.map((m) => (
              <li key={m.orgId} className="row-between small">
                <span>{m.orgName}</span>
                <span className="badge">{ROLE_LABELS[m.role]}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  )
}
