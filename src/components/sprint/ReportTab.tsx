'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { buildSprintSeries } from '@domain/reports'
import { SprintChart } from '@/components/charts'
import Icon from '@/components/ui/Icon'
import { Panel, Points, Stat, StatusBadge, TypeIcon } from '@/components/ui/Bits'
import { Empty, ErrorState, InsufficientData, Loading } from '@/components/ui/States'
import { useOrg } from '@/components/providers/OrgProvider'
import { useFetch } from '@/lib/hooks'
import { getSnapshot, toDomainEvents } from '@/lib/data/sprints'
import { downloadCsv } from '@/lib/csv'
import { pct, pts } from '@/lib/format'
import { statusLabel, typeLabel } from '@/lib/constants'
import { toReportSprint } from '@/lib/sprint-ui'
import type { SnapshotItem, Sprint, SprintEventDoc } from '@/lib/types'

function SnapshotList({ items }: { items: SnapshotItem[] }) {
  const { memberName } = useOrg()
  if (!items.length) return <p className="muted small">None.</p>
  return (
    <ul className="snapshot-list">
      {items.map((i) => (
        <li key={i.id}>
          <TypeIcon type={i.type} />
          <span className="item-key">{i.key}</span>
          <span className="truncate">
            <Link className="text-link" href={`/item/?id=${i.id}`}>{i.title}</Link>
            <span className="subtle xsmall"> · {i.assigneeId ? memberName(i.assigneeId) : 'Unassigned'}</span>
          </span>
          <Points value={i.storyPoints} />
        </li>
      ))}
    </ul>
  )
}

