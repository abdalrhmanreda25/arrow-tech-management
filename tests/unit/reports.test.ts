import { describe, expect, it } from 'vitest'
import { buildSprintSeries, carryoverReport, chronicCarryover, velocityReport, type ReportSprint } from '@domain/reports'
import { capacityPlan, suggestedCommitment } from '@domain/capacity'
import type { SprintEvent, SprintStats } from '@domain/types'

const at = (iso: string) => Date.parse(iso)

const ev = (type: SprintEvent['type'], iso: string, scopeDelta = 0, completedDelta = 0, extra: Partial<SprintEvent> = {}): SprintEvent => ({
  type,
  at: at(iso),
  scopeDelta,
  completedDelta,
  countDelta: 0,
  completedCountDelta: 0,
  ...extra,
})

const stats = (o: Partial<SprintStats>): SprintStats => ({
  committedPoints: 0,
  committedCount: 0,
  scopePoints: 0,
  scopeCount: 0,
  completedPoints: 0,
  completedCount: 0,
  addedPoints: 0,
  removedPoints: 0,
  ...o,
})

describe('buildSprintSeries', () => {
  const sprint: ReportSprint = { status: 'active', startDate: '2026-03-02', endDate: '2026-03-06' }
  const events = [
    ev('sprint_started', '2026-03-02T08:00:00Z', 20, 0, { scopeAfter: 20, completedAfter: 0 }),
    ev('item_completed', '2026-03-02T15:00:00Z', 0, 5),
    ev('item_added', '2026-03-03T10:00:00Z', 3, 0),
    ev('item_completed', '2026-03-04T10:00:00Z', 0, 8),
    ev('estimate_changed', '2026-03-04T11:00:00Z', -2, 0),
  ]

  it('rebuilds burndown and burnup day by day from events', () => {
    const s = buildSprintSeries(sprint, events, { now: at('2026-03-04T18:00:00Z') })
    expect(s.sufficient).toBe(true)
    expect(s.points.map((p) => p.remaining)).toEqual([15, 18, 8, null, null])
    expect(s.points.map((p) => p.scope)).toEqual([20, 23, 21, null, null])
    expect(s.points.map((p) => p.completed)).toEqual([5, 5, 13, null, null])
    expect(s.points.map((p) => p.ideal)).toEqual([20, 15, 10, 5, 0])
    expect(s).toMatchObject({ committed: 20, scope: 21, completed: 13, added: 3, removed: 2 })
  })

  it('places events on days in the organization time zone', () => {
    // 23:30 UTC on the 2nd is already the 3rd in Cairo (UTC+2).
    const late = [events[0], ev('item_completed', '2026-03-02T23:30:00Z', 0, 5)]
    const utc = buildSprintSeries(sprint, late, { now: at('2026-03-03T12:00:00Z') })
    const cairo = buildSprintSeries(sprint, late, { now: at('2026-03-03T12:00:00Z'), timeZone: 'Africa/Cairo' })
    expect(utc.points[0].completed).toBe(5)
    expect(cairo.points[0].completed).toBe(0)
    expect(cairo.points[1].completed).toBe(5)
  })

  it('reports missing history instead of inventing a line', () => {
    const s = buildSprintSeries(sprint, [ev('item_completed', '2026-03-03T10:00:00Z', 0, 3)])
    expect(s.sufficient).toBe(false)
    expect(s.reason).toMatch(/No start record/)
    expect(s.points).toEqual([])
    expect(buildSprintSeries({ ...sprint, status: 'planned' }, []).sufficient).toBe(false)
  })

  it('warns when history disagrees with the stored totals', () => {
    const s = buildSprintSeries({ ...sprint, stats: stats({ scopePoints: 30, completedPoints: 13 }) }, events, { now: at('2026-03-06T12:00:00Z') })
    expect(s.warnings[0]).toMatch(/not captured/)
  })

  it('extends past the end date when a sprint overruns', () => {
    const done: ReportSprint = { ...sprint, status: 'completed', completedAt: at('2026-03-08T09:00:00Z') }
    const s = buildSprintSeries(done, events, { now: at('2026-03-20T00:00:00Z') })
    expect(s.points.at(-1)).toMatchObject({ date: '2026-03-08', ideal: 0, remaining: 8 })
  })
})

