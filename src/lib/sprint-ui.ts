import type { ReportSprint } from '@domain/reports'
import type { SprintEventType } from '@domain/types'
import { addDays, daysBetween } from '@domain/dates'
import type { Sprint } from './types'

export const SPRINT_STATUS_LABEL: Record<Sprint['status'], string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
}

export const EVENT_LABELS: Record<SprintEventType, string> = {
  sprint_started: 'Sprint started',
  item_added: 'Added to sprint',
  item_removed: 'Removed from sprint',
  estimate_changed: 'Estimate changed',
  item_completed: 'Completed',
  item_reopened: 'Reopened',
  sprint_completed: 'Sprint completed',
}

/** The plain shape the report maths expects, with Firestore timestamps as epoch ms. */
export function toReportSprint(s: Sprint): ReportSprint {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    startDate: s.startDate,
    endDate: s.endDate,
    completedAt: s.completedAt?.toMillis?.() ?? null,
    // Running sprints carry only their commitment; totals are final once completed.
    stats: s.status === 'completed' ? s.stats ?? null : null,
  }
}

/** Monday-Friday days in the sprint, the default availability per person. */
export function workingDays(start: string, end: string) {
  let n = 0
  const total = daysBetween(start, end)
  for (let i = 0; i <= total; i += 1) {
    const day = new Date(`${addDays(start, i)}T00:00:00Z`).getUTCDay()
    if (day !== 0 && day !== 6) n += 1
  }
  return n
}

/** "Sprint 4" after "Sprint 3"; falls back to a count when names are custom. */
export function nextSprintName(sprints: Pick<Sprint, 'name'>[]) {
  let max = 0
  for (const s of sprints) {
    const m = /(\d+)\s*$/.exec(s.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `Sprint ${Math.max(max, sprints.length) + 1}`
}

/** Date to the value a datetime-local input expects, in local time. */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
