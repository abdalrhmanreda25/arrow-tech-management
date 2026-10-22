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

function InvitePanel() {
  const { orgId, role } = useOrg()
  const toast = useToaster()
  const invites = useLiveQuery<Invite>(() => (orgId ? pendingInvitesQuery(orgId) : null), `inv:${orgId}`)
  const grantable = ROLES.filter((r) => role && canAssignRole(role, null, r).ok).reverse()
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('member')
  const [link, setLink] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    setLink(null)
    try {
      const { inviteId } = await api.createInvite({ orgId: orgId!, email, role: inviteRole })
      // The invite id is the secret; whoever holds the link and the invited, verified email can join.
      const url = `${window.location.origin}/invite/?org=${encodeURIComponent(orgId!)}&invite=${inviteId}`
      setLink(url)
      setEmail('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Invite link copied')
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.')
    }
  }

  return (
    <Panel title="Invite people">
      <form className="inline-form" onSubmit={submit}>
        <Field label="Email">{(p) => <input {...p} className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Role">
          {(p) => (
            <select {...p} className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
              {grantable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          )}
        </Field>
        <button className="btn btn-accent" disabled={pending || !email}>{pending ? 'Creating...' : 'Create invite'}</button>
      </form>
      {error ? <div style={{ marginTop: 12 }}><Alert type="error">{error}</Alert></div> : null}
      {link ? (
        <div className="notice notice--info" style={{ marginTop: 12 }}>
          <Icon name="mail" size={16} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>Send this link to the invitee. It expires in 7 days and works only for that email address.</strong>
            <input className="input input--sm mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" style={{ marginTop: 6 }} />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>Copy</button>
        </div>
      ) : null}
      <p className="muted small" style={{ marginTop: 12 }}>
        The invitee must sign in with this exact, verified email address. Emails are not sent automatically.
      </p>
      <h3 className="small" style={{ margin: '16px 0 8px' }}>Pending invites</h3>
      {invites.loading ? (
        <Loading rows={2} />
      ) : invites.error ? (
        <ErrorState error={invites.error} />
      ) : invites.data.length === 0 ? (
        <p className="muted small">No pending invites.</p>
      ) : (
        <ul className="item-list">
          {invites.data.map((inv) => (
            <li key={inv.id} className="item-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto auto' }}>
              <span className="truncate">{inv.email}</span>
              <span className="badge">{ROLE_LABELS[inv.role]}</span>
              <span className="subtle xsmall hide-sm">expires {formatDate(inv.expiresAt)}</span>
              <button
                className="btn btn-danger-ghost btn-sm"
                onClick={() => api.revokeInvite({ orgId: orgId!, inviteId: inv.id }).then(() => toast.success('Invite revoked'), toast.error)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
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
        {removable ? (
          <button className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={() => setConfirm(true)}>{self ? 'Leave' : 'Remove'}</button>
        ) : null}
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
          <p>{self ? 'You will lose access to every project in this organization.' : 'They lose access immediately. Items assigned to them keep their assignment.'}</p>
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
      {admin ? <InvitePanel /> : <PermissionNotice>Admins and owners invite people and change roles.</PermissionNotice>}
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
