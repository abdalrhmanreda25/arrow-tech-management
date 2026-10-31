import type { ItemType } from './types'

export interface HoursItem {
  type?: ItemType
  status?: string
  hours?: number | null
  storyPoints?: number | null
  assigneeId?: string | null
}

export interface PersonHours {
  /** null collects unassigned work. */
  uid: string | null
  total: number
  done: number
}

const round = (n: number) => Math.round(n * 10) / 10
const hoursOf = (i: HoursItem) => (typeof i.hours === 'number' && Number.isFinite(i.hours) && i.hours > 0 ? i.hours : 0)

/**
 * Estimated hours of a sprint's work, split into done and remaining and by
 * assignee. Epics never count. Burndown runs on story points, so done items
 * without points are counted too: they finish without moving the chart.
 */
export function sprintHours(items: HoursItem[]) {
  const people = new Map<string | null, PersonHours>()
  let total = 0
  let done = 0
  let withoutHours = 0
  let doneWithoutPoints = 0
  for (const item of items) {
    if (item.type === 'epic') continue
    const isDone = item.status === 'done'
    if (item.hours === null || item.hours === undefined) withoutHours += 1
    if (isDone && (item.storyPoints === null || item.storyPoints === undefined)) doneWithoutPoints += 1
    const h = hoursOf(item)
    if (!h) continue
    const uid = item.assigneeId ?? null
    const row = people.get(uid) ?? { uid, total: 0, done: 0 }
    row.total += h
    total += h
    if (isDone) {
      row.done += h
      done += h
    }
    people.set(uid, row)
  }
  const rows = [...people.values()]
    .map((r) => ({ ...r, total: round(r.total), done: round(r.done) }))
    .sort((a, b) => (a.uid === null ? 1 : b.uid === null ? -1 : b.total - a.total || a.uid.localeCompare(b.uid)))
  return { total: round(total), done: round(done), remaining: round(total - done), people: rows, withoutHours, doneWithoutPoints }
}
