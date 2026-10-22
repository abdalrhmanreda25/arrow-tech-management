'use client'

import { useState, type FormEvent } from 'react'
import { updateProfile as updateAuthProfile } from 'firebase/auth'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import PageHeader from '@/components/ui/PageHeader'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import { Avatar, Panel } from '@/components/ui/Bits'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { updateMyProfile } from '@/lib/data/org'
import { auth, firebase } from '@/lib/firebase'
import { friendlyError } from '@/lib/errors'
import { ROLE_LABELS } from '@domain/roles'

export default function ProfilePage() {
  const { user, refresh, resendVerification } = useAuth()
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

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError('Use a PNG, JPEG or WebP image.')
    if (file.size > 2 * 1024 * 1024) return setError('Images can be at most 2 MB.')
    setPending(true)
    setError(null)
    try {
      const r = storageRef(firebase().storage, `users/${user!.uid}/avatar/photo`)
      await uploadBytes(r, file, { contentType: file.type })
      await save({ displayName: name.trim() || user!.displayName, title, photoURL: await getDownloadURL(r) })
      toast.success('Photo updated')
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
              <label className="btn btn-secondary btn-sm">
                Change photo
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
              </label>
            </div>
            <Field label="Display name">{(p) => <input {...p} className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Title" optional hint="For example: Frontend engineer">{(p) => <input {...p} className="input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <div><button className="btn btn-accent" disabled={pending || !name.trim()}>{pending ? 'Saving...' : 'Save'}</button></div>
          </form>
        </Panel>
        <Panel title="Account">
          <dl className="detail-list">
            <div className="value-row"><dt>Email</dt><dd>{user?.email}</dd></div>
            <div className="value-row">
              <dt>Email verified</dt>
              <dd>
                {user?.emailVerified ? 'Yes' : (
                  <button className="text-link" onClick={() => resendVerification().then(() => toast.success('Verification email sent'), toast.error)}>No, send link</button>
                )}
              </dd>
            </div>
          </dl>
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
