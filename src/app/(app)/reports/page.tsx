'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getDocs } from 'firebase/firestore'
import { buildSprintSeries, carryoverReport, velocityReport, type ReportSprint } from '@domain/reports'
import { points as itemPoints } from '@domain/sprint'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Panel, Points, StatusBadge, TypeIcon } from '@/components/ui/Bits'
import { Empty, ErrorState, InsufficientData, Loading } from '@/components/ui/States'
import ProjectGate from '@/components/ProjectGate'
import { SprintChart, VelocityChart } from '@/components/charts'
import { useOrg } from '@/components/providers/OrgProvider'
import { useFetch } from '@/lib/hooks'
import { chronicCarryoverQuery, getSprintItems } from '@/lib/data/items'
import { completedSprintsQuery, getSprintEvents, sortSprints, sprintsQuery, toDomainEvents } from '@/lib/data/sprints'
import { downloadCsv } from '@/lib/csv'
import { STATUSES } from '@/lib/constants'
import { formatDate, pct, pts } from '@/lib/format'
import type { Item, Project, Sprint } from '@/lib/types'
import '../../delivery-c.css'

const toReportSprint = (s: Sprint): ReportSprint => ({
  id: s.id,
  name: s.name,
  status: s.status,
  startDate: s.startDate,
  endDate: s.endDate,
  completedAt: s.completedAt?.toMillis?.() ?? null,
  // Running sprints carry only their commitment; totals are final once completed.
  stats: s.status === 'completed' ? s.stats ?? null : null,
})

const asSprints = (docs: { id: string; data: () => unknown }[]) => docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Sprint)

function CsvButton({ onClick, disabled, label = 'CSV' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={onClick} disabled={disabled}>
      <Icon name="download" /> {label}
    </button>
  )
}

