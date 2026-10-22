'use client'

import Link from 'next/link'
import { getCountFromServer, getDocs, query, where } from 'firebase/firestore'
import { daysBetween } from '@domain/dates'
import { velocityReport } from '@domain/reports'
import { measure } from '@domain/sprint'
import PageHeader from '@/components/ui/PageHeader'
import { Avatar, Panel, Points, Progress, Stat, StatusBadge, TypeIcon } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useFetch, useLiveDoc, useLiveQuery } from '@/lib/hooks'
import { myItemsQuery, sprintItemsQuery } from '@/lib/data/items'
import { completedSprintsQuery } from '@/lib/data/sprints'
import { orgCol, orgItem } from '@/lib/data/refs'
import { formatDate, pts, todayKey } from '@/lib/format'
import type { Item, Sprint } from '@/lib/types'

function ActiveSprint({ orgId, sprintId }: { orgId: string; sprintId: string | null }) {
  const sprint = useLiveDoc<Sprint>(() => (sprintId ? orgItem(orgId, 'sprints', sprintId) : null), `ds:${orgId}:${sprintId}`)
  // Live totals come from the sprint's items; the sprint doc keeps only the commitment.
  const items = useLiveQuery<Item>(() => (sprintId ? sprintItemsQuery(orgId, sprintId) : null), `dsi:${orgId}:${sprintId}`)
  if (!sprintId) {
    return (
      <Empty icon="zap" title="No active sprint" action={<Link className="btn btn-secondary btn-sm" href="/sprints/">Plan a sprint</Link>}>
        Start a sprint to track its burndown here.
      </Empty>
    )
  }
  if (sprint.loading) return <Loading rows={3} />
  if (sprint.error) return <ErrorState error={sprint.error} />
  const s = sprint.data
  if (!s) return <Empty icon="zap" title="Sprint not found" />
  const st = s.stats
  const now = measure(items.data)
  const left = Math.max(0, daysBetween(todayKey(), s.endDate))
  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <Link className="text-link" href={`/sprint/?id=${s.id}`}><strong>{s.name}</strong></Link>
          <div className="muted small">
            {formatDate(s.startDate)} - {formatDate(s.endDate)} · {left} day{left === 1 ? '' : 's'} left
          </div>
        </div>
        <span className="badge badge--accent">Active</span>
      </div>
      {s.goal ? <p className="small">{s.goal}</p> : null}
      <Progress value={now.completedPoints} max={now.scopePoints} label="Sprint progress" />
      <div className="grid-3 small">
        <div><div className="subtle xsmall">Committed</div><strong>{st ? pts(st.committedPoints) : '-'}</strong></div>
        <div><div className="subtle xsmall">Scope now</div><strong>{pts(now.scopePoints)}</strong></div>
        <div><div className="subtle xsmall">Done</div><strong>{pts(now.completedPoints)}</strong></div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { orgId, org, project, members } = useOrg()
  const uid = user!.uid
  const mine = useLiveQuery<Item>(() => (orgId ? myItemsQuery(orgId, uid) : null), `mine:${orgId}:${uid}`)
  const openMine = mine.data.filter((i) => i.status !== 'done')

  // Aggregation queries cost one read per 1,000 matching index entries, not one per item.
  const counts = useFetch(
    orgId && project
      ? async () => {
          const items = orgCol(orgId, 'items')
          const [open, done] = await Promise.all([
            getCountFromServer(query(items, where('projectId', '==', project.id), where('status', 'in', ['todo', 'in_progress', 'in_review']))),
            getCountFromServer(query(items, where('projectId', '==', project.id), where('status', '==', 'done'))),
          ])
          return { open: open.data().count, done: done.data().count }
        }
      : null,
    `counts:${orgId}:${project?.id}`,
  )

  const history = useFetch(
    orgId && project
      ? async () => {
          const snap = await getDocs(completedSprintsQuery(orgId, project.id, 6))
          return velocityReport(snap.docs.map((d) => ({ id: d.id, ...d.data(), completedAt: d.get('completedAt')?.toMillis?.() }) as never))
        }
      : null,
    `vel:${orgId}:${project?.id}`,
  )

  return (
    <>
      <PageHeader title={`Welcome, ${user?.displayName.split(' ')[0]}`} description={`${org?.name}${project ? ` · ${project.name}` : ''}`} />

      <div className="admin-stats stats-4">
        <Stat label="Open items" value={counts.data ? counts.data.open : '-'} hint={project ? `in ${project.key}` : 'Select a project'} />
        <Stat label="Completed items" value={counts.data ? counts.data.done : '-'} hint={project ? `in ${project.key}` : undefined} />
        <Stat label="Assigned to you" value={mine.loading ? '-' : openMine.length} hint="Not done yet" />
        <Stat
          label="Average velocity"
          value={history.data?.average !== null && history.data?.average !== undefined ? pts(history.data.average) : '-'}
          hint={history.data?.message ?? (history.data ? `Last ${history.data.averageOf} sprints` : undefined)}
        />
      </div>
      {counts.error ? <ErrorState error={counts.error} onRetry={counts.reload} /> : null}

      <div className="grid-2 section-gap">
        <Panel title="Active sprint" actions={<Link className="btn btn-ghost btn-sm" href="/sprints/">All sprints</Link>}>
          {orgId && project ? <ActiveSprint orgId={orgId} sprintId={project.activeSprintId} /> : <Empty icon="briefcase" title="No project selected" />}
        </Panel>

        <Panel title="My work" actions={<span className="muted small">{members.length} members</span>}>
          {mine.loading ? (
            <Loading rows={4} />
          ) : mine.error ? (
            <ErrorState error={mine.error} />
          ) : openMine.length === 0 ? (
            <Empty icon="checkCircle" title="Nothing assigned to you">Items assigned to you across projects appear here.</Empty>
          ) : (
            <ul className="item-list">
              {openMine.slice(0, 10).map((i) => (
                <li key={i.id} className="item-row" style={{ gridTemplateColumns: 'auto auto minmax(0,1fr) auto auto' }}>
                  <TypeIcon type={i.type} />
                  <span className="item-key">{i.key}</span>
                  <Link className="item-title truncate" href={`/item/?id=${i.id}`}>{i.title}</Link>
                  <StatusBadge status={i.status} />
                  <Points value={i.storyPoints} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Team" className="section-gap">
        <div className="row">
          {members.slice(0, 24).map((m) => (
            <span key={m.uid} className="who" title={m.title || m.role}>
              <Avatar name={m.displayName} uid={m.uid} src={m.photoURL} /> {m.displayName}
            </span>
          ))}
        </div>
      </Panel>
    </>
  )
}
