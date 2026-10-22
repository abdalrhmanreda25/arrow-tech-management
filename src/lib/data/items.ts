import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type Transaction,
} from 'firebase/firestore'
import { deleteObject, ref as storageRef } from 'firebase/storage'
import { sprintEventsForWrite } from '@domain/events'
import type { SprintItemFields } from '@domain/types'
import { db, firebase } from '../firebase'
import { ConflictError } from '../errors'
import type { Item, ItemStatus, ItemType, Priority } from '../types'
import { orgCol, orgItem, withId } from './refs'

export interface ItemInput {
  projectId: string
  type: ItemType
  title: string
  description?: string
  status?: ItemStatus
  priority?: Priority
  storyPoints?: number | null
  assigneeId?: string | null
  epicId?: string | null
  sprintId?: string | null
  dueDate?: string | null
  startDate?: string | null
  targetDate?: string | null
  labels?: string[]
  color?: string | null
}

type Doc = Record<string, unknown> & SprintItemFields & {
  key?: string
  title?: string
  assigneeId?: string | null
  createdBy?: string
  version?: number
}

/** Sprint ids a write touches that are currently active. Read before any write. */
async function activeSprints(tx: Transaction, orgId: string, ...docs: (Doc | null)[]) {
  const ids = new Set(docs.map((d) => d?.sprintId).filter((id): id is string => Boolean(id)))
  const active = new Set<string>()
  for (const id of ids) {
    const s = await tx.get(orgItem(orgId, 'sprints', id))
    if (s.exists() && s.get('status') === 'active') active.add(id)
  }
  return active
}

/** Members among `uids`; rules only accept notifications for current members. */
async function currentMembers(tx: Transaction, orgId: string, uids: (string | null | undefined)[]) {
  const out = new Set<string>()
  for (const uid of new Set(uids.filter((u): u is string => Boolean(u)))) {
    if ((await tx.get(orgItem(orgId, 'members', uid))).exists()) out.add(uid)
  }
  return out
}

/**
 * Writes the sprint history entry {itemId}-{version} for every active sprint
 * this change moves. firestore.rules refuses the item write without it and
 * recomputes its numbers, so history cannot drift from the items.
 */
function stageHistory(tx: Transaction, orgId: string, itemId: string, before: Doc | null, after: Doc | null, version: number, uid: string, active: Set<string>) {
  const ref = after ?? before
  for (const e of sprintEventsForWrite(before, after)) {
    if (!active.has(e.sprintId)) continue
    tx.set(doc(db(), 'orgs', orgId, 'sprints', e.sprintId, 'events', `${itemId}-${version}`), {
      type: e.type,
      at: serverTimestamp(),
      actorId: uid,
      itemId,
      itemKey: ref?.key ?? null,
      itemTitle: ref?.title ?? '',
      scopeDelta: e.scopeDelta,
      countDelta: e.countDelta,
      completedDelta: e.completedDelta,
      completedCountDelta: e.completedCountDelta,
      before: e.before ?? null,
      after: e.after ?? null,
    })
  }
}

const label = (d: Doc) => [d.key, d.title].filter(Boolean).join(' ')

function stageNotifications(tx: Transaction, orgId: string, itemId: string, before: Doc | null, after: Doc | null, uid: string, members: Set<string>) {
  if (!after) return
  const notify = (recipientId: string, type: string, title: string) =>
    tx.set(doc(orgCol(orgId, 'notifications')), {
      recipientId,
      type,
      title,
      body: '',
      link: `/item/?id=${itemId}`,
      actorId: uid,
      readAt: null,
      createdAt: serverTimestamp(),
    })
  const assignee = after.assigneeId
  if (assignee && assignee !== before?.assigneeId && assignee !== uid && members.has(assignee)) {
    notify(assignee, 'assigned', `You were assigned ${label(after)}`)
  }
  const creator = after.createdBy
  if (before && after.status === 'done' && before.status !== 'done' && creator && creator !== uid && members.has(creator)) {
    notify(creator, 'item_done', `${label(after)} is done`)
  }
}

/**
 * Creates an item and its human key (ARW-42) atomically: the transaction bumps
 * the project's counter and writes the item together, and the rules reject an
 * item whose number does not match the counter. Concurrent creators retry.
 */
export async function createItem(orgId: string, input: ItemInput, uid: string) {
  // A creator that loses the race for an item number can be refused by the
  // rules (stale counter) rather than aborted, so retry a few times with a
  // fresh read before reporting the error.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await createItemOnce(orgId, input, uid)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (attempt >= 4 || (code !== 'permission-denied' && code !== 'aborted')) throw err
      await new Promise((r) => setTimeout(r, 50 * attempt + Math.random() * 100))
    }
  }
}

