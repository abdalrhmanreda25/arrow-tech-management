'use client'

import { useState, type FormEvent } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import Icon from '@/components/ui/Icon'
import MemberSelect from '@/components/MemberSelect'
import { Avatar } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading, PermissionNotice } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { atLeast } from '@domain/roles'
import { useLiveQuery } from '@/lib/hooks'
import { createProject, normaliseKey, teamsQuery, updateProject, type ProjectInput } from '@/lib/data/org'
import { friendlyError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import type { Project, Team } from '@/lib/types'

const STATUS_LABELS: Record<Project['status'], string> = { planned: 'Planned', active: 'Active', on_hold: 'On hold', completed: 'Completed' }

function ProjectDialog({ open, onClose, project, teams }: { open: boolean; onClose: () => void; project: Project | null; teams: Team[] }) {
  const { user } = useAuth()
  const { orgId, setProjectId, members } = useOrg()
  const toast = useToaster()
  // Managers and above already see every project, so only lower roles are assigned.
  const assignable = members.filter((m) => !atLeast(m.role, 'manager'))
  const [form, setForm] = useState<ProjectInput>(() => ({
    name: project?.name ?? '',
    key: project?.key ?? '',
    description: project?.description ?? '',
    teamId: project?.teamId ?? null,
    leadId: project?.leadId ?? null,
    status: project?.status ?? 'active',
    startDate: project?.startDate ?? '',
    targetDate: project?.targetDate ?? '',
    directMemberIds: project?.directMemberIds ?? project?.memberIds ?? [],
  }))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof ProjectInput>(k: K, v: ProjectInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const picked = form.directMemberIds ?? []
  const viaTeam = teams.find((t) => t.id === form.teamId)?.memberIds ?? []
  const assignedCount = assignable.filter((m) => picked.includes(m.uid) || viaTeam.includes(m.uid)).length
  const toggle = (uid: string) => set('directMemberIds', picked.includes(uid) ? picked.filter((i) => i !== uid) : [...picked, uid])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!orgId || !user) return
    setPending(true)
    setError(null)
    const clean = { ...form, startDate: form.startDate || null, targetDate: form.targetDate || null }
    try {
      if (project) {
        const { key: _key, ...rest } = clean
        void _key
        await updateProject(orgId, project.id, rest, user.uid)
        toast.success('Project saved')
      } else {
        const key = await createProject(orgId, clean, user.uid)
        setProjectId(key)
        toast.success(`Created ${key}`)
      }
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? `Edit ${project.key}` : 'New project'}
      size="lg"
      dismissible={!pending}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" form="project-form" className="btn btn-accent" disabled={pending || !form.name.trim() || (!project && normaliseKey(form.key).length < 2)}>
            {pending ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="project-form" className="form-grid form-grid--2" onSubmit={submit}>
        {error ? <div className="field--full"><Alert type="error">{error}</Alert></div> : null}
        <Field label="Name">
          {(p) => <input {...p} className="input" required maxLength={80} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />}
        </Field>
        <Field label="Key" hint={project ? 'Keys cannot change: item numbers use them.' : 'Prefix for item numbers, e.g. ARW-12.'}>
          {(p) => <input {...p} className="input mono" required disabled={Boolean(project)} value={form.key} onChange={(e) => set('key', normaliseKey(e.target.value))} placeholder="ARW" />}
        </Field>
        <Field label="Description" optional full>
          {(p) => <textarea {...p} className="input" rows={3} maxLength={4000} value={form.description} onChange={(e) => set('description', e.target.value)} />}
        </Field>
        <Field label="Status">
          {(p) => (
            <select {...p} className="input" value={form.status} onChange={(e) => set('status', e.target.value as Project['status'])}>
              {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Team" optional>
          {(p) => (
            <select {...p} className="input" value={form.teamId ?? ''} onChange={(e) => set('teamId', e.target.value || null)}>
              <option value="">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Lead" optional>
          {(p) => <MemberSelect {...p} value={form.leadId ?? null} onChange={(v) => set('leadId', v)} emptyLabel="No lead" />}
        </Field>
        <span />
        <Field label="Start date" optional>
          {(p) => <input {...p} className="input" type="date" value={form.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} />}
        </Field>
        <Field label="Target date" optional>
          {(p) => <input {...p} className="input" type="date" min={form.startDate || undefined} value={form.targetDate ?? ''} onChange={(e) => set('targetDate', e.target.value)} />}
        </Field>
        <fieldset className="field--full">
          <legend className="label">Assigned members ({assignedCount})</legend>
          <p className="xsmall subtle">Members and viewers only see projects they are assigned to, directly or through the project team. Managers and above see every project.</p>
          {assignable.length ? (
            <div className="check-list">
              {assignable.map((m) => (
                <label key={m.uid}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={picked.includes(m.uid) || viaTeam.includes(m.uid)}
                    disabled={viaTeam.includes(m.uid)}
                    onChange={() => toggle(m.uid)}
                  />
                  <Avatar name={m.displayName} uid={m.uid} src={m.photoURL} size={20} /> {m.displayName}
                  <span className="subtle xsmall">{viaTeam.includes(m.uid) ? 'Via team' : m.title}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="small muted">No members or viewers in this organization yet.</p>
          )}
        </fieldset>
      </form>
    </Dialog>
  )
}

export default function ProjectsPage() {
  const { user } = useAuth()
  const { orgId, projects, projectsLoading, error, can, memberName, setProjectId, projectId } = useOrg()
  const toast = useToaster()
  const teams = useLiveQuery<Team>(() => (orgId ? teamsQuery(orgId) : null), `teams:${orgId}`)
  const [editing, setEditing] = useState<Project | null | 'new'>(null)
  const [showArchived, setShowArchived] = useState(false)
  const manage = can('projects.manage')
  const list = projects.filter((p) => showArchived || !p.archived)

  const toggleArchive = async (p: Project) => {
    try {
      await updateProject(orgId!, p.id, { archived: !p.archived }, user!.uid)
      toast.success(p.archived ? 'Project restored' : 'Project archived')
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project has its own backlog, board, sprints and item keys."
        actions={manage ? <button className="btn btn-accent" onClick={() => setEditing('new')}><Icon name="plus" /> New project</button> : null}
      />
      {!manage ? <PermissionNotice>Managers and above create and edit projects.</PermissionNotice> : null}
      <div className="toolbar section-gap">
        <label className="row small">
          <input type="checkbox" className="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      {projectsLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} />
      ) : list.length === 0 ? (
        <Empty icon="briefcase" title="No projects yet" action={manage ? <button className="btn btn-accent btn-sm" onClick={() => setEditing('new')}>Create the first project</button> : null}>
          Projects hold the backlog and sprints for one product or client engagement.
        </Empty>
      ) : (
        <div className="table-scroll card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Status</th>
                <th>Team</th>
                <th>Lead</th>
                <th>Members</th>
                <th>Items</th>
                <th>Target</th>
                <th className="col-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} data-selected={p.id === projectId ? 'true' : undefined}>
                  <td data-label="Key"><span className="mono">{p.key}</span></td>
                  <td data-label="Name">
                    <button className="text-link cell-primary" onClick={() => setProjectId(p.id)} title="Make this the active project">{p.name}</button>
                    {p.archived ? <span className="badge" style={{ marginLeft: 8 }}>Archived</span> : null}
                  </td>
                  <td data-label="Status"><span className="badge">{STATUS_LABELS[p.status]}</span></td>
                  <td data-label="Team" className="cell-muted">{teams.data.find((t) => t.id === p.teamId)?.name ?? '-'}</td>
                  <td data-label="Lead" className="cell-muted">{p.leadId ? memberName(p.leadId) : '-'}</td>
                  <td data-label="Members">{p.memberIds?.length ?? 0}</td>
                  <td data-label="Items">{p.itemSeq}</td>
                  <td data-label="Target" className="cell-muted">{p.targetDate ? formatDate(p.targetDate) : '-'}</td>
                  <td className="col-actions">
                    {manage ? (
                      <div className="cell-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleArchive(p)}>{p.archived ? 'Restore' : 'Archive'}</button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <ProjectDialog open onClose={() => setEditing(null)} project={editing === 'new' ? null : editing} teams={teams.data} /> : null}
    </>
  )
}
