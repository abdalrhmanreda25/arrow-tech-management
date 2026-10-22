import { addDays, daysBetween, dayKey, eachDay } from './dates'
import type { SprintEvent, SprintStats, SprintStatus } from './types'

export interface ReportSprint {
  id?: string
  name?: string
  status: SprintStatus
  startDate: string
  endDate: string
  completedAt?: number | null
  stats?: SprintStats | null
}

export interface SeriesPoint {
  date: string
  /** Ideal remaining work for a straight-line burndown. */
  ideal: number
  /** null for days that have not happened yet. */
  remaining: number | null
  scope: number | null
  completed: number | null
}

export interface SprintSeries {
  sufficient: boolean
  reason?: string
  warnings: string[]
  points: SeriesPoint[]
  committed: number
  scope: number
  completed: number
  added: number
  removed: number
  eventCount: number
}

const EMPTY = { warnings: [], points: [], committed: 0, scope: 0, completed: 0, added: 0, removed: 0, eventCount: 0 }

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Rebuilds a sprint's burndown and burnup from its persisted event history.
 * Values are the state at the end of each day in `timeZone`. Nothing is
 * interpolated: if the history is missing, the result says so instead of
 * drawing a line from current totals.
 */
export function buildSprintSeries(
  sprint: ReportSprint,
  events: SprintEvent[],
  { now = Date.now(), timeZone = 'UTC' }: { now?: number; timeZone?: string } = {},
): SprintSeries {
  if (sprint.status === 'planned') {
    return { ...EMPTY, sufficient: false, reason: 'This sprint has not started, so it has no history yet.' }
  }
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const start = sorted.find((e) => e.type === 'sprint_started')
  if (!start) {
    return {
      ...EMPTY,
      eventCount: events.length,
      sufficient: false,
      reason:
        'No start record exists for this sprint, so it was started before history tracking was enabled. ' +
        'Burndown and burnup cannot be reconstructed.',
    }
  }

  let scope = start.scopeAfter ?? start.scopeDelta
  let completed = start.completedAfter ?? start.completedDelta
  const committed = scope
  const initialRemaining = Math.max(0, committed - completed)
  let added = 0
  let removed = 0

  const today = dayKey(now, timeZone)
  const lastActual =
    sprint.status === 'completed' && sprint.completedAt ? dayKey(sprint.completedAt, timeZone) : today
  const lastDay = lastActual > sprint.endDate ? lastActual : sprint.endDate
  const days = eachDay(sprint.startDate, lastDay)
  const length = Math.max(0, daysBetween(sprint.startDate, sprint.endDate))

  const changes = sorted.filter((e) => e !== start && e.at >= start.at && e.type !== 'sprint_completed')
  let cursor = 0
  const points: SeriesPoint[] = days.map((date, i) => {
    const ideal = date > sprint.endDate || length === 0 ? 0 : round(initialRemaining * (1 - i / length))
    if (date > lastActual) return { date, ideal, remaining: null, scope: null, completed: null }
    while (cursor < changes.length && dayKey(changes[cursor].at, timeZone) <= date) {
      const e = changes[cursor]
      scope += e.scopeDelta
      completed += e.completedDelta
      if (e.type === 'item_added' || (e.type === 'estimate_changed' && e.scopeDelta > 0)) added += e.scopeDelta
      if (e.type === 'item_removed' || (e.type === 'estimate_changed' && e.scopeDelta < 0)) removed -= e.scopeDelta
      cursor += 1
    }
    return { date, ideal, remaining: round(scope - completed), scope: round(scope), completed: round(completed) }
  })

  const warnings: string[] = []
  if (sprint.stats && (round(sprint.stats.scopePoints) !== round(scope) || round(sprint.stats.completedPoints) !== round(completed))) {
    warnings.push(
      `Recorded history ends at ${round(scope)} scope / ${round(completed)} done points, but the sprint totals are ` +
        `${round(sprint.stats.scopePoints)} / ${round(sprint.stats.completedPoints)}. Some changes were not captured.`,
    )
  }
  if (days.length && days[0] > lastActual) warnings.push('The sprint start date is in the future; no days have elapsed yet.')

  return {
    sufficient: true,
    warnings,
    points,
    committed: round(committed),
    scope: round(scope),
    completed: round(completed),
    added: round(added),
    removed: round(removed),
    eventCount: events.length,
  }
}

