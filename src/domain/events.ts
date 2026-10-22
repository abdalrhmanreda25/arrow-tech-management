import { countsTowardSprint, isDone, points } from './sprint'
import type { SprintEventType, SprintItemFields } from './types'

export interface SprintDelta {
  sprintId: string
  type: SprintEventType
  scopeDelta: number
  countDelta: number
  completedDelta: number
  completedCountDelta: number
  before?: number | string | null
  after?: number | string | null
}

/**
 * Sprint history entries implied by one item write (create, update or
 * delete). Applying every delta keeps two invariants per sprint:
 *   scope     = sum of points of items in the sprint
 *   completed = sum of points of done items in the sprint
 */
export function sprintDeltas(
  before: SprintItemFields | null | undefined,
  after: SprintItemFields | null | undefined,
): SprintDelta[] {
  const b = countsTowardSprint(before) ? before! : null
  const a = countsTowardSprint(after) ? after! : null
  const bSprint = b?.sprintId || null
  const aSprint = a?.sprintId || null
  const bPoints = points(b)
  const aPoints = points(a)
  const bDone = b ? isDone(b.status) : false
  const aDone = a ? isDone(a.status) : false
  const out: SprintDelta[] = []

  if (bSprint && bSprint !== aSprint) {
    out.push({
      sprintId: bSprint,
      type: 'item_removed',
      scopeDelta: -bPoints,
      countDelta: -1,
      completedDelta: bDone ? -bPoints : 0,
      completedCountDelta: bDone ? -1 : 0,
      before: bPoints,
    })
  }

  if (aSprint && aSprint !== bSprint) {
    out.push({
      sprintId: aSprint,
      type: 'item_added',
      scopeDelta: aPoints,
      countDelta: 1,
      completedDelta: aDone ? aPoints : 0,
      completedCountDelta: aDone ? 1 : 0,
      after: aPoints,
    })
  }

  if (aSprint && aSprint === bSprint) {
    if (aPoints !== bPoints) {
      out.push({
        sprintId: aSprint,
        type: 'estimate_changed',
        scopeDelta: aPoints - bPoints,
        countDelta: 0,
        // Only an item that stays done moves the completed line here; a status
        // change in the same write is accounted for by the entry below.
        completedDelta: bDone && aDone ? aPoints - bPoints : 0,
        completedCountDelta: 0,
        before: bPoints,
        after: aPoints,
      })
    }
    if (!bDone && aDone) {
      out.push({
        sprintId: aSprint,
        type: 'item_completed',
        scopeDelta: 0,
        countDelta: 0,
        completedDelta: aPoints,
        completedCountDelta: 1,
        before: b?.status ?? null,
        after: a?.status ?? null,
      })
    } else if (bDone && !aDone) {
      out.push({
        sprintId: aSprint,
        type: 'item_reopened',
        scopeDelta: 0,
        countDelta: 0,
        completedDelta: -bPoints,
        completedCountDelta: -1,
        before: b?.status ?? null,
        after: a?.status ?? null,
      })
    }
  }

  return out
}

export interface SprintEventDraft {
  sprintId: string
  type: SprintEventType
  scopeDelta: number
  countDelta: number
  completedDelta: number
  completedCountDelta: number
  before?: number | string | null
  after?: number | string | null
}

const TYPE_ORDER: SprintEventType[] = ['item_added', 'item_removed', 'estimate_changed', 'item_completed', 'item_reopened']

/**
 * One history entry per affected sprint for a single item write: the net of
 * sprintDeltas, labelled by its most significant change. firestore.rules
 * recomputes exactly these numbers from the item before and after the write.
 */
export function sprintEventsForWrite(
  before: SprintItemFields | null | undefined,
  after: SprintItemFields | null | undefined,
): SprintEventDraft[] {
  const bySprint = new Map<string, SprintEventDraft>()
  for (const d of sprintDeltas(before, after)) {
    const cur = bySprint.get(d.sprintId)
    if (!cur) {
      bySprint.set(d.sprintId, { ...d })
      continue
    }
    cur.scopeDelta += d.scopeDelta
    cur.countDelta += d.countDelta
    cur.completedDelta += d.completedDelta
    cur.completedCountDelta += d.completedCountDelta
    if (TYPE_ORDER.indexOf(d.type) < TYPE_ORDER.indexOf(cur.type)) cur.type = d.type
    cur.after = d.after ?? cur.after
  }
  return [...bySprint.values()]
}
