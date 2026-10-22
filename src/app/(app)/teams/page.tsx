'use client'

import { useState, type FormEvent } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import Icon from '@/components/ui/Icon'
import MemberSelect from '@/components/MemberSelect'
import { Avatar, Panel } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading, PermissionNotice } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveQuery } from '@/lib/hooks'
import { deleteTeam, saveTeam, teamsQuery } from '@/lib/data/org'
import { friendlyError } from '@/lib/errors'
import type { Team } from '@/lib/types'

function TeamDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { user } = useAuth()
  const { orgId, members } = useOrg()
  const toast = useToaster()
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [leadId, setLeadId] = useState<string | null>(team?.leadId ?? null)
  const [memberIds, setMemberIds] = useState<string[]>(team?.memberIds ?? [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (uid: string) => setMemberIds((ids) => (ids.includes(uid) ? ids.filter((i) => i !== uid) : [...ids, uid]))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await saveTeam(orgId!, { id: team?.id, name, description, leadId, memberIds: leadId && !memberIds.includes(leadId) ? [...memberIds, leadId] : memberIds }, user!.uid)
      toast.success('Team saved')
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={team ? `Edit ${team.name}` : 'New team'}
      dismissible={!pending}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="team-form" className="btn btn-accent" disabled={pending || !name.trim()}>{pending ? 'Saving...' : 'Save'}</button>
        </>
      }
    >
      <form id="team-form" className="stack" onSubmit={submit}>
        {error ? <Alert type="error">{error}</Alert> : null}
        <Field label="Name">{(p) => <input {...p} className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Description" optional>{(p) => <input {...p} className="input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <Field label="Lead" optional>{(p) => <MemberSelect {...p} value={leadId} onChange={setLeadId} emptyLabel="No lead" />}</Field>
        <fieldset>
          <legend className="label">Members ({memberIds.length})</legend>
          <div className="check-list">
            {members.map((m) => (
              <label key={m.uid}>
                <input type="checkbox" className="checkbox" checked={memberIds.includes(m.uid)} onChange={() => toggle(m.uid)} />
                <Avatar name={m.displayName} uid={m.uid} src={m.photoURL} size={20} /> {m.displayName}
                <span className="subtle xsmall">{m.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Dialog>
  )
}

export default function TeamsPage() {
  const { user } = useAuth()
  const { orgId, can, memberName, member } = useOrg()
  const toast = useToaster()
  const teams = useLiveQuery<Team>(() => (orgId ? teamsQuery(orgId) : null), `teams:${orgId}`)
  const [editing, setEditing] = useState<Team | 'new' | null>(null)
  const [removing, setRemoving] = useState<Team | null>(null)
  const manage = can('teams.manage')

  return (
    <>
      <PageHeader
        title="Teams"
        description="Group people who plan and deliver together."
        actions={manage ? <button className="btn btn-accent" onClick={() => setEditing('new')}><Icon name="plus" /> New team</button> : null}
      />
      {!manage ? <PermissionNotice>Managers and above create and edit teams.</PermissionNotice> : null}
      <div className="section-gap">
        {teams.loading ? (
          <Loading />
        ) : teams.error ? (
          <ErrorState error={teams.error} />
        ) : teams.data.length === 0 ? (
          <Empty icon="users" title="No teams yet" action={manage ? <button className="btn btn-accent btn-sm" onClick={() => setEditing('new')}>Create a team</button> : null}>
            Teams can be linked to projects and used to see who is on what.
          </Empty>
        ) : (
          <div className="grid-3">
            {teams.data.map((t) => (
              <Panel
                key={t.id}
                title={t.name}
                actions={
                  manage ? (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>Edit</button>
                      <button className="btn btn-danger-ghost btn-sm" onClick={() => setRemoving(t)}>Delete</button>
                    </>
                  ) : null
                }
              >
                {t.description ? <p className="muted small">{t.description}</p> : null}
                <p className="small" style={{ margin: '8px 0' }}>Lead: <strong>{t.leadId ? memberName(t.leadId) : 'None'}</strong></p>
                <div className="stack-sm">
                  {t.memberIds.map((uid) => (
                    <span key={uid} className="who">
                      <Avatar name={memberName(uid)} uid={uid} src={member(uid)?.photoURL} size={20} /> {memberName(uid)}
                    </span>
                  ))}
                  {!t.memberIds.length ? <span className="muted small">No members</span> : null}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
      {editing ? <TeamDialog team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      <Dialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Delete team?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRemoving(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await deleteTeam(orgId!, removing!.id, user!.uid)
                  toast.success('Team deleted')
                } catch (err) {
                  toast.error(err)
                }
                setRemoving(null)
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <p>{removing?.name} will be removed. Its members stay in the organization.</p>
      </Dialog>
    </>
  )
}