export interface VelocityRow {
  id?: string
  name?: string
  committed: number
  completed: number
  carriedOver: number
  added: number
  removed: number
  /** completed / committed, null when nothing was committed. */
  completionRate: number | null
}

export interface VelocityReport {
  rows: VelocityRow[]
  average: number | null
  averageOf: number
  sufficient: boolean
  message: string | null
  excluded: number
}

/** Sprints the average is taken over. */
export const VELOCITY_WINDOW = 3

/**
 * Velocity per completed sprint (oldest first) and the rolling average of the
 * last three. Sprints without closing stats are excluded and counted.
 */
export function velocityReport(sprints: ReportSprint[]): VelocityReport {
  const done = sprints.filter((s) => s.status === 'completed')
  const usable = done
    .filter((s) => s.stats)
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
  const rows = usable.map((s) => {
    const st = s.stats!
    return {
      id: s.id,
      name: s.name,
      committed: round(st.committedPoints),
      completed: round(st.completedPoints),
      carriedOver: round(st.carriedOverPoints ?? 0),
      added: round(st.addedPoints),
      removed: round(st.removedPoints),
      completionRate: st.committedPoints > 0 ? round(st.completedPoints / st.committedPoints) : null,
    }
  })
  const window = rows.slice(-VELOCITY_WINDOW)
  const average = window.length ? round(window.reduce((sum, r) => sum + r.completed, 0) / window.length) : null
  let message: string | null = null
  if (!rows.length) message = 'No completed sprints yet. Velocity appears after the first sprint is completed.'
  else if (rows.length < VELOCITY_WINDOW) {
    message = `Only ${rows.length} completed sprint${rows.length === 1 ? '' : 's'}. The average needs ${VELOCITY_WINDOW} to be a reliable forecast.`
  }
  return {
    rows,
    average,
    averageOf: window.length,
    sufficient: rows.length >= VELOCITY_WINDOW,
    message,
    excluded: done.length - usable.length,
  }
}

export interface CarryoverRow {
  id?: string
  name?: string
  carriedOverCount: number
  carriedOverPoints: number
  committedPoints: number
  /** Share of committed points that carried over, null when nothing was committed. */
  rate: number | null
}

export function carryoverReport(sprints: ReportSprint[]) {
  const rows: CarryoverRow[] = sprints
    .filter((s) => s.status === 'completed' && s.stats)
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
    .map((s) => {
      const st = s.stats!
      const carried = st.carriedOverPoints ?? 0
      return {
        id: s.id,
        name: s.name,
        carriedOverCount: st.carriedOverCount ?? 0,
        carriedOverPoints: round(carried),
        committedPoints: round(st.committedPoints),
        rate: st.committedPoints > 0 ? round(carried / st.committedPoints) : null,
      }
    })
  const totalPoints = round(rows.reduce((s, r) => s + r.carriedOverPoints, 0))
  const totalCount = rows.reduce((s, r) => s + r.carriedOverCount, 0)
  return {
    rows,
    totalPoints,
    totalCount,
    sufficient: rows.length > 0,
    message: rows.length ? null : 'No completed sprints yet, so there is no carryover to report.',
  }
}

/** Items carried over at least `threshold` times; a signal of stuck work. */
export function chronicCarryover<T extends { carryoverCount?: number }>(items: T[], threshold = 2): T[] {
  return items
    .filter((i) => (i.carryoverCount ?? 0) >= threshold)
    .sort((a, b) => (b.carryoverCount ?? 0) - (a.carryoverCount ?? 0))
}

/** Default end date for a sprint of `days` length starting on `start`. */
export const sprintEnd = (start: string, days: number) => addDays(start, Math.max(1, days) - 1)
