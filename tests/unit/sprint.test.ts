import { describe, expect, it } from 'vitest'
import { assertTransition, measure, planCompletion, points, startStats, validateSprintDates } from '@domain/sprint'
import { sprintDeltas, sprintEventsForWrite } from '@domain/events'
import type { SprintItemFields } from '@domain/types'

describe('sprint transitions', () => {
  it('allows planned -> active -> completed only', () => {
    expect(() => assertTransition('planned', 'active')).not.toThrow()
    expect(() => assertTransition('active', 'completed')).not.toThrow()
    expect(() => assertTransition('planned', 'completed')).toThrow(/cannot become/)
    expect(() => assertTransition('completed', 'active')).toThrow()
    expect(() => assertTransition('active', 'planned')).toThrow()
  })

  it('validates sprint dates', () => {
    expect(() => validateSprintDates('2026-01-01', '2026-01-14')).not.toThrow()
    expect(() => validateSprintDates('2026-01-14', '2026-01-01')).toThrow(/before it starts/)
    expect(() => validateSprintDates('2026-02-30', '2026-03-01')).toThrow(/valid/)
    expect(() => validateSprintDates('2026-01-01', '2026-06-01')).toThrow(/at most/)
  })
})

describe('sprint stats', () => {
  const items: SprintItemFields[] = [
    { type: 'story', status: 'done', storyPoints: 5 },
    { type: 'story', status: 'in_progress', storyPoints: 3 },
    { type: 'bug', status: 'todo', storyPoints: null },
    { type: 'epic', status: 'todo', storyPoints: 40 },
  ]

  it('ignores epics and missing estimates', () => {
    expect(points({ storyPoints: -2 })).toBe(0)
    expect(points({ storyPoints: Number.NaN })).toBe(0)
    expect(measure(items)).toEqual({ scopePoints: 8, scopeCount: 3, completedPoints: 5, completedCount: 1 })
  })

  it('captures the commitment at start', () => {
    const s = startStats(items)
    expect(s.committedPoints).toBe(8)
    expect(s.committedCount).toBe(3)
    expect(s.addedPoints).toBe(0)
  })

  it('splits done and unfinished work at completion', () => {
    const plan = planCompletion(items, { committedPoints: 10, committedCount: 4, addedPoints: 1, removedPoints: 3 })
    expect(plan.completed).toHaveLength(1)
    expect(plan.incomplete).toHaveLength(2)
    expect(plan.stats).toMatchObject({
      committedPoints: 10,
      scopePoints: 8,
      completedPoints: 5,
      carriedOverPoints: 3,
      carriedOverCount: 2,
      addedPoints: 1,
      removedPoints: 3,
    })
  })
})

describe('sprintDeltas', () => {
  const story = (o: Partial<SprintItemFields>): SprintItemFields => ({ type: 'story', status: 'todo', storyPoints: 3, sprintId: 's1', ...o })

  it('records adds, removals and moves between sprints', () => {
    expect(sprintDeltas(null, story({}))).toMatchObject([{ sprintId: 's1', type: 'item_added', scopeDelta: 3, countDelta: 1 }])
    expect(sprintDeltas(story({}), null)).toMatchObject([{ sprintId: 's1', type: 'item_removed', scopeDelta: -3 }])
    const moved = sprintDeltas(story({ status: 'done' }), story({ sprintId: 's2', status: 'done' }))
    expect(moved.map((d) => [d.sprintId, d.type, d.completedDelta])).toEqual([
      ['s1', 'item_removed', -3],
      ['s2', 'item_added', 3],
    ])
  })

  it('records estimate changes and completion in one write', () => {
    const d = sprintDeltas(story({ storyPoints: 3 }), story({ storyPoints: 5, status: 'done' }))
    expect(d.map((x) => x.type)).toEqual(['estimate_changed', 'item_completed'])
    expect(d.reduce((s, x) => s + x.scopeDelta, 0)).toBe(2)
    expect(d.reduce((s, x) => s + x.completedDelta, 0)).toBe(5)
  })

  it('ignores edits that do not touch sprint accounting', () => {
    expect(sprintDeltas(story({}), story({ status: 'in_review' }))).toEqual([])
    expect(sprintDeltas(story({ sprintId: null }), story({ sprintId: null, storyPoints: 8 }))).toEqual([])
    expect(sprintDeltas({ type: 'epic', sprintId: null }, { type: 'epic', sprintId: null, storyPoints: 9 })).toEqual([])
  })

  it('keeps scope and completed totals equal to the items after any sequence of writes', () => {
    // Deterministic pseudo-random walk over item states.
    let seed = 42
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % n
    }
    const sprints = ['s1', 's2', null]
    const statuses = ['todo', 'in_progress', 'done'] as const
    const state = new Map<number, SprintItemFields | null>()
    const totals: Record<string, { scope: number; completed: number }> = { s1: { scope: 0, completed: 0 }, s2: { scope: 0, completed: 0 } }
    for (let step = 0; step < 2000; step += 1) {
      const id = rand(12)
      const before = state.get(id) ?? null
      const after = rand(10) === 0 ? null : story({ sprintId: sprints[rand(3)], status: statuses[rand(3)], storyPoints: rand(9) })
      for (const d of sprintDeltas(before, after)) {
        totals[d.sprintId].scope += d.scopeDelta
        totals[d.sprintId].completed += d.completedDelta
      }
      state.set(id, after)
    }
    for (const sprintId of ['s1', 's2']) {
      const inSprint = [...state.values()].filter((i): i is SprintItemFields => Boolean(i && i.sprintId === sprintId))
      const m = measure(inSprint)
      expect(totals[sprintId]).toEqual({ scope: m.scopePoints, completed: m.completedPoints })
    }
  })
})

describe('sprintEventsForWrite', () => {
  const story = (o: Partial<SprintItemFields>): SprintItemFields => ({ type: 'story', status: 'todo', storyPoints: 3, sprintId: 's1', ...o })

  it('nets several changes into one entry per sprint', () => {
    const [e] = sprintEventsForWrite(story({ storyPoints: 3 }), story({ storyPoints: 5, status: 'done' }))
    expect(e).toMatchObject({ sprintId: 's1', type: 'estimate_changed', scopeDelta: 2, completedDelta: 5, countDelta: 0, completedCountDelta: 1 })
  })

  it('writes one entry in each sprint when an item moves', () => {
    const events = sprintEventsForWrite(story({}), story({ sprintId: 's2' }))
    expect(events.map((e) => [e.sprintId, e.type, e.countDelta])).toEqual([
      ['s1', 'item_removed', -1],
      ['s2', 'item_added', 1],
    ])
  })

  it('labels completion and reopening', () => {
    expect(sprintEventsForWrite(story({}), story({ status: 'done' }))[0].type).toBe('item_completed')
    expect(sprintEventsForWrite(story({ status: 'done' }), story({ status: 'todo' }))[0].type).toBe('item_reopened')
    expect(sprintEventsForWrite(story({}), story({ title: 'x' } as never))).toEqual([])
  })
})
