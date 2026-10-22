import { points } from './sprint'
import type { SprintItemFields } from './types'

export interface MemberCapacity {
  /** Working days available in the sprint. */
  days: number
  /** Points the person usually finishes per working day. */
  pointsPerDay: number
}

export interface CapacityRow {
  uid: string
  capacityPoints: number
  plannedPoints: number
  /** planned / capacity, null when no capacity was entered. */
  utilization: number | null
  overCommitted: boolean
}

const round = (n: number) => Math.round(n * 10) / 10

export function memberCapacityPoints(c: MemberCapacity | undefined): number {
  if (!c) return 0
  const days = Number.isFinite(c.days) && c.days > 0 ? c.days : 0
  const rate = Number.isFinite(c.pointsPerDay) && c.pointsPerDay > 0 ? c.pointsPerDay : 0
  return round(days * rate)
}

export function capacityPlan(
  capacity: Record<string, MemberCapacity> | null | undefined,
  items: (SprintItemFields & { assigneeId?: string | null })[],
) {
  const cap = capacity || {}
  const planned = new Map<string, number>()
  let unassignedPoints = 0
  for (const item of items) {
    if (item.type === 'epic') continue
    const p = points(item)
    if (item.assigneeId) planned.set(item.assigneeId, (planned.get(item.assigneeId) || 0) + p)
    else unassignedPoints += p
  }
  const uids = new Set([...Object.keys(cap), ...planned.keys()])
  const rows: CapacityRow[] = [...uids].map((uid) => {
    const capacityPoints = memberCapacityPoints(cap[uid])
    const plannedPoints = round(planned.get(uid) || 0)
    return {
      uid,
      capacityPoints,
      plannedPoints,
      utilization: capacityPoints > 0 ? Math.round((plannedPoints / capacityPoints) * 100) / 100 : null,
      overCommitted: plannedPoints > capacityPoints,
    }
  })
  rows.sort((a, b) => b.plannedPoints - a.plannedPoints || a.uid.localeCompare(b.uid))
  const totalCapacity = round(rows.reduce((s, r) => s + r.capacityPoints, 0))
  const totalPlanned = round(rows.reduce((s, r) => s + r.plannedPoints, 0) + unassignedPoints)
  return { rows, totalCapacity, totalPlanned, unassignedPoints: round(unassignedPoints) }
}

/**
 * Suggested commitment: the lower of recent velocity and entered capacity,
 * or whichever one exists. null when there is nothing to base it on.
 */
export function suggestedCommitment(averageVelocity: number | null, totalCapacity: number): number | null {
  const hasVelocity = averageVelocity !== null && averageVelocity > 0
  const hasCapacity = totalCapacity > 0
  if (hasVelocity && hasCapacity) return Math.min(averageVelocity!, totalCapacity)
  if (hasVelocity) return averageVelocity
  if (hasCapacity) return totalCapacity
  return null
}
