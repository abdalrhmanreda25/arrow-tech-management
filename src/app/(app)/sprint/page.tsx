'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { daysBetween } from '@domain/dates'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Empty, ErrorState, Loading } from '@/components/ui/States'
import SprintFormDialog, { sprintFormValues } from '@/components/sprint/SprintFormDialog'
import PlanningTab from '@/components/sprint/PlanningTab'
import CapacityTab from '@/components/sprint/CapacityTab'
import CeremoniesTab from '@/components/sprint/CeremoniesTab'
import HistoryTab from '@/components/sprint/HistoryTab'
import ReportTab from '@/components/sprint/ReportTab'
import { CompleteSprintDialog, StartSprintDialog } from '@/components/sprint/LifecycleDialogs'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useFetch, useLiveDoc, useLiveQuery } from '@/lib/hooks'
import { orgItem } from '@/lib/data/refs'
import { sprintItemsQuery } from '@/lib/data/items'
import { api } from '@/lib/api'
import { getSprintEvents, updateSprint } from '@/lib/data/sprints'
import { formatDate, todayKey } from '@/lib/format'
import { SPRINT_STATUS_LABEL } from '@/lib/sprint-ui'
import type { Item, Sprint } from '@/lib/types'
import '../../delivery-b.css'

type Tab = 'planning' | 'capacity' | 'ceremonies' | 'history' | 'report'

const TABS: { id: Tab; label: string }[] = [
  { id: 'planning', label: 'Planning' },
  { id: 'capacity', label: 'Capacity' },
  { id: 'ceremonies', label: 'Ceremonies' },
  { id: 'history', label: 'Scope history' },
  { id: 'report', label: 'Report' },
]

const STATUS_BADGE: Record<Sprint['status'], string> = { active: 'badge badge--accent', planned: 'badge badge--info', completed: 'badge badge--success' }

