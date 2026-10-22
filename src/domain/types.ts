/**
 * Shared domain types. Everything in src/domain is pure TypeScript
 * with no Firebase imports, so the UI, the data layer and the tests share the exact
 * same rules for roles, sprint transitions and report maths.
 */

export type Role = 'owner' | 'admin' | 'manager' | 'member' | 'viewer'

export type ItemType = 'epic' | 'story' | 'task' | 'bug'
export type ItemStatus = 'todo' | 'in_progress' | 'in_review' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type SprintStatus = 'planned' | 'active' | 'completed'

/** The fields of a work item that sprint accounting depends on. */
export interface SprintItemFields {
  type?: ItemType
  status?: ItemStatus | string
  storyPoints?: number | null
  sprintId?: string | null
}

export interface SprintStats {
  committedPoints: number
  committedCount: number
  scopePoints: number
  scopeCount: number
  completedPoints: number
  completedCount: number
  addedPoints: number
  removedPoints: number
  carriedOverPoints?: number
  carriedOverCount?: number
}

export type SprintEventType =
  | 'sprint_started'
  | 'item_added'
  | 'item_removed'
  | 'estimate_changed'
  | 'item_completed'
  | 'item_reopened'
  | 'sprint_completed'

/**
 * One entry in a sprint's history. Deltas are relative to the state before
 * the event; `sprint_started` carries absolute values in scope/completed.
 */
export interface SprintEvent {
  type: SprintEventType
  /** Epoch milliseconds. */
  at: number
  itemId?: string | null
  actorId?: string | null
  scopeDelta: number
  countDelta: number
  completedDelta: number
  completedCountDelta: number
  /** Absolute scope/completed after the event, when the writer knew them. */
  scopeAfter?: number
  completedAfter?: number
  before?: number | string | null
  after?: number | string | null
}

export class DomainError extends Error {
  constructor(
    public readonly code: 'invalid-argument' | 'failed-precondition' | 'permission-denied',
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
