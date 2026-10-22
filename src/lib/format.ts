import type { Timestamp } from 'firebase/firestore'

type When = Timestamp | Date | number | string | null | undefined

export function toDate(value: When): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') return new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (typeof (value as Timestamp).toDate === 'function') return (value as Timestamp).toDate()
  return null
}

export function formatDate(value: When, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const d = toDate(value)
  return d ? d.toLocaleDateString(undefined, opts) : '-'
}

export function formatDateTime(value: When) {
  const d = toDate(value)
  return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
}

export function relativeTime(value: When) {
  const d = toDate(value)
  if (!d) return ''
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return formatDate(d)
}

/** Local calendar day as YYYY-MM-DD. */
export function todayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const pts = (n: number | null | undefined) => `${Math.round((n ?? 0) * 10) / 10} pt${n === 1 ? '' : 's'}`

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '-' : `${Math.round(n * 100)}%`)

export function initials(name = '') {
  const parts = String(name).trim().split(/[\s@._-]+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}