/** Burndown, burnup and the closing record, all rebuilt from persisted history. */
export default function ReportTab({ orgId, sprint, events, loading, error, onRetry }: { orgId: string; sprint: Sprint; events: SprintEventDoc[] | null; loading: boolean; error: Error | null; onRetry: () => void }) {
  const { org, memberName } = useOrg()
  const series = useMemo(
    () => (events ? buildSprintSeries(toReportSprint(sprint), toDomainEvents(events), { timeZone: org?.timeZone || 'UTC' }) : null),
    [events, sprint, org?.timeZone],
  )
  const snapshots = useFetch(
    sprint.status === 'completed'
      ? async () => {
          const [start, final] = await Promise.all([getSnapshot(orgId, sprint.id, 'start'), getSnapshot(orgId, sprint.id, 'final')])
          return { start, final }
        }
      : null,
    `snap:${orgId}:${sprint.id}:${sprint.status}`,
  )

  if (sprint.status === 'planned') {
    return <Empty icon="chart" title="No report yet">Burndown and burnup appear once the sprint starts.</Empty>
  }
  if (loading) return <Loading />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!series) return null

  const st = sprint.stats
  const final = snapshots.data?.final
  const startIds = new Set((snapshots.data?.start?.items ?? []).map((i) => i.id))
  const deliveredCommitted = (final?.completed ?? []).filter((i) => startIds.has(i.id))
  const deliveredAdded = (final?.completed ?? []).filter((i) => !startIds.has(i.id))

  const exportDaily = () =>
    downloadCsv(`${sprint.name}-daily`, [
      { label: 'Date', value: (p) => p.date },
      { label: 'Remaining', value: (p) => p.remaining },
      { label: 'Ideal', value: (p) => p.ideal },
      { label: 'Completed', value: (p) => p.completed },
      { label: 'Scope', value: (p) => p.scope },
    ], series.points)

  const exportItems = () => {
    if (!final) return
    const rows = [...(final.completed ?? []).map((i) => ({ ...i, outcome: 'Completed' })), ...(final.incomplete ?? []).map((i) => ({ ...i, outcome: 'Carried over' }))]
    downloadCsv(`${sprint.name}-items`, [
      { label: 'Key', value: (r) => r.key },
      { label: 'Title', value: (r) => r.title },
      { label: 'Type', value: (r) => typeLabel(r.type) },
      { label: 'Status at close', value: (r) => statusLabel(r.status) },
      { label: 'Story points', value: (r) => r.storyPoints },
      { label: 'Assignee', value: (r) => (r.assigneeId ? memberName(r.assigneeId) : '') },
      { label: 'In commitment', value: (r) => (startIds.has(r.id) ? 'Yes' : 'No') },
      { label: 'Outcome', value: (r) => r.outcome },
    ], rows)
  }

  return (
    <div className="stack">
      <div className="admin-stats stats-4">
        <Stat label="Committed" value={pts(st?.committedPoints ?? series.committed)} hint={`${st?.committedCount ?? '-'} items at start`} />
        <Stat label="Completed" value={pts(st?.completedPoints ?? series.completed)} hint={st && st.committedPoints > 0 ? `${pct(st.completedPoints / st.committedPoints)} of commitment` : undefined} />
        <Stat label="Scope change" value={`+${series.added} / -${series.removed}`} hint="Points added / removed after start" />
        <Stat label={sprint.status === 'completed' ? 'Carried over' : 'Remaining'} value={pts(sprint.status === 'completed' ? st?.carriedOverPoints ?? 0 : series.scope - series.completed)} hint={sprint.status === 'completed' ? `${st?.carriedOverCount ?? 0} item${st?.carriedOverCount === 1 ? '' : 's'}` : undefined} />
      </div>

      {sprint.status === 'completed' && sprint.historyComplete === false ? (
        <InsufficientData title="Commitment is approximate">This sprint was started without a recorded commitment, so its committed figure is the scope at completion.</InsufficientData>
      ) : null}

      {!series.sufficient ? (
        <InsufficientData>{series.reason}</InsufficientData>
      ) : (
        <>
          {series.warnings.map((w) => (
            <div key={w} className="notice notice--warning" role="status">
              <Icon name="alert" size={16} />
              <span>{w}</span>
            </div>
          ))}
          <div className="grid-2">
            <Panel title="Burndown" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={exportDaily}><Icon name="download" /> CSV</button>}>
              <SprintChart points={series.points} mode="burndown" />
            </Panel>
            <Panel title="Burnup">
              <SprintChart points={series.points} mode="burnup" />
            </Panel>
          </div>
          <p className="xsmall subtle">
            Built from {series.eventCount} recorded event{series.eventCount === 1 ? '' : 's'}, with days in {org?.timeZone || 'UTC'}. Calendar days, weekends included.
          </p>
        </>
      )}

      {sprint.status === 'completed' ? (
        <Panel
          title="Closing record"
          actions={final ? <button type="button" className="btn btn-ghost btn-sm" onClick={exportItems}><Icon name="download" /> Items CSV</button> : null}
        >
          {snapshots.loading ? (
            <Loading rows={3} />
          ) : snapshots.error ? (
            <ErrorState error={snapshots.error} onRetry={snapshots.reload} />
          ) : !final ? (
            <InsufficientData>No closing snapshot exists for this sprint, so its final item list cannot be shown.</InsufficientData>
          ) : (
            <div className="stack">
              <p className="small">
                Unfinished work went to {sprint.carryover?.mode === 'sprint' && sprint.carryover.targetSprintId ? (
                  <Link className="text-link" href={`/sprint/?id=${sprint.carryover.targetSprintId}`}>the next planned sprint</Link>
                ) : (
                  <strong>the product backlog</strong>
                )}
                .
                {snapshots.data?.start ? ` ${deliveredCommitted.length} of ${startIds.size} committed items were delivered; ${deliveredAdded.length} items added mid-sprint were also finished.` : ' No start snapshot exists, so commitment vs delivery cannot be compared item by item.'}
              </p>
              <div className="grid-2">
                <div>
                  <h3 className="small" style={{ marginBottom: 8 }}><StatusBadge status="done" /> Completed · {final.completed?.length ?? 0}</h3>
                  <SnapshotList items={final.completed ?? []} />
                </div>
                <div>
                  <h3 className="small" style={{ marginBottom: 8 }}><span className="badge badge--warning">Carried over</span> · {final.incomplete?.length ?? 0}</h3>
                  <SnapshotList items={final.incomplete ?? []} />
                </div>
              </div>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  )
}

