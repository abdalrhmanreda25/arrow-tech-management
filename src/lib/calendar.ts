import { addDays, daysBetween } from '@domain/dates'

/** First day of a month as a day key. `month` is 0-based. */
export const monthStart = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}-01`

/** Shifts a 'YYYY-MM-01' key by whole months. */
export function addMonths(key: string, months: number): string {
  const [y, m] = key.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  return monthStart(Math.floor(total / 12), ((total % 12) + 12) % 12)
}

export const lastDayOfMonth = (key: string) => addDays(addMonths(key.slice(0, 7) + '-01', 1), -1)

/** ISO weekday 0 = Monday ... 6 = Sunday. */
export function weekdayMon(key: string): number {
  return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7
}

export interface GridDay {
  date: string
  inMonth: boolean
}

/** Monday-first month grid covering whole weeks (5 or 6 rows). */
export function monthGrid(monthKey: string): GridDay[] {
  const first = monthKey.slice(0, 7) + '-01'
  const last = lastDayOfMonth(first)
  const start = addDays(first, -weekdayMon(first))
  const end = addDays(last, 6 - weekdayMon(last))
  const out: GridDay[] = []
  for (let i = 0; i <= daysBetween(start, end); i += 1) {
    const date = addDays(start, i)
    out.push({ date, inMonth: date.slice(0, 7) === first.slice(0, 7) })
  }
  return out
}

export interface MonthColumn {
  key: string
  start: string
  days: number
}

/** `count` consecutive months starting at `fromMonth` ('YYYY-MM-01'). */
export function monthColumns(fromMonth: string, count: number): MonthColumn[] {
  return Array.from({ length: count }, (_, i) => {
    const start = addMonths(fromMonth, i)
    return { key: start.slice(0, 7), start, days: daysBetween(start, lastDayOfMonth(start)) + 1 }
  })
}

/**
 * Position of a bar on a timeline from rangeStart to rangeEnd (inclusive), in
 * percent. Returns null when the span is entirely outside the range. A
 * missing end is treated as a one-day span at the start.
 */
export function barPosition(start: string, end: string | null | undefined, rangeStart: string, rangeEnd: string) {
  const finish = end && end >= start ? end : start
  if (finish < rangeStart || start > rangeEnd) return null
  const total = daysBetween(rangeStart, rangeEnd) + 1
  const from = Math.max(0, daysBetween(rangeStart, start))
  const to = Math.min(total, daysBetween(rangeStart, finish) + 1)
  return {
    left: (from / total) * 100,
    width: Math.max(((to - from) / total) * 100, 0.5),
    clippedStart: start < rangeStart,
    clippedEnd: finish > rangeEnd,
  }
}

/** Percent offset of a single day (e.g. today) on the same timeline, or null when outside. */
export function dayOffset(day: string, rangeStart: string, rangeEnd: string): number | null {
  if (day < rangeStart || day > rangeEnd) return null
  return ((daysBetween(rangeStart, day) + 0.5) / (daysBetween(rangeStart, rangeEnd) + 1)) * 100
}
