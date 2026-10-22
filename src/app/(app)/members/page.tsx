'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import Icon from '@/components/ui/Icon'
import { Avatar, Panel } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading, PermissionNotice } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveQuery } from '@/lib/hooks'
import { pendingInvitesQuery } from '@/lib/data/org'
import { api } from '@/lib/api'
import { provisionAccount, sendPasswordReset } from '@/lib/provision'
import { friendlyError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { canAssignRole, canRemoveMember, ROLE_LABELS, ROLES } from '@domain/roles'
import type { Invite, Membership, Role } from '@/lib/types'

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including roles of admins and other owners.',
  admin: 'Members, invites, org settings and the audit log.',
  manager: 'Projects, teams, sprint start and completion.',
  member: 'Create and update items, comments and ceremonies.',
  viewer: 'Read-only access.',
}

function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(14)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => alphabet[n % alphabet.length]).join('')
}

function AddMemberPanel() {
  const { orgId, role } = useOrg()
  const toast = useToaster()
  const invites = useLiveQuery<Invite>(() => (orgId ? pendingInvitesQuery(orgId) : null), `inv:${orgId}`)
  const grantable = ROLES.filter((r) => r !== 'owner' && role && canAssignRole(role, null, r).ok).reverse()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('member')
  const [password, setPassword] = useState(tempPassword)
  const [sendReset, setSendReset] = useState(true)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    setCreated(null)
    setLink(null)
    try {
      const res = await provisionAccount({ orgId: orgId!, email, displayName: name, role: newRole, password, sendResetLink: sendReset })
      if (res.status === 'created') {
        setCreated({ email: email.trim().toLowerCase(), password })
        toast.success(`${name.trim()} can now sign in`)
      } else {
        setLink(`${window.location.origin}/invite/?org=${encodeURIComponent(orgId!)}&invite=${res.inviteId}`)
      }
      setName('')
      setEmail('')
      setPassword(tempPassword())
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.')
    }
  }

  return (
    <Panel title="Add team member">
      <form className="stack" onSubmit={submit}>
        <div className="form-grid form-grid--2">
          <Field label="Full name">{(p) => <input {...p} className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Work email">{(p) => <input {...p} className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Role">
            {(p) => (
              <select {...p} className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                {grantable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            )}
          </Field>
          <Field label="Temporary password" hint="At least 8 characters. Share it privately.">
            {(p) => (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input {...p} className="input mono" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPassword(tempPassword())}>New</button>
              </div>
            )}
          </Field>
        </div>
        <label className="row small">
          <input type="checkbox" className="checkbox" checked={sendReset} onChange={(e) => setSendReset(e.target.checked)} />
          Also email them a link to choose their own password
        </label>
        <div><button className="btn btn-accent" disabled={pending || !name.trim() || !email || password.length < 8}>{pending ? 'Creating account...' : 'Create account'}</button></div>
      </form>
      {error ? <div style={{ marginTop: 12 }}><Alert type="error">{error}</Alert></div> : null}
      {created ? (
        <div className="notice notice--info" style={{ marginTop: 12 }}>
          <Icon name="checkCircle" size={16} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>Account ready. Share these sign-in details privately; they are not shown again.</strong>
            <div className="mono small">{created.email} · {created.password}</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(`${window.location.origin}/login/\n${created.email}\n${created.password}`)}>Copy</button>
        </div>
      ) : null}
      {link ? (
        <div className="notice notice--info" style={{ marginTop: 12 }}>
          <Icon name="mail" size={16} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>That email already has an account. Send them this link to join; it expires in 7 days.</strong>
            <input className="input input--sm mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Join link" style={{ marginTop: 6 }} />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(link)}>Copy</button>
        </div>
      ) : null}
      {invites.data.length ? (
        <>
          <h3 className="small" style={{ margin: '16px 0 8px' }}>Pending join links</h3>
          <ul className="item-list">
            {invites.data.map((inv) => (
              <li key={inv.id} className="item-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto auto' }}>
                <span className="truncate">{inv.email}</span>
                <span className="badge">{ROLE_LABELS[inv.role]}</span>
                <span className="subtle xsmall hide-sm">expires {formatDate(inv.expiresAt)}</span>
                <button className="btn btn-danger-ghost btn-sm" onClick={() => api.revokeInvite({ orgId: orgId!, inviteId: inv.id }).then(() => toast.success('Link revoked'), toast.error)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  )
}

function MemberRow({ m }: { m: Membership }) {
  const { user } = useAuth()
  const { orgId, role } = useOrg()
  const toast = useToaster()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const self = m.uid === user?.uid
  const options = ROLES.filter((r) => r === m.role || (role && !self && canAssignRole(role, m.role, r).ok)).reverse()
  const removable = self || (role ? canRemoveMember(role, m.role).ok : false)

  const changeRole = async (next: Role) => {
    setBusy(true)
    try {
      await api.changeMemberRole({ orgId: orgId!, uid: m.uid, role: next })
      toast.success(`${m.displayName} is now ${ROLE_LABELS[next]}`)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.removeMember({ orgId: orgId!, uid: m.uid })
      toast.success(self ? 'You left the organization' : `${m.displayName} was removed`)
      if (self) router.replace('/dashboard/')
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <tr>
      <td data-label="Name">
        <span className="who">
          <Avatar name={m.displayName} uid={m.uid} src={m.photoURL} size={28} />
          <span>
            <span className="cell-primary">{m.displayName}{self ? ' (you)' : ''}</span>
            <span className="cell-secondary">{m.title || m.email}</span>
          </span>
        </span>
      </td>
      <td data-label="Email" className="cell-muted">{m.email}</td>
      <td data-label="Role">
        {options.length > 1 ? (
          <select className="input input--sm" value={m.role} disabled={busy} onChange={(e) => changeRole(e.target.value as Role)} aria-label={`Role for ${m.displayName}`}>
            {options.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        ) : (
          <span className="badge" title={ROLE_HELP[m.role]}>{ROLE_LABELS[m.role]}</span>
        )}
      </td>
      <td data-label="Joined" className="cell-muted">{formatDate(m.joinedAt)}</td>
      <td className="col-actions">
        <div className="cell-actions">
          {!self && role && canRemoveMember(role, m.role).ok ? (
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => sendPasswordReset(m.email).then(() => toast.success(`Password reset email sent to ${m.email}`), toast.error)}
            >
              Reset password
            </button>
          ) : null}
          {removable ? (
            <button className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={() => setConfirm(true)}>{self ? 'Leave' : 'Remove'}</button>
          ) : null}
        </div>
        <Dialog
          open={confirm}
          onClose={() => setConfirm(false)}
          title={self ? 'Leave organization?' : `Remove ${m.displayName}?`}
          dismissible={!busy}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
              <button className="btn btn-danger" onClick={remove} disabled={busy}>{self ? 'Leave' : 'Remove'}</button>
            </>
          }
        >
          <p>{self ? 'You will lose access to every project in this organization.' : 'They lose access to this organization immediately. Their sign-in account still exists but sees nothing here. Items assigned to them keep their assignment.'}</p>
        </Dialog>
      </td>
    </tr>
  )
}

export default function MembersPage() {
  const { members, can, loading, error } = useOrg()
  const admin = can('members.invite')
  return (
    <>
      <PageHeader title="Members" description="Security rules re-check your own role on every change, whatever the page shows." />
      {admin ? <AddMemberPanel /> : <PermissionNotice>Admins and owners add people and change roles.</PermissionNotice>}
      <div className="section-gap">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState error={error} />
        ) : members.length === 0 ? (
          <Empty icon="users" title="No members" />
        ) : (
          <div className="table-scroll card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th className="col-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => <MemberRow key={m.uid} m={m} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Panel title="What each role can do" className="section-gap">
        <table className="chart-table">
          <tbody>
            {[...ROLES].reverse().map((r) => (
              <tr key={r}>
                <th scope="row" style={{ width: 120 }}>{ROLE_LABELS[r]}</th>
                <td className="muted" style={{ textAlign: 'left' }}>{ROLE_HELP[r]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  )
}
