/** Calendar-day helpers. Day keys are 'YYYY-MM-DD' strings. */

const DAY_MS = 86_400_000
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_KEY.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Day key of an instant as seen in `timeZone` (IANA name, default UTC). */
export function dayKey(ms: number, timeZone = 'UTC'): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`)
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

/** Every day key from start to end, inclusive. Empty when end < start. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  const n = daysBetween(start, end)
  for (let i = 0; i <= n; i += 1) out.push(addDays(start, i))
  return out
}
