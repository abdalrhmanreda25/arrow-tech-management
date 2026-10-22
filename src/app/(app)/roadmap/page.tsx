'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { getDocs } from 'firebase/firestore'
import { points as itemPoints } from '@domain/sprint'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Progress, TypeIcon } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading } from '@/components/ui/States'
import ProjectGate from '@/components/ProjectGate'
import { useOrg } from '@/components/providers/OrgProvider'
import { useFetch, useLiveQuery } from '@/lib/hooks'
import { epicItemsQuery, epicsQuery } from '@/lib/data/items'
import { sprintsQuery } from '@/lib/data/sprints'
import { addMonths, barPosition, dayOffset, lastDayOfMonth, monthColumns } from '@/lib/calendar'
import { downloadCsv } from '@/lib/csv'
import { formatDate, todayKey } from '@/lib/format'
import type { Item, Project, Sprint } from '@/lib/types'
import '../../delivery-c.css'

const RANGES = [3, 6, 12] as const
/** Progress is loaded for at most this many epics at once to keep reads bounded. */
const MAX_PROGRESS_EPICS = 30

interface EpicProgress {
  total: number
  done: number
  items: number
  doneItems: number
}

const span = (e: Item) => {
  const start = e.startDate || e.targetDate || null
  const end = e.targetDate || e.startDate || null
  return start ? { start, end } : null
}