describe('velocity and carryover', () => {
  const sprints: ReportSprint[] = [
    { id: 'a', name: 'S1', status: 'completed', startDate: '2026-01-01', endDate: '2026-01-14', completedAt: 1, stats: stats({ committedPoints: 20, completedPoints: 15, carriedOverPoints: 5, carriedOverCount: 2 }) },
    { id: 'b', name: 'S2', status: 'completed', startDate: '2026-01-15', endDate: '2026-01-28', completedAt: 2, stats: stats({ committedPoints: 18, completedPoints: 18 }) },
    { id: 'c', name: 'S3', status: 'completed', startDate: '2026-01-29', endDate: '2026-02-11', completedAt: 3, stats: stats({ committedPoints: 25, completedPoints: 21, carriedOverPoints: 4, carriedOverCount: 1 }) },
    { id: 'd', name: 'S4', status: 'completed', startDate: '2026-02-12', endDate: '2026-02-25', completedAt: 4, stats: stats({ committedPoints: 0, completedPoints: 0 }) },
    { id: 'e', name: 'Old', status: 'completed', startDate: '2025-12-01', endDate: '2025-12-14', completedAt: 0, stats: null },
    { id: 'f', name: 'Now', status: 'active', startDate: '2026-02-26', endDate: '2026-03-11' },
  ]

  it('averages the last three completed sprints and counts excluded ones', () => {
    const v = velocityReport(sprints)
    expect(v.rows.map((r) => r.name)).toEqual(['S1', 'S2', 'S3', 'S4'])
    expect(v.average).toBe(13)
    expect(v.sufficient).toBe(true)
    expect(v.excluded).toBe(1)
    expect(v.rows[0].completionRate).toBe(0.75)
    expect(v.rows[3].completionRate).toBeNull()
  })

  it('says when there is not enough history', () => {
    expect(velocityReport([]).message).toMatch(/No completed sprints/)
    const two = velocityReport(sprints.slice(0, 2))
    expect(two.sufficient).toBe(false)
    expect(two.message).toMatch(/Only 2 completed sprints/)
    expect(two.average).toBe(16.5)
  })

  it('totals carryover per sprint', () => {
    const c = carryoverReport(sprints)
    expect(c.totalPoints).toBe(9)
    expect(c.totalCount).toBe(3)
    expect(c.rows[0].rate).toBe(0.25)
    expect(carryoverReport([]).sufficient).toBe(false)
  })

  it('finds chronically carried-over items', () => {
    const items = [{ id: 1, carryoverCount: 1 }, { id: 2, carryoverCount: 3 }, { id: 3, carryoverCount: 2 }, { id: 4 }]
    expect(chronicCarryover(items).map((i) => i.id)).toEqual([2, 3])
  })
})

describe('capacity planning', () => {
  it('compares planned points with capacity per person', () => {
    const plan = capacityPlan(
      { u1: { days: 8, pointsPerDay: 1.5 }, u2: { days: 10, pointsPerDay: 1 } },
      [
        { type: 'story', storyPoints: 8, assigneeId: 'u1' },
        { type: 'story', storyPoints: 8, assigneeId: 'u1' },
        { type: 'task', storyPoints: 3, assigneeId: 'u3' },
        { type: 'bug', storyPoints: 2, assigneeId: null },
        { type: 'epic', storyPoints: 50, assigneeId: 'u2' },
      ],
    )
    const u1 = plan.rows.find((r) => r.uid === 'u1')!
    expect(u1).toMatchObject({ capacityPoints: 12, plannedPoints: 16, overCommitted: true, utilization: 1.33 })
    expect(plan.rows.find((r) => r.uid === 'u3')).toMatchObject({ capacityPoints: 0, utilization: null, overCommitted: true })
    expect(plan.totalCapacity).toBe(22)
    expect(plan.totalPlanned).toBe(21)
    expect(plan.unassignedPoints).toBe(2)
  })

  it('suggests the lower of velocity and capacity', () => {
    expect(suggestedCommitment(20, 15)).toBe(15)
    expect(suggestedCommitment(null, 15)).toBe(15)
    expect(suggestedCommitment(12, 0)).toBe(12)
    expect(suggestedCommitment(null, 0)).toBeNull()
  })
})
