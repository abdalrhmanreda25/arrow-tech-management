import type { Timestamp } from 'firebase/firestore'
import type { MemberCapacity } from '@domain/capacity'
import type { ItemStatus, ItemType, Priority, Role, SprintEventType, SprintStats, SprintStatus } from '@domain/types'

export type { ItemStatus, ItemType, Priority, Role, SprintStatus, SprintStats }

export interface WithId {
  id: string
}

export interface Membership extends WithId {
  uid: string
  orgId: string
  orgName: string
  role: Role
  status: 'active'
  displayName: string
  email: string
  photoURL?: string | null
  title?: string
  joinedAt?: Timestamp
}

export interface Org extends WithId {
  name: string
  description?: string
  timeZone: string
  ownerId: string
  memberCount: number
  logoPath?: string | null
  createdAt?: Timestamp
}

export interface BoardSettings {
  wipLimits?: Partial<Record<ItemStatus, number>>
  swimlanes?: 'none' | 'assignee' | 'epic'
}

export interface Project extends WithId {
  name: string
  key: string
  description?: string
  teamId?: string | null
  leadId?: string | null
  status: 'planned' | 'active' | 'on_hold' | 'completed'
  archived?: boolean
  startDate?: string | null
  targetDate?: string | null
  itemSeq: number
  activeSprintId: string | null
  board?: BoardSettings
  color?: string
  createdAt?: Timestamp
}

export interface Team extends WithId {
  name: string
  description?: string
  memberIds: string[]
  leadId?: string | null
  color?: string
}

export interface Item extends WithId {
  projectId: string
  key: string
  seq: number
  type: ItemType
  title: string
  description?: string
  status: ItemStatus
  priority: Priority
  storyPoints: number | null
  assigneeId: string | null
  reporterId?: string | null
  epicId: string | null
  parentId?: string | null
  sprintId: string | null
  teamId?: string | null
  labels?: string[]
  rank: number
  boardRank?: number
  dueDate?: string | null
  startDate?: string | null
  targetDate?: string | null
  color?: string | null
  carryoverCount?: number
  lastCarriedOverFrom?: string | null
  completedAt?: Timestamp | null
  version: number
  createdAt?: Timestamp
  createdBy: string
  updatedAt?: Timestamp
  updatedBy: string
}

export interface Sprint extends WithId {
  projectId: string
  name: string
  goal?: string
  status: SprintStatus
  startDate: string
  endDate: string
  capacity?: Record<string, MemberCapacity>
  stats?: SprintStats
  historyComplete?: boolean
  carryover?: { mode: 'backlog' | 'sprint'; targetSprintId: string | null; itemIds: string[] }
  startedAt?: Timestamp
  completedAt?: Timestamp
  createdAt?: Timestamp
}

export interface SprintEventDoc extends WithId {
  type: SprintEventType
  at: Timestamp
  actorId: string | null
  itemId: string | null
  itemKey?: string | null
  itemTitle?: string
  scopeDelta: number
  countDelta: number
  completedDelta: number
  completedCountDelta: number
  scopeAfter?: number
  completedAfter?: number
  before?: number | string | null
  after?: number | string | null
}

export interface SnapshotItem {
  id: string
  key: string | null
  title: string
  type: ItemType
  status: ItemStatus
  storyPoints: number
  assigneeId: string | null
}

export interface ActionItem {
  text: string
  done: boolean
  ownerId?: string | null
}

export type CeremonyType = 'planning' | 'standup' | 'review' | 'retrospective' | 'refinement'

export interface Ceremony extends WithId {
  sprintId: string | null
  projectId: string
  type: CeremonyType
  title: string
  scheduledAt: Timestamp
  durationMinutes?: number
  notes?: string
  decisions?: string
  actionItems?: ActionItem[]
  attendeeIds?: string[]
  status: 'scheduled' | 'held' | 'cancelled'
  createdBy: string
}

export interface Comment extends WithId {
  text: string
  authorId: string
  authorName: string
  createdAt?: Timestamp
  editedAt?: Timestamp
}

export interface Attachment extends WithId {
  name: string
  path: string
  size: number
  contentType: string
  uploadedBy: string
  uploadedAt?: Timestamp
}

export interface AppNotification extends WithId {
  recipientId: string
  type: string
  title: string
  body?: string
  link?: string | null
  actorId?: string | null
  readAt: Timestamp | null
  createdAt?: Timestamp
}

export interface AuditLog extends WithId {
  action: string
  actorId: string | null
  targetType: string
  targetId: string | null
  details?: Record<string, unknown>
  at?: Timestamp
}

export interface Invite extends WithId {
  email: string
  role: Role
  status: 'pending' | 'accepted' | 'revoked'
  invitedBy: string
  invitedByName?: string
  createdAt?: Timestamp
  expiresAt?: Timestamp
}