async function createItemOnce(orgId: string, input: ItemInput, uid: string) {
  const projectRef = orgItem(orgId, 'projects', input.projectId)
  const itemRef = doc(orgCol(orgId, 'items'))
  const now = Date.now()
  return runTransaction(db(), async (tx) => {
    const project = await tx.get(projectRef)
    if (!project.exists()) throw new Error('That project no longer exists.')
    const seq = (project.get('itemSeq') ?? 0) + 1
    const key = `${project.get('key')}-${seq}`
    const data: Doc = {
      projectId: input.projectId,
      key,
      seq,
      type: input.type,
      title: input.title.trim(),
      description: input.description ?? '',
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      storyPoints: input.type === 'epic' ? null : input.storyPoints ?? null,
      assigneeId: input.assigneeId ?? null,
      reporterId: uid,
      epicId: input.type === 'epic' ? null : input.epicId ?? null,
      parentId: null,
      sprintId: input.type === 'epic' ? null : input.sprintId ?? null,
      labels: input.labels ?? [],
      // Epoch ms keeps new items at the end of the backlog without reading it.
      rank: now,
      boardRank: now,
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      color: input.color ?? null,
      carryoverCount: 0,
      version: 1,
      createdBy: uid,
      updatedBy: uid,
    }
    const active = await activeSprints(tx, orgId, data)
    const members = await currentMembers(tx, orgId, [data.assigneeId])
    tx.update(projectRef, { itemSeq: seq })
    tx.set(itemRef, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    stageHistory(tx, orgId, itemRef.id, null, data, 1, uid, active)
    stageNotifications(tx, orgId, itemRef.id, null, data, uid, members)
    return { id: itemRef.id, key }
  })
}

export type ItemPatch = Partial<
  Pick<
    Item,
    | 'title'
    | 'description'
    | 'type'
    | 'status'
    | 'priority'
    | 'storyPoints'
    | 'assigneeId'
    | 'epicId'
    | 'sprintId'
    | 'labels'
    | 'rank'
    | 'boardRank'
    | 'dueDate'
    | 'startDate'
    | 'targetDate'
    | 'color'
  >
>

function normalise(patch: ItemPatch, before: Doc): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch }
  if (patch.status === 'done' && before.status !== 'done') out.completedAt = serverTimestamp()
  else if (patch.status && patch.status !== 'done') out.completedAt = null
  if ((patch.type ?? before.type) === 'epic') out.sprintId = null
  return out
}

/** Reads, checks and writes one item update with its history and notifications. */
async function updateInTx(tx: Transaction, orgId: string, itemId: string, patch: ItemPatch, uid: string, expectedVersion?: number) {
  const ref = orgItem(orgId, 'items', itemId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new Error('This item was deleted.')
  const before = snap.data() as Doc
  const current = before.version as number
  if (expectedVersion !== undefined && current !== expectedVersion) throw new ConflictError()
  const change = normalise(patch, before)
  const version = current + 1
  const after = { ...before, ...change, version } as Doc
  return {
    async read() {
      return {
        active: await activeSprints(tx, orgId, before, after),
        members: await currentMembers(tx, orgId, [after.assigneeId, after.createdBy]),
      }
    },
    write(ctx: { active: Set<string>; members: Set<string> }) {
      tx.update(ref, { ...change, version, updatedAt: serverTimestamp(), updatedBy: uid })
      stageHistory(tx, orgId, itemId, before, after, version, uid, ctx.active)
      stageNotifications(tx, orgId, itemId, before, after, uid, ctx.members)
    },
  }
}

/**
 * Edit with conflict detection: fails with ConflictError when the item has
 * moved past `expectedVersion` since the editor loaded it.
 */
export async function saveItem(orgId: string, itemId: string, expectedVersion: number, patch: ItemPatch, uid: string) {
  await runTransaction(db(), async (tx) => {
    const step = await updateInTx(tx, orgId, itemId, patch, uid, expectedVersion)
    step.write(await step.read())
  })
}

/** Quick change (board drag, status menu, sprint assignment); last write wins on these fields. */
export async function patchItem(orgId: string, itemId: string, patch: ItemPatch, uid: string) {
  await saveItemsInChunks(orgId, [itemId], patch, uid)
}

/** Moves several items (sprint planning). Each chunk is atomic. */
export async function patchItems(orgId: string, itemIds: string[], patch: ItemPatch, uid: string) {
  await saveItemsInChunks(orgId, itemIds, patch, uid)
}

// Rules may read about 20 documents per transaction; each item with sprint
// history costs several, so bulk moves go a few items at a time.
const CHUNK = 4

async function saveItemsInChunks(orgId: string, itemIds: string[], patch: ItemPatch, uid: string) {
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const ids = itemIds.slice(i, i + CHUNK)
    await runTransaction(db(), async (tx) => {
      const steps = []
      for (const id of ids) steps.push(await updateInTx(tx, orgId, id, patch, uid))
      const contexts: { active: Set<string>; members: Set<string> }[] = []
      for (const step of steps) contexts.push(await step.read())
      steps.forEach((step, n) => step.write(contexts[n]))
    })
  }
}