function SprintDetail({ id }: { id: string }) {
  const { user } = useAuth()
  const { orgId, can, projects, projectId, setProjectId } = useOrg()
  const toast = useToaster()
  const uid = user!.uid
  const sprintState = useLiveDoc<Sprint>(() => (orgId ? orgItem(orgId, 'sprints', id) : null), `sprint:${orgId}:${id}`)
  const sprint = sprintState.data
  const items = useLiveQuery<Item>(() => (orgId && sprint ? sprintItemsQuery(orgId, id) : null), `sprint-items:${orgId}:${id}:${Boolean(sprint)}`)
  const [tab, setTab] = useState<Tab>('planning')
  const [wantEvents, setWantEvents] = useState(false)
  const [dialog, setDialog] = useState<'edit' | 'start' | 'complete' | null>(null)

  // Events are read on demand: they feed history and the report only. Every
  // item write that changes them also bumps the item's version, so re-read
  // whenever the sprint's items change.
  const itemsSeen = items.data.map((i) => `${i.id}.${i.version}`).join()
  const events = useFetch(
    orgId && wantEvents && sprint && sprint.status !== 'planned' ? () => getSprintEvents(orgId, id) : null,
    `events:${orgId}:${id}:${wantEvents}:${sprint?.status}:${itemsSeen}`,
  )

  useEffect(() => {
    if (tab === 'history' || tab === 'report') setWantEvents(true)
  }, [tab])

  // Keep the project switcher (and new-item dialog) on this sprint's project.
  useEffect(() => {
    if (sprint && sprint.projectId !== projectId && projects.some((p) => p.id === sprint.projectId)) setProjectId(sprint.projectId)
  }, [sprint, projectId, projects, setProjectId])

  if (!orgId || sprintState.loading) return <Loading />
  if (sprintState.error) return <ErrorState error={sprintState.error} onRetry={() => window.location.reload()} />
  if (!sprint) {
    return <Empty icon="zap" title="Sprint not found" action={<Link className="btn btn-secondary btn-sm" href="/sprints/">All sprints</Link>}>It may have been deleted, or it belongs to another organization.</Empty>
  }

  const canManage = can('sprints.manage')
  const project = projects.find((p) => p.id === sprint.projectId)
  const today = todayKey()
  const left = daysBetween(today, sprint.endDate)
  const carryIds = new Set(sprint.carryover?.itemIds ?? [])
  const pendingCarryover = items.data.filter((i) => carryIds.has(i.id) && i.status !== 'done').length

  return (
    <>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link className="text-link text-link--icon" href="/sprints/"><Icon name="arrowLeft" /> Sprints</Link>
      </p>
      <PageHeader
        title={sprint.name}
        description={`${project?.key ?? ''} · ${formatDate(sprint.startDate)} - ${formatDate(sprint.endDate)}${sprint.status === 'active' ? (left >= 0 ? ` · ${left} day${left === 1 ? '' : 's'} left` : ` · ${-left} day${left === -1 ? '' : 's'} overdue`) : ''}`}
        actions={
          <>
            <span className={STATUS_BADGE[sprint.status]}>{SPRINT_STATUS_LABEL[sprint.status]}</span>
            {canManage && sprint.status !== 'completed' ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('edit')}><Icon name="edit" /> Edit</button>
            ) : null}
            {canManage && sprint.status === 'planned' ? (
              <button type="button" className="btn btn-accent btn-sm" onClick={() => setDialog('start')}><Icon name="zap" /> Start sprint</button>
            ) : null}
            {canManage && sprint.status === 'active' ? (
              <button type="button" className="btn btn-accent btn-sm" onClick={() => setDialog('complete')}><Icon name="checkCircle" /> Complete sprint</button>
            ) : null}
          </>
        }
      />
      {canManage && sprint.status === 'completed' && pendingCarryover > 0 ? (
        <div className="notice notice--warning" role="status" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={16} />
          <div style={{ flex: 1 }}>
            <strong>Carryover did not finish</strong>
            {pendingCarryover} unfinished item{pendingCarryover === 1 ? ' is' : 's are'} still in this completed sprint, probably because the connection dropped.
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => api.finishCarryover({ orgId, sprintId: id }).then((n) => toast.success(`Moved ${n} item${n === 1 ? '' : 's'}`), toast.error)}
          >
            Finish carryover
          </button>
        </div>
      ) : null}
      {sprint.goal ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="target" size={16} />
          <span><strong>Sprint goal</strong>{sprint.goal}</span>
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Sprint sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'planning' ? <PlanningTab orgId={orgId} sprint={sprint} items={items.data} itemsLoading={items.loading} itemsError={items.error} uid={uid} /> : null}
        {tab === 'capacity' ? <CapacityTab orgId={orgId} sprint={sprint} items={items.data} uid={uid} /> : null}
        {tab === 'ceremonies' ? <CeremoniesTab orgId={orgId} sprint={sprint} uid={uid} /> : null}
        {tab === 'history' ? <HistoryTab sprint={sprint} events={events.data} loading={events.loading} error={events.error} onRetry={events.reload} /> : null}
        {tab === 'report' ? <ReportTab orgId={orgId} sprint={sprint} items={items.data} events={events.data} loading={events.loading} error={events.error} onRetry={events.reload} /> : null}
      </div>

      <SprintFormDialog
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
        title={`Edit ${sprint.name}`}
        submitLabel="Save"
        initial={sprintFormValues(sprint)}
        datesLocked={sprint.status !== 'planned'}
        onSubmit={async (v) => {
          await updateSprint(orgId, sprint.id, sprint.status === 'planned' ? v : { name: v.name, goal: v.goal }, uid)
          toast.success('Sprint updated')
        }}
      />
      <StartSprintDialog open={dialog === 'start'} onClose={() => setDialog(null)} sprint={sprint} items={items.data} />
      <CompleteSprintDialog open={dialog === 'complete'} onClose={() => setDialog(null)} sprint={sprint} items={items.data} />
    </>
  )
}

function SprintPageInner() {
  const id = useSearchParams().get('id')
  if (!id) return <Empty icon="zap" title="No sprint selected" action={<Link className="btn btn-secondary btn-sm" href="/sprints/">All sprints</Link>} />
  return <SprintDetail id={id} />
}

export default function SprintPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SprintPageInner />
    </Suspense>
  )
}
