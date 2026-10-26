'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Empty, ErrorState, Loading } from '@/components/ui/States'
import { useOrg } from '@/components/providers/OrgProvider'
import { useLiveQuery } from '@/lib/hooks'
import { dueItemsQuery } from '@/lib/data/items'
import { sprintsQuery } from '@/lib/data/sprints'
import { ceremoniesBetweenQuery } from '@/lib/data/activity'
import { addMonths, monthGrid } from '@/lib/calendar'
import { ceremonyLabel } from '@/lib/constants'
import { formatDate, todayKey } from '@/lib/format'
import type { Ceremony, Item, Sprint } from '@/lib/types'
import '../../delivery-c.css'

interface CalEvent {
  id: string
  kind: 'item' | 'done' | 'ceremony' | 'sprint'
  label: string
  href: string
  detail?: string
}

const MAX_CHIPS = 3
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const time = (c: Ceremony) => c.scheduledAt.toDate().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export default function CalendarPage() {
  const { orgId, project, projects } = useOrg()
  const [month, setMonth] = useState(() => todayKey().slice(0, 7) + '-01')
  const [scope, setScope] = useState<'project' | 'all'>('project')
  const [openDay, setOpenDay] = useState<string | null>(null)
  const effectiveScope = project ? scope : 'all'
  const projectId = effectiveScope === 'project' ? project?.id ?? null : null

  const grid = useMemo(() => monthGrid(month), [month])
  const from = grid[0].date
  const to = grid[grid.length - 1].date
  const today = todayKey()

  const items = useLiveQuery<Item>(() => (orgId ? dueItemsQuery(orgId, projectId, from, to) : null), `cal-items:${orgId}:${projectId}:${from}`)
  const sprints = useLiveQuery<Sprint>(() => (orgId && project ? sprintsQuery(orgId, project.id) : null), `cal-sprints:${orgId}:${project?.id}`)
  const ceremonies = useLiveQuery<Ceremony>(
    () => (orgId ? ceremoniesBetweenQuery(orgId, new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59`)) : null),
    `cal-cer:${orgId}:${from}`,
  )

  const activeSprint = sprints.data.find((s) => s.status === 'active') ?? null

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>()
    const push = (day: string, e: CalEvent) => map.set(day, [...(map.get(day) ?? []), e])
    // Members only see projects they are assigned to, so "All projects" means those.
    const visible = new Set(projects.map((p) => p.id))
    for (const s of sprints.data) {
      push(s.startDate, { id: `${s.id}-s`, kind: 'sprint', label: `${s.name} starts`, href: `/sprint/?id=${s.id}` })
      push(s.endDate, { id: `${s.id}-e`, kind: 'sprint', label: `${s.name} ends`, href: `/sprint/?id=${s.id}` })
    }
    for (const c of ceremonies.data) {
      if (projectId ? c.projectId !== projectId : !visible.has(c.projectId)) continue
      push(todayKey(c.scheduledAt.toDate()), {
        id: c.id,
        kind: 'ceremony',
        label: `${time(c)} ${c.title || ceremonyLabel(c.type)}`,
        href: c.sprintId ? `/sprint/?id=${c.sprintId}` : '/sprints/',
        detail: c.status === 'cancelled' ? 'Cancelled' : ceremonyLabel(c.type),
      })
    }
    for (const i of items.data) {
      if (!i.dueDate || !visible.has(i.projectId)) continue
      push(i.dueDate, { id: i.id, kind: i.status === 'done' ? 'done' : 'item', label: `${i.key} ${i.title}`, href: `/item/?id=${i.id}`, detail: i.status === 'done' ? 'Done' : 'Due' })
    }
    return map
  }, [sprints.data, ceremonies.data, items.data, projectId, projects])

  const loading = items.loading || ceremonies.loading || (Boolean(project) && sprints.loading)
  const error = items.error || ceremonies.error || sprints.error
  const agendaDays = grid.filter((d) => d.inMonth && byDay.get(d.date)?.length)
  const monthLabel = new Date(`${month}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const inActiveSprint = (day: string) => Boolean(activeSprint && day >= activeSprint.startDate && day <= activeSprint.endDate)

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Due dates, sprint boundaries and ceremonies."
        actions={
          project ? (
            <div className="segmented" role="group" aria-label="Show">
              <button type="button" aria-pressed={scope === 'project'} onClick={() => setScope('project')}>{project.key}</button>
              <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All projects</button>
            </div>
          ) : null
        }
      />

      <div className="toolbar">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
          <Icon name="chevronLeft" />
        </button>
        <h2 className="cal-title" aria-live="polite">{monthLabel}</h2>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
          <Icon name="chevronRight" />
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMonth(today.slice(0, 7) + '-01')}>Today</button>
        <span className="spacer" />
        <div className="chart-legend">
          <span><i style={{ background: 'var(--info)' }} />Due</span>
          <span><i style={{ background: 'var(--success)' }} />Done</span>
          <span><i style={{ background: 'var(--accent)' }} />Ceremony</span>
          <span><i style={{ background: '#7c3aed' }} />Sprint</span>
        </div>
      </div>

      {error ? (
        <ErrorState error={error} />
      ) : loading ? (
        <Loading rows={6} />
      ) : (
        <>
          <div className="cal cal-grid-view" role="grid" aria-label={monthLabel}>
            {DOW.map((d) => (
              <div key={d} className="cal-dow" role="columnheader">{d}</div>
            ))}
            {grid.map((d) => {
              const events = byDay.get(d.date) ?? []
              const extra = events.length - MAX_CHIPS
              const cls = ['cal-day', d.inMonth ? '' : 'is-outside', d.date === today ? 'is-today' : '', inActiveSprint(d.date) ? 'is-sprint' : '']
              return (
                <div key={d.date} className={cls.filter(Boolean).join(' ')} role="gridcell" aria-label={formatDate(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}>
                  <span className="cal-num">{Number(d.date.slice(8))}</span>
                  {events.slice(0, MAX_CHIPS).map((e) => (
                    <Link key={e.id} href={e.href} className={`cal-chip cal-chip--${e.kind}`} title={e.label}>{e.label}</Link>
                  ))}
                  {extra > 0 ? (
                    <button type="button" className="cal-more text-link" onClick={() => setOpenDay(d.date)}>+{extra} more</button>
                  ) : null}
                </div>
              )
            })}
          </div>
          {activeSprint ? <p className="xsmall subtle" style={{ marginTop: 8 }}>Shaded days fall inside the active sprint, {activeSprint.name}.</p> : null}

          {openDay ? (
            <section className="panel card section-gap" aria-label={`Everything on ${formatDate(openDay)}`}>
              <header className="panel-head">
                <h2 className="panel-title">{formatDate(openDay, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
                <button type="button" className="icon-btn icon-btn--sm" aria-label="Close day" onClick={() => setOpenDay(null)}>
                  <Icon name="close" />
                </button>
              </header>
              <div className="panel-body">
                <DayList events={byDay.get(openDay) ?? []} />
              </div>
            </section>
          ) : null}

          <section className="section-gap" aria-label="Agenda">
            <h2 className="rep-subhead">Agenda for {monthLabel}</h2>
            {!agendaDays.length ? (
              <Empty icon="calendar" title="Nothing scheduled this month">
                Items with a due date, sprints and ceremonies appear here.
              </Empty>
            ) : (
              <ol className="agenda">
                {agendaDays.map((d) => (
                  <li key={d.date}>
                    <div className={`agenda-date ${d.date === today ? 'is-today' : ''}`}>{formatDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                    <DayList events={byDay.get(d.date) ?? []} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </>
  )
}

function DayList({ events }: { events: CalEvent[] }) {
  return (
    <ul className="agenda-events">
      {events.map((e) => (
        <li key={e.id}>
          <Link href={e.href} className={`cal-chip cal-chip--${e.kind}`}>{e.label}</Link>
          {e.detail ? <span className="xsmall subtle">{e.detail}</span> : null}
        </li>
      ))}
    </ul>
  )
}