/** Deletes an item with its comments and attachments, recording sprint history and an audit entry. */
export async function deleteItem(orgId: string, itemId: string, uid: string) {
  const [comments, attachments] = await Promise.all([
    getDocs(query(commentsCol(orgId, itemId), limit(450))),
    getDocs(query(attachmentsCol(orgId, itemId), limit(100))),
  ])
  for (const a of attachments.docs) {
    await deleteObject(storageRef(firebase().storage, a.get('path'))).catch((err) => {
      if (err?.code !== 'storage/object-not-found') throw err
    })
  }
  const cleanup = writeBatch(db())
  comments.forEach((c) => cleanup.delete(c.ref))
  attachments.forEach((a) => cleanup.delete(a.ref))
  if (!comments.empty || !attachments.empty) await cleanup.commit()

  const ref = orgItem(orgId, 'items', itemId)
  await runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const before = snap.data() as Doc
    const active = await activeSprints(tx, orgId, before)
    tx.delete(ref)
    stageHistory(tx, orgId, itemId, before, null, (before.version as number) + 1, uid, active)
    tx.set(doc(orgCol(orgId, 'auditLogs')), {
      action: 'item.deleted',
      actorId: uid,
      targetType: 'item',
      targetId: itemId,
      details: { key: before.key ?? null, title: before.title ?? '' },
      at: serverTimestamp(),
    })
  })
}

export async function getItem(orgId: string, itemId: string) {
  return withId<Item>(await getDoc(orgItem(orgId, 'items', itemId)))
}

const items = (orgId: string) => orgCol(orgId, 'items')

/** Product backlog: items of a project not in any sprint, in priority order. */
export const backlogQuery = (orgId: string, projectId: string) =>
  query(items(orgId), where('projectId', '==', projectId), where('sprintId', '==', null), orderBy('rank'))

export const sprintItemsQuery = (orgId: string, sprintId: string) => query(items(orgId), where('sprintId', '==', sprintId), limit(400))

export const epicsQuery = (orgId: string, projectId: string) =>
  query(items(orgId), where('projectId', '==', projectId), where('type', '==', 'epic'), orderBy('rank'), limit(200))

export const epicItemsQuery = (orgId: string, epicId: string) => query(items(orgId), where('epicId', '==', epicId), limit(300))

export const myItemsQuery = (orgId: string, uid: string) =>
  query(items(orgId), where('assigneeId', '==', uid), orderBy('updatedAt', 'desc'), limit(25))

export const projectItemsQuery = (orgId: string, projectId: string) =>
  query(items(orgId), where('projectId', '==', projectId), orderBy('updatedAt', 'desc'))

export const dueItemsQuery = (orgId: string, projectId: string | null, from: string, to: string) =>
  projectId
    ? query(items(orgId), where('projectId', '==', projectId), where('dueDate', '>=', from), where('dueDate', '<=', to), orderBy('dueDate'), limit(300))
    : query(items(orgId), where('dueDate', '>=', from), where('dueDate', '<=', to), orderBy('dueDate'), limit(300))

export const chronicCarryoverQuery = (orgId: string, projectId: string) =>
  query(items(orgId), where('projectId', '==', projectId), where('carryoverCount', '>=', 2), orderBy('carryoverCount', 'desc'), limit(20))

export async function getSprintItems(orgId: string, sprintId: string) {
  const snap = await getDocs(sprintItemsQuery(orgId, sprintId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Item)
}

export const commentsCol = (orgId: string, itemId: string) => collection(db(), 'orgs', orgId, 'items', itemId, 'comments')
export const attachmentsCol = (orgId: string, itemId: string) => collection(db(), 'orgs', orgId, 'items', itemId, 'attachments')