function Timeline({ orgId, project }: { orgId: string; project: Project }) {
  const [months, setMonths] = useState<(typeof RANGES)[number]>(6)
  const [from, setFrom] = useState(() => addMonths(todayKey().slice(0, 7) + '-01', -1))
  const columns = useMemo(() => monthColumns(from, months), [from, months])
  const rangeStart = columns[0].start
  const rangeEnd = lastDayOfMonth(columns[columns.length - 1].start)
  const today = todayKey()
  const todayAt = dayOffset(today, rangeStart, rangeEnd)

  const epics = useLiveQuery<Item>(() => epicsQuery(orgId, project.id), `rm-epics:${orgId}:${project.id}`)
  const sprints = useLiveQuery<Sprint>(() => sprintsQuery(orgId, project.id), `rm-sprints:${orgId}:${project.id}`)

  const dated = epics.data.filter((e) => span(e))
  const undated = epics.data.filter((e) => !span(e))
  const visible = dated.filter((e) => {
    const s = span(e)!
    return barPosition(s.start, s.end, rangeStart, rangeEnd) !== null
  })
  const progressIds = visible.slice(0, MAX_PROGRESS_EPICS).map((e) => e.id).sort()

  const progress = useFetch(
    progressIds.length
      ? async () => {
          const out: Record<string, EpicProgress> = {}
          await Promise.all(
            progressIds.map(async (id) => {
              const snap = await getDocs(epicItemsQuery(orgId, id))
              const children = snap.docs.map((d) => d.data() as Item)
              out[id] = {
                total: children.reduce((n, c) => n + itemPoints(c), 0),
                done: children.filter((c) => c.status === 'done').reduce((n, c) => n + itemPoints(c), 0),
                items: children.length,
                doneItems: children.filter((c) => c.status === 'done').length,
              }
            }),
          )
          return out
        }
      : null,
    `rm-progress:${orgId}:${progressIds.join(',')}`,
  )

  const progressText = (id: string) => {
    const p = progress.data?.[id]
    if (!p) return progress.loading ? '...' : ''
    if (!p.items) return 'No stories yet'
    return p.total ? `${p.done}/${p.total} pts` : `${p.doneItems}/${p.items} items`
  }

  const exportCsv = () =>
    downloadCsv(`${project.key}-roadmap`, [
      { label: 'Key', value: (e: Item) => e.key },
      { label: 'Epic', value: (e) => e.title },
      { label: 'Status', value: (e) => e.status },
      { label: 'Start date', value: (e) => e.startDate ?? '' },
      { label: 'Target date', value: (e) => e.targetDate ?? '' },
      { label: 'Child items', value: (e) => progress.data?.[e.id]?.items ?? '' },
      { label: 'Done points', value: (e) => progress.data?.[e.id]?.done ?? '' },
      { label: 'Total points', value: (e) => progress.data?.[e.id]?.total ?? '' },
    ], epics.data)

  const sprintBars = sprints.data
    .map((s) => ({ s, pos: barPosition(s.startDate, s.endDate, rangeStart, rangeEnd) }))
    .filter((x) => x.pos)

  const head = { gridTemplateColumns: `var(--rm-label) ${columns.map((c) => `${c.days}fr`).join(' ')}` }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="icon-btn" aria-label="Earlier" onClick={() => setFrom((f) => addMonths(f, -1))}>
          <Icon name="chevronLeft" />
        </button>
        <button type="button" className="icon-btn" aria-label="Later" onClick={() => setFrom((f) => addMonths(f, 1))}>
          <Icon name="chevronRight" />
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFrom(addMonths(today.slice(0, 7) + '-01', -1))}>Today</button>
        <div className="segmented" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={months === r} onClick={() => setMonths(r)}>{r} months</button>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!epics.data.length}>
          <Icon name="download" /> CSV
        </button>
      </div>

      {epics.error || sprints.error ? (
        <ErrorState error={epics.error || sprints.error} />
      ) : epics.loading || sprints.loading ? (
        <Loading rows={5} />
      ) : !epics.data.length && !sprints.data.length ? (
        <Empty icon="map" title="Nothing on the roadmap yet">
          Create an epic with a start and target date, or plan a sprint, and it appears here.
        </Empty>
      ) : (
        <div className="roadmap">
          <div className="roadmap-grid rm">
            <div className="roadmap-head" style={head}>
              <div className="rm-corner">{formatDate(rangeStart, { month: 'short', year: 'numeric' })} - {formatDate(rangeEnd, { month: 'short', year: 'numeric' })}</div>
              {columns.map((c) => (
                <div key={c.key}>{formatDate(c.start, { month: 'short', year: months === 12 ? '2-digit' : undefined })}</div>
              ))}
            </div>

            <div className="roadmap-row">
              <div className="roadmap-label"><Icon name="zap" /> <strong>Sprints</strong></div>
              <div className="roadmap-track">
                {todayAt !== null ? <span className="roadmap-today" style={{ left: `${todayAt}%` }} /> : null}
                {sprintBars.map(({ s, pos }) => (
                  <Link key={s.id} href={`/sprint/?id=${s.id}`} className="roadmap-bar is-sprint" style={{ left: `${pos!.left}%`, width: `${pos!.width}%` }} title={`${s.name}: ${formatDate(s.startDate)} - ${formatDate(s.endDate)} (${s.status})`}>
                    {s.name}
                  </Link>
                ))}
                {!sprintBars.length ? <span className="rm-empty xsmall subtle">No sprints in this range</span> : null}
              </div>
            </div>

            {dated.map((e) => {
              const s = span(e)!
              const pos = barPosition(s.start, s.end, rangeStart, rangeEnd)
              const p = progress.data?.[e.id]
              return (
                <div key={e.id} className="roadmap-row">
                  <div className="roadmap-label">
                    <TypeIcon type="epic" />
                    <div className="truncate">
                      <Link className="text-link truncate" href={`/item/?id=${e.id}`}>{e.title}</Link>
                      <div className="xsmall subtle">
                        <span className="item-key">{e.key}</span> {formatDate(s.start, { month: 'short', day: 'numeric' })} - {formatDate(s.end, { month: 'short', day: 'numeric' })}
                      </div>
                      {p && p.items ? <Progress value={p.total ? p.done : p.doneItems} max={p.total || p.items} label={`${e.key} progress`} /> : null}
                    </div>
                  </div>
                  <div className="roadmap-track">
                    {todayAt !== null ? <span className="roadmap-today" style={{ left: `${todayAt}%` }} /> : null}
                    {pos ? (
                      <Link href={`/item/?id=${e.id}`} className={`roadmap-bar ${e.status === 'done' ? 'is-done' : ''}`} style={{ left: `${pos.left}%`, width: `${pos.width}%` }} title={`${e.key} ${e.title}`}>
                        {e.key} {progressText(e.id)}
                      </Link>
                    ) : (
                      <span className="rm-empty xsmall subtle">{s.end && s.end < rangeStart ? 'Earlier' : 'Later'} than this range</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {visible.length > MAX_PROGRESS_EPICS ? (
        <p className="xsmall subtle" style={{ marginTop: 8 }}>Progress is shown for the first {MAX_PROGRESS_EPICS} visible epics. Narrow the range to see the rest.</p>
      ) : null}
      {progress.error ? <ErrorState error={progress.error} onRetry={progress.reload} title="Could not load epic progress" /> : null}

      {undated.length ? (
        <section className="panel card section-gap">
          <header className="panel-head">
            <h2 className="panel-title">Epics without dates</h2>
          </header>
          <div className="panel-body stack-sm">
            <p className="small muted">Add a start or target date on the epic to place it on the timeline.</p>
            <ul className="item-list">
              {undated.map((e) => (
                <li key={e.id} className="item-row" style={{ gridTemplateColumns: 'auto auto minmax(0,1fr) auto' }}>
                  <TypeIcon type="epic" />
                  <span className="item-key">{e.key}</span>
                  <Link className="item-title truncate" href={`/item/?id=${e.id}`}>{e.title}</Link>
                  <Link className="btn btn-ghost btn-sm" href={`/item/?id=${e.id}`}>Add dates</Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </>
  )
}

export default function RoadmapPage() {
  const { orgId } = useOrg()
  return (
    <>
      <PageHeader title="Roadmap" description="Epics and sprints on a timeline. Progress counts story points of each epic's child items." />
      <ProjectGate>{(project) => <Timeline orgId={orgId!} project={project} />}</ProjectGate>
    </>
  )
}
