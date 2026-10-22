import { daysBetween, isDayKey } from './dates'
import { DomainError, type SprintItemFields, type SprintStats, type SprintStatus } from './types'

export const SPRINT_TRANSITIONS: Record<SprintStatus, SprintStatus[]> = {
  planned: ['active'],
  active: ['completed'],
  completed: [],
}

export function assertTransition(from: SprintStatus, to: SprintStatus): void {
  if (!SPRINT_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError('failed-precondition', `A ${from} sprint cannot become ${to}.`)
  }
}

/** Longest sprint the planner accepts, in days. */
export const MAX_SPRINT_DAYS = 56

export function validateSprintDates(startDate: unknown, endDate: unknown): void {
  if (!isDayKey(startDate) || !isDayKey(endDate)) {
    throw new DomainError('invalid-argument', 'Sprint dates must be valid YYYY-MM-DD days.')
  }
  const length = daysBetween(startDate, endDate)
  if (length < 0) throw new DomainError('invalid-argument', 'A sprint cannot end before it starts.')
  if (length + 1 > MAX_SPRINT_DAYS) {
    throw new DomainError('invalid-argument', `A sprint can be at most ${MAX_SPRINT_DAYS} days long.`)
  }
}

export const isDone = (status: unknown): boolean => status === 'done'

/** Story points of an item; missing or invalid estimates count as zero. */
export function points(item: SprintItemFields | null | undefined): number {
  const value = item?.storyPoints
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Epics group stories; they never sit in a sprint themselves. */
export const countsTowardSprint = (item: SprintItemFields | null | undefined): boolean =>
  Boolean(item) && item?.type !== 'epic'

export function measure(items: SprintItemFields[]) {
  let scopePoints = 0
  let completedPoints = 0
  let completedCount = 0
  let scopeCount = 0
  for (const item of items) {
    if (!countsTowardSprint(item)) continue
    scopeCount += 1
    scopePoints += points(item)
    if (isDone(item.status)) {
      completedCount += 1
      completedPoints += points(item)
    }
  }
  return { scopePoints, scopeCount, completedPoints, completedCount }
}

/** Stats written when a sprint starts: everything in it is the commitment. */
export function startStats(items: SprintItemFields[]): SprintStats {
  const m = measure(items)
  return {
    committedPoints: m.scopePoints,
    committedCount: m.scopeCount,
    ...m,
    addedPoints: 0,
    removedPoints: 0,
  }
}

export interface CompletionPlan<T> {
  completed: T[]
  incomplete: T[]
  stats: SprintStats
}

/**
 * Splits a sprint's items at completion. Final stats are recomputed from the
 * items themselves rather than trusting the running counters, so a missed
 * trigger cannot leave the closing numbers wrong.
 */
export function planCompletion<T extends SprintItemFields>(
  items: T[],
  running: Pick<SprintStats, 'committedPoints' | 'committedCount' | 'addedPoints' | 'removedPoints'>,
): CompletionPlan<T> {
  const counted = items.filter(countsTowardSprint)
  const completed = counted.filter((i) => isDone(i.status))
  const incomplete = counted.filter((i) => !isDone(i.status))
  const m = measure(counted)
  return {
    completed,
    incomplete,
    stats: {
      committedPoints: running.committedPoints,
      committedCount: running.committedCount,
      addedPoints: running.addedPoints,
      removedPoints: running.removedPoints,
      ...m,
      carriedOverPoints: incomplete.reduce((sum, i) => sum + points(i), 0),
      carriedOverCount: incomplete.length,
    },
  }
}
