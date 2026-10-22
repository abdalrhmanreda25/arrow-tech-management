import { describe, expect, it } from 'vitest'
import { addMonths, barPosition, dayOffset, lastDayOfMonth, monthColumns, monthGrid, weekdayMon } from '@/lib/calendar'

describe('month grid', () => {
  it('starts on Monday and covers whole weeks', () => {
    // March 2026 starts on a Sunday and ends on a Tuesday.
    const grid = monthGrid('2026-03-01')
    expect(grid[0].date).toBe('2026-02-23')
    expect(weekdayMon(grid[0].date)).toBe(0)
    expect(grid.at(-1)!.date).toBe('2026-04-05')
    expect(grid).toHaveLength(42)
    expect(grid.filter((d) => d.inMonth)).toHaveLength(31)
  })

  it('uses five rows when the month fits', () => {
    // February 2027 starts on a Monday: exactly 4 weeks.
    expect(monthGrid('2027-02-01')).toHaveLength(28)
  })

  it('does month arithmetic across years', () => {
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01')
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
    expect(lastDayOfMonth('2028-02-01')).toBe('2028-02-29')
    expect(monthColumns('2026-12-01', 2).map((c) => [c.key, c.days])).toEqual([
      ['2026-12', 31],
      ['2027-01', 31],
    ])
  })
})

describe('timeline positions', () => {
  const from = '2026-01-01'
  const to = '2026-01-10'

  it('places and clips bars', () => {
    expect(barPosition('2026-01-01', '2026-01-05', from, to)).toMatchObject({ left: 0, width: 50, clippedStart: false, clippedEnd: false })
    expect(barPosition('2025-12-20', '2026-01-02', from, to)).toMatchObject({ left: 0, width: 20, clippedStart: true })
    expect(barPosition('2026-01-09', '2026-02-01', from, to)).toMatchObject({ left: 80, width: 20, clippedEnd: true })
    expect(barPosition('2026-02-01', '2026-02-05', from, to)).toBeNull()
    expect(barPosition('2026-01-03', null, from, to)).toMatchObject({ left: 20, width: 10 })
  })

  it('marks a day', () => {
    expect(dayOffset('2026-01-01', from, to)).toBe(5)
    expect(dayOffset('2026-02-01', from, to)).toBeNull()
  })
})
