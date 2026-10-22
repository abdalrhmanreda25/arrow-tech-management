'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { addDays } from '@domain/dates'
import PageHeader from '@/components/ui/PageHeader'
import Dialog from '@/components/ui/Dialog'
import Icon from '@/components/ui/Icon'
import { Progress } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading } from '@/components/ui/States'
import ProjectGate from '@/components/ProjectGate'
import SprintFormDialog from '@/components/sprint/SprintFormDialog'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveQuery } from '@/lib/hooks'
import { createSprint, deleteSprint, sortSprints, sprintsQuery } from '@/lib/data/sprints'
import { formatDate, pts, todayKey } from '@/lib/format'
import { nextSprintName, SPRINT_STATUS_LABEL } from '@/lib/sprint-ui'
import type { Project, Sprint } from '@/lib/types'
import '../../delivery-b.css'

const STATUS_BADGE: Record<Sprint['status'], string> = { active: 'badge badge--accent', planned: 'badge badge--info', completed: 'badge badge--success' }

function SprintCard({ sprint, canManage, onDelete }: { sprint: Sprint; canManage: boolean; onDelete: (s: Sprint) => void }) {
  const st = sprint.stats
  return (
    <article className="card sprint-card">
      <div className="stack-sm" style={{ minWidth: 0 }}>
        <div className="row">
          <h3>
            <Link href={`/sprint/?id=${sprint.id}`}>{sprint.name}</Link>
          </h3>
          <span className={STATUS_BADGE[sprint.status]}>{SPRINT_STATUS_LABEL[sprint.status]}</span>
        </div>
        <div className="muted small">
          {formatDate(sprint.startDate)} - {formatDate(sprint.endDate)}
        </div>
        {sprint.goal ? <p className="small truncate">{sprint.goal}</p> : null}
        {st && sprint.status === 'completed' ? <Progress value={st.completedPoints} max={st.scopePoints} label={`${sprint.name} progress`} /> : null}
      </div>
      <div className="row">
        {st ? (
          <div className="sprint-stats">
            <div><span className="subtle xsmall">Committed</span><strong>{pts(st.committedPoints)}</strong></div>
            {sprint.status === 'completed' ? (
              <>
                <div><span className="subtle xsmall">Scope</span><strong>{pts(st.scopePoints)}</strong></div>
                <div><span className="subtle xsmall">Done</span><strong>{pts(st.completedPoints)}</strong></div>
                <div><span className="subtle xsmall">Carried over</span><strong>{pts(st.carriedOverPoints ?? 0)}</strong></div>
              </>
            ) : null}
          </div>
        ) : (
          <span className="muted small">Not started</span>
        )}
        <Link className="btn btn-secondary btn-sm" href={`/sprint/?id=${sprint.id}`}>
          {sprint.status === 'planned' ? 'Plan' : 'Open'}
        </Link>
        {canManage && sprint.status === 'planned' ? (
          <button type="button" className="icon-btn icon-btn--sm" aria-label={`Delete ${sprint.name}`} onClick={() => onDelete(sprint)}>
            <Icon name="trash" />
          </button>
        ) : null}
      </div>
    </article>
  )
}

function SprintsList({ project }: { project: Project }) {
  const { user } = useAuth()
  const { orgId, can } = useOrg()
  const toast = useToaster()
  const list = useLiveQuery<Sprint>(() => (orgId ? sprintsQuery(orgId, project.id) : null), `sprints:${orgId}:${project.id}`)
  const sprints = useMemo(() => sortSprints(list.data), [list.data])
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<Sprint | null>(null)
  const [deleting, setDeleting] = useState(false)
  const canManage = can('sprints.manage')

  const initial = useMemo(() => {
    const latestEnd = sprints.reduce<string | null>((max, s) => (!max || s.endDate > max ? s.endDate : max), null)
    const today = todayKey()
    const start = latestEnd && latestEnd >= today ? addDays(latestEnd, 1) : today
    return { name: nextSprintName(sprints), goal: '', startDate: start, endDate: addDays(start, 13) }
  }, [sprints])

  const groups: { title: string; status: Sprint['status'] }[] = [
    { title: 'Active', status: 'active' },
    { title: 'Planned', status: 'planned' },
    { title: 'Completed', status: 'completed' },
  ]

  const confirmDelete = async () => {
    if (!toDelete || !orgId || !user) return
    setDeleting(true)
    try {
      await deleteSprint(orgId, toDelete.id, user.uid)
      toast.success(`Deleted ${toDelete.name}. Its items are back in the backlog.`)
      setToDelete(null)
    } catch (err) {
      toast.error(err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Sprints"
        description={`${project.name} · plan, run and review time-boxed iterations`}
        actions={
          canManage ? (
            <button type="button" className="btn btn-accent btn-sm" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New sprint
            </button>
          ) : null
        }
      />
      {list.loading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => window.location.reload()} />
      ) : sprints.length === 0 ? (
        <Empty
          icon="zap"
          title="No sprints yet"
          action={canManage ? <button className="btn btn-accent btn-sm" onClick={() => setCreating(true)}>Plan the first sprint</button> : null}
        >
          {canManage ? 'Create a sprint, pull work from the backlog, then start it.' : 'A manager plans sprints. They will appear here.'}
        </Empty>
      ) : (
        groups.map((g) => {
          const items = sprints.filter((s) => s.status === g.status)
          if (!items.length) return null
          return (
            <section key={g.status}>
              <h2 className="sprint-section-title">{g.title} · {items.length}</h2>
              <div className="sprint-list">
                {items.map((s) => <SprintCard key={s.id} sprint={s} canManage={canManage} onDelete={setToDelete} />)}
              </div>
            </section>
          )
        })
      )}

      <SprintFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        title={`New sprint in ${project.key}`}
        submitLabel="Create sprint"
        initial={initial}
        onSubmit={async (v) => {
          if (!orgId || !user) return
          await createSprint(orgId, { projectId: project.id, ...v }, user.uid)
          toast.success(`${v.name} created`)
        }}
      />

      <Dialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title={`Delete ${toDelete?.name ?? 'sprint'}?`}
        dismissible={!deleting}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setToDelete(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete sprint'}
            </button>
          </>
        }
      >
        <p className="small">The sprint is removed and every item planned into it returns to the product backlog. Only planned sprints can be deleted.</p>
      </Dialog>
    </>
  )
}

export default function SprintsPage() {
  return <ProjectGate>{(project) => <SprintsList project={project} />}</ProjectGate>
}
