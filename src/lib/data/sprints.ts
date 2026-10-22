import {
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  collection,
  doc,
} from 'firebase/firestore'
import type { MemberCapacity } from '@domain/capacity'
import type { SprintEvent } from '@domain/types'
import { db } from '../firebase'
import { stageAudit } from '../audit'
import type { SnapshotItem, Sprint, SprintEventDoc, SprintStats } from '../types'
import { orgCol, orgItem } from './refs'

export const sprintsQuery = (orgId: string, projectId: string) =>
  query(orgCol(orgId, 'sprints'), where('projectId', '==', projectId), orderBy('startDate', 'desc'), limit(60))

export const completedSprintsQuery = (orgId: string, projectId: string, n = 12) =>
  query(orgCol(orgId, 'sprints'), where('projectId', '==', projectId), where('status', '==', 'completed'), orderBy('completedAt', 'desc'), limit(n))

export interface SprintInput {
  projectId: string
  name: string
  goal?: string
  startDate: string
  endDate: string
}

export async function createSprint(orgId: string, input: SprintInput, uid: string) {
  const ref = doc(orgCol(orgId, 'sprints'))
  const batch = writeBatch(db())
  batch.set(ref, {
    projectId: input.projectId,
    name: input.name.trim(),
    goal: input.goal?.trim() ?? '',
    status: 'planned',
    startDate: input.startDate,
    endDate: input.endDate,
    capacity: {},
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  stageAudit(batch, orgId, uid, 'sprint.created', 'sprint', ref.id, { name: input.name.trim(), projectId: input.projectId })
  await batch.commit()
  return ref.id
}

export async function updateSprint(
  orgId: string,
  sprintId: string,
  patch: Partial<{ name: string; goal: string; startDate: string; endDate: string; capacity: Record<string, MemberCapacity> }>,
  uid: string,
) {
  await updateDoc(orgItem(orgId, 'sprints', sprintId), { ...patch, updatedAt: serverTimestamp(), updatedBy: uid })
}

/** Deletes a planned sprint and returns its items to the backlog in the same batch. */
export async function deleteSprint(orgId: string, sprintId: string, uid: string) {
  const items = await getDocs(query(orgCol(orgId, 'items'), where('sprintId', '==', sprintId), limit(450)))
  const batch = writeBatch(db())
  items.forEach((d) => batch.update(d.ref, { sprintId: null, version: increment(1), updatedAt: serverTimestamp(), updatedBy: uid }))
  batch.delete(orgItem(orgId, 'sprints', sprintId))
  stageAudit(batch, orgId, uid, 'sprint.deleted', 'sprint', sprintId, { returnedItems: items.size })
  await batch.commit()
}

/** Full event history of one sprint, oldest first. Read on demand for reports. */
export async function getSprintEvents(orgId: string, sprintId: string): Promise<SprintEventDoc[]> {
  const snap = await getDocs(query(collection(db(), 'orgs', orgId, 'sprints', sprintId, 'events'), orderBy('at'), limit(5000)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SprintEventDoc)
}

/** Converts stored events to the plain shape the report maths uses. */
export const toDomainEvents = (events: SprintEventDoc[]): SprintEvent[] =>
  events.map((e) => ({ ...e, at: e.at?.toMillis?.() ?? 0 }))

export interface SprintSnapshot {
  kind: 'start' | 'final'
  stats: SprintStats
  items?: SnapshotItem[]
  completed?: SnapshotItem[]
  incomplete?: SnapshotItem[]
}

export async function getSnapshot(orgId: string, sprintId: string, kind: 'start' | 'final') {
  const snap = await getDoc(doc(db(), 'orgs', orgId, 'sprints', sprintId, 'snapshots', kind))
  return snap.exists() ? (snap.data() as SprintSnapshot) : null
}

export const sortSprints = (list: Sprint[]) => {
  const order = { active: 0, planned: 1, completed: 2 } as const
  return [...list].sort((a, b) => order[a.status] - order[b.status] || (a.status === 'planned' ? a.startDate.localeCompare(b.startDate) : b.startDate.localeCompare(a.startDate)))
}