/** Velocity and carryover share one read of the last 12 completed sprints. */
function HistorySections({ orgId, project }: { orgId: string; project: Project }) {
  const completed = useFetch(async () => asSprints((await getDocs(completedSprintsQuery(orgId, project.id, 12))).docs), `rep-done:${orgId}:${project.id}`)
  const reportSprints = useMemo(() => (completed.data ?? []).map(toReportSprint), [completed.data])
  const velocity = useMemo(() => velocityReport(reportSprints), [reportSprints])
  const carryover = useMemo(() => carryoverReport(reportSprints), [reportSprints])

  const body = (node: React.ReactNode) =>
    completed.loading ? <Loading rows={4} /> : completed.error ? <ErrorState error={completed.error} onRetry={completed.reload} /> : node

  return (
    <>
      <Panel
        title="Velocity"
        actions={
          <CsvButton
            disabled={!velocity.rows.length}
            onClick={() =>
              downloadCsv(`${project.key}-velocity`, [
                { label: 'Sprint', value: (r) => r.name },
                { label: 'Committed points', value: (r) => r.committed },
                { label: 'Completed points', value: (r) => r.completed },
                { label: 'Added points', value: (r) => r.added },
                { label: 'Removed points', value: (r) => r.removed },
                { label: 'Carried over points', value: (r) => r.carriedOver },
                { label: 'Completion rate', value: (r) => (r.completionRate === null ? '' : r.completionRate) },
              ], velocity.rows)
            }
          />
        }
      >
        {body(
          <div className="stack">
            <p className="xsmall subtle">Source: closing totals recorded when each sprint was completed (last 12 completed sprints).</p>
            {velocity.message ? <InsufficientData title={velocity.rows.length ? 'Velocity is still settling' : 'No velocity yet'}>{velocity.message}</InsufficientData> : null}
            {velocity.excluded ? (
              <p className="small muted">
                {velocity.excluded} completed sprint{velocity.excluded === 1 ? ' has' : 's have'} no closing totals (completed before tracking was enabled) and {velocity.excluded === 1 ? 'is' : 'are'} left out.
              </p>
            ) : null}
            {velocity.rows.length ? (
              <>
                <div className="rep-kpis">
                  <div>
                    <div className="subtle xsmall">Average velocity</div>
                    <strong>{velocity.average !== null ? pts(velocity.average) : '-'}</strong>
                    <div className="xsmall subtle">over {velocity.averageOf} sprint{velocity.averageOf === 1 ? '' : 's'}</div>
                  </div>
                  <div>
                    <div className="subtle xsmall">Last sprint completion</div>
                    <strong>{pct(velocity.rows.at(-1)!.completionRate)}</strong>
                    <div className="xsmall subtle">{velocity.rows.at(-1)!.name}</div>
                  </div>
                </div>
                <VelocityChart rows={velocity.rows} average={velocity.average} />
              </>
            ) : null}
          </div>,
        )}
      </Panel>

      <Panel
        title="Carryover"
        className="section-gap"
        actions={
          <CsvButton
            disabled={!carryover.rows.length}
            onClick={() =>
              downloadCsv(`${project.key}-carryover`, [
                { label: 'Sprint', value: (r) => r.name },
                { label: 'Committed points', value: (r) => r.committedPoints },
                { label: 'Carried over items', value: (r) => r.carriedOverCount },
                { label: 'Carried over points', value: (r) => r.carriedOverPoints },
                { label: 'Carryover rate', value: (r) => (r.rate === null ? '' : r.rate) },
              ], carryover.rows)
            }
          />
        }
      >
        {body(
          carryover.sufficient ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sprint</th>
                    <th>Committed</th>
                    <th>Items carried</th>
                    <th>Points carried</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {carryover.rows.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Sprint">
                        <Link className="text-link" href={`/sprint/?id=${r.id}`}>{r.name}</Link>
                      </td>
                      <td data-label="Committed">{pts(r.committedPoints)}</td>
                      <td data-label="Items carried">{r.carriedOverCount}</td>
                      <td data-label="Points carried">{pts(r.carriedOverPoints)}</td>
                      <td data-label="Rate">{pct(r.rate)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th />
                    <th>{carryover.totalCount}</th>
                    <th>{pts(carryover.totalPoints)}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <InsufficientData>{carryover.message}</InsufficientData>
          ),
        )}
        <ChronicCarryover orgId={orgId} project={project} />
      </Panel>
    </>
  )
}

function ChronicCarryover({ orgId, project }: { orgId: string; project: Project }) {
  const chronic = useFetch(
    async () => (await getDocs(chronicCarryoverQuery(orgId, project.id))).docs.map((d) => ({ id: d.id, ...d.data() }) as Item),
    `rep-chronic:${orgId}:${project.id}`,
  )
  return (
    <div className="section-gap">
      <h3 className="rep-subhead">Carried over two or more times</h3>
      {chronic.loading ? (
        <Loading rows={2} />
      ) : chronic.error ? (
        <ErrorState error={chronic.error} onRetry={chronic.reload} />
      ) : !chronic.data?.length ? (
        <p className="small muted">No item has rolled over more than once. Good sign.</p>
      ) : (
        <ul className="item-list">
          {chronic.data.map((i) => (
            <li key={i.id} className="item-row" style={{ gridTemplateColumns: 'auto auto minmax(0,1fr) auto auto' }}>
              <TypeIcon type={i.type} />
              <span className="item-key">{i.key}</span>
              <Link className="item-title truncate" href={`/item/?id=${i.id}`}>{i.title}</Link>
              <span className="badge badge--warning">{i.carryoverCount}x carried</span>
              <StatusBadge status={i.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SprintHistory({ orgId, project, timeZone }: { orgId: string; project: Project; timeZone: string }) {
  const all = useFetch(async () => sortSprints(asSprints((await getDocs(sprintsQuery(orgId, project.id))).docs)), `rep-sprints:${orgId}:${project.id}`)
  const started = useMemo(() => (all.data ?? []).filter((s) => s.status !== 'planned'), [all.data])
  const [sprintId, setSprintId] = useState<string | null>(null)
  const [mode, setMode] = useState<'burndown' | 'burnup'>('burndown')

  useEffect(() => {
    if (!started.length) return
    if (sprintId && started.some((s) => s.id === sprintId)) return
    setSprintId(started[0].id)
  }, [started, sprintId])

  const sprint = started.find((s) => s.id === sprintId) ?? null
  const events = useFetch(sprint ? () => getSprintEvents(orgId, sprint.id) : null, `rep-events:${orgId}:${sprint?.id}`)
  const series = useMemo(
    () => (sprint && events.data ? buildSprintSeries(toReportSprint(sprint), toDomainEvents(events.data), { timeZone }) : null),
    [sprint, events.data, timeZone],
  )

  return (
    <Panel
      title="Sprint burndown and burnup"
      className="section-gap"
      actions={
        <>
          {started.length ? (
            <label>
              <span className="sr-only">Sprint</span>
              <select className="input input--sm" value={sprintId ?? ''} onChange={(e) => setSprintId(e.target.value)}>
                {started.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.status})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <CsvButton
            disabled={!series?.sufficient}
            onClick={() =>
              series &&
              sprint &&
              downloadCsv(`${project.key}-${sprint.name}-daily`, [
                { label: 'Date', value: (p) => p.date },
                { label: 'Ideal remaining', value: (p) => p.ideal },
                { label: 'Remaining', value: (p) => p.remaining },
                { label: 'Completed', value: (p) => p.completed },
                { label: 'Scope', value: (p) => p.scope },
              ], series.points)
            }
          />
        </>
      }
    >
      {all.loading ? (
        <Loading rows={4} />
      ) : all.error ? (
        <ErrorState error={all.error} onRetry={all.reload} />
      ) : !started.length ? (
        <Empty icon="zap" title="No sprint has started yet">
          Burndown and burnup are rebuilt from a sprint&apos;s recorded history, which begins when the sprint starts.
        </Empty>
      ) : events.loading || !series ? (
        events.error ? <ErrorState error={events.error} onRetry={events.reload} /> : <Loading rows={4} />
      ) : !series.sufficient ? (
        <InsufficientData title="History not available for this sprint">{series.reason}</InsufficientData>
      ) : (
        <div className="stack">
          <p className="xsmall subtle">
            Source: {series.eventCount} recorded sprint event{series.eventCount === 1 ? '' : 's'}, day boundaries in {timeZone}.
            {sprint ? ` ${formatDate(sprint.startDate)} - ${formatDate(sprint.endDate)}.` : ''}
          </p>
          {series.warnings.map((w) => (
            <InsufficientData key={w} title="Partial history">{w}</InsufficientData>
          ))}
          <div className="rep-kpis">
            <div><div className="subtle xsmall">Committed</div><strong>{pts(series.committed)}</strong></div>
            <div><div className="subtle xsmall">Added</div><strong className={series.added ? 'delta-up' : ''}>+{series.added}</strong></div>
            <div><div className="subtle xsmall">Removed</div><strong>-{series.removed}</strong></div>
            <div><div className="subtle xsmall">Scope now</div><strong>{pts(series.scope)}</strong></div>
            <div><div className="subtle xsmall">Completed</div><strong>{pts(series.completed)}</strong></div>
          </div>
          <div className="segmented" role="group" aria-label="Chart type">
            <button type="button" aria-pressed={mode === 'burndown'} onClick={() => setMode('burndown')}>Burndown</button>
            <button type="button" aria-pressed={mode === 'burnup'} onClick={() => setMode('burnup')}>Burnup</button>
          </div>
          <SprintChart points={series.points} mode={mode} />
        </div>
      )}
    </Panel>
  )
}

function Distribution({ orgId, project }: { orgId: string; project: Project }) {
  const { memberName } = useOrg()
  const sprintId = project.activeSprintId
  const items = useFetch(sprintId ? () => getSprintItems(orgId, sprintId) : null, `rep-dist:${orgId}:${sprintId}`)
  const counted = (items.data ?? []).filter((i) => i.type !== 'epic')
  const byStatus = STATUSES.map((s) => {
    const list = counted.filter((i) => i.status === s.id)
    return { id: s.id, label: s.label, count: list.length, points: list.reduce((n, i) => n + itemPoints(i), 0) }
  })
  const byAssignee = [...counted.reduce((m, i) => {
    const key = i.assigneeId ?? ''
    const row = m.get(key) ?? { uid: key, count: 0, points: 0, done: 0 }
    row.count += 1
    row.points += itemPoints(i)
    if (i.status === 'done') row.done += itemPoints(i)
    m.set(key, row)
    return m
  }, new Map<string, { uid: string; count: number; points: number; done: number }>()).values()].sort((a, b) => b.points - a.points)
  const total = byStatus.reduce((n, s) => n + s.points, 0)

  return (
    <Panel title="Active sprint work distribution" className="section-gap" actions={sprintId ? <span className="xsmall subtle">Current item state</span> : null}>
      {!sprintId ? (
        <Empty icon="zap" title="No active sprint">Distribution appears while a sprint is running.</Empty>
      ) : items.loading ? (
        <Loading rows={3} />
      ) : items.error ? (
        <ErrorState error={items.error} onRetry={items.reload} />
      ) : !counted.length ? (
        <Empty icon="inbox" title="The active sprint is empty" />
      ) : (
        <div className="grid-2">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Status</th><th>Items</th><th>Points</th><th>Share</th></tr></thead>
              <tbody>
                {byStatus.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Status"><StatusBadge status={s.id} /></td>
                    <td data-label="Items">{s.count}</td>
                    <td data-label="Points">{s.points}</td>
                    <td data-label="Share">{total ? pct(s.points / total) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Assignee</th><th>Items</th><th>Points</th><th>Done</th></tr></thead>
              <tbody>
                {byAssignee.map((r) => (
                  <tr key={r.uid || 'none'}>
                    <td data-label="Assignee">{memberName(r.uid || null)}</td>
                    <td data-label="Items">{r.count}</td>
                    <td data-label="Points"><Points value={r.points} /></td>
                    <td data-label="Done">{r.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

export default function ReportsPage() {
  const { orgId, org } = useOrg()
  return (
    <>
      <PageHeader title="Reports" description="Velocity, burndown, burnup and carryover, computed from recorded sprint history." />
      <ProjectGate>
        {(project) => (
          <>
            <HistorySections orgId={orgId!} project={project} />
            <SprintHistory orgId={orgId!} project={project} timeZone={org?.timeZone || 'UTC'} />
            <Distribution orgId={orgId!} project={project} />
          </>
        )}
      </ProjectGate>
    </>
  )
}
