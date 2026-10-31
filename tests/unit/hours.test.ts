import { describe, expect, it } from 'vitest'
import { sprintHours } from '@domain/hours'

const item = (o: Record<string, unknown>) => ({ type: 'task' as const, status: 'todo', hours: null, storyPoints: null, assigneeId: null, ...o })

describe('sprint hours', () => {
  it('totals done and remaining hours per person', () => {
    const h = sprintHours([
      item({ assigneeId: 'a', hours: 4, status: 'done' }),
      item({ assigneeId: 'a', hours: 2.5, status: 'in_progress' }),
      item({ assigneeId: 'b', hours: 3, status: 'done' }),
      item({ hours: 1 }),
    ])
    expect(h).toMatchObject({ total: 10.5, done: 7, remaining: 3.5 })
    expect(h.people).toEqual([
      { uid: 'a', total: 6.5, done: 4 },
      { uid: 'b', total: 3, done: 3 },
      { uid: null, total: 1, done: 0 },
    ])
  })

  it('skips epics and counts work without hours or points', () => {
    const h = sprintHours([
      item({ type: 'epic', hours: 50 }),
      item({ status: 'done' }),
      item({ status: 'done', storyPoints: 0, hours: 2 }),
      item({ status: 'done', storyPoints: 3 }),
    ])
    expect(h.total).toBe(2)
    expect(h.withoutHours).toBe(2)
    expect(h.doneWithoutPoints).toBe(1)
  })
})
