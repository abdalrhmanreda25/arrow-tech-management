import type { CeremonyType, ItemStatus, ItemType, Priority } from './types'

export const STATUSES: { id: ItemStatus; label: string; tone: string }[] = [
  { id: 'todo', label: 'To do', tone: 'neutral' },
  { id: 'in_progress', label: 'In progress', tone: 'info' },
  { id: 'in_review', label: 'In review', tone: 'warning' },
  { id: 'done', label: 'Done', tone: 'success' },
]

export const PRIORITIES: { id: Priority; label: string; tone: string }[] = [
  { id: 'low', label: 'Low', tone: 'neutral' },
  { id: 'medium', label: 'Medium', tone: 'info' },
  { id: 'high', label: 'High', tone: 'warning' },
  { id: 'urgent', label: 'Urgent', tone: 'danger' },
]

export const ITEM_TYPES: { id: ItemType; label: string }[] = [
  { id: 'story', label: 'Story' },
  { id: 'task', label: 'Task' },
  { id: 'bug', label: 'Bug' },
  { id: 'epic', label: 'Epic' },
]

export const CEREMONY_TYPES: { id: CeremonyType; label: string; minutes: number }[] = [
  { id: 'planning', label: 'Sprint planning', minutes: 120 },
  { id: 'standup', label: 'Daily stand-up', minutes: 15 },
  { id: 'refinement', label: 'Backlog refinement', minutes: 60 },
  { id: 'review', label: 'Sprint review', minutes: 60 },
  { id: 'retrospective', label: 'Retrospective', minutes: 60 },
]

/** Fibonacci-style estimates offered in pickers; any 0-100 value is accepted. */
export const POINT_SCALE = [0, 1, 2, 3, 5, 8, 13, 21]

export const PAGE_SIZE = 50

export const statusLabel = (id: string) => STATUSES.find((s) => s.id === id)?.label ?? id
export const priorityLabel = (id: string) => PRIORITIES.find((p) => p.id === id)?.label ?? id
export const typeLabel = (id: string) => ITEM_TYPES.find((t) => t.id === id)?.label ?? id
export const ceremonyLabel = (id: string) => CEREMONY_TYPES.find((c) => c.id === id)?.label ?? id
