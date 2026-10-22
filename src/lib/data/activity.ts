import {
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  limit,
  runTransaction,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { ActionItem, Ceremony, CeremonyType } from '../types'
import { commentsCol, imagesCol, linksCol } from './items'
import { stageNotification } from '../audit'
import { orgCol, orgItem } from './refs'

/* --------------------------------------------------------------- comments */

export const commentsQuery = (orgId: string, itemId: string) => query(commentsCol(orgId, itemId), orderBy('createdAt'), limit(200))

/** Adds a comment and notifies the item's assignee and creator (if still members). */
export async function addComment(orgId: string, itemId: string, text: string, user: { uid: string; displayName: string }) {
  const body = text.trim()
  await runTransaction(db(), async (tx) => {
    const item = await tx.get(orgItem(orgId, 'items', itemId))
    if (!item.exists()) throw new Error('This item was deleted.')
    const recipients = [...new Set([item.get('assigneeId'), item.get('createdBy')])].filter((uid): uid is string => Boolean(uid) && uid !== user.uid)
    const members = []
    for (const uid of recipients) if ((await tx.get(orgItem(orgId, 'members', uid))).exists()) members.push(uid)
    tx.set(doc(commentsCol(orgId, itemId)), { text: body, authorId: user.uid, authorName: user.displayName, createdAt: serverTimestamp() })
    const label = [item.get('key'), item.get('title')].filter(Boolean).join(' ')
    for (const uid of members) {
      stageNotification(tx, orgId, { recipientId: uid, actorId: user.uid, type: 'comment', title: `New comment on ${label}`, body: body.slice(0, 160), link: `/item/?id=${itemId}` })
    }
  })
}

export const deleteComment = (orgId: string, itemId: string, commentId: string) => deleteDoc(doc(commentsCol(orgId, itemId), commentId))

/* ------------------------------------------------------------------ links */

export const linksQuery = (orgId: string, itemId: string) => query(linksCol(orgId, itemId), orderBy('addedAt', 'desc'), limit(40))

/** Only http(s) links are accepted, so a stored link can never run script when opened. */
export function normaliseUrl(raw: string) {
  const text = raw.trim()
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`
  const url = new URL(withScheme)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web links (https://) can be added.')
  return url.toString()
}

export async function addLink(orgId: string, itemId: string, input: { title: string; url: string }, uid: string) {
  const url = normaliseUrl(input.url)
  const title = (input.title.trim() || new URL(url).hostname).slice(0, 200)
  await addDoc(linksCol(orgId, itemId), { title, url, addedBy: uid, addedAt: serverTimestamp() })
}

export const deleteLink = (orgId: string, itemId: string, linkId: string) => deleteDoc(doc(linksCol(orgId, itemId), linkId))

/* ------------------------------------------------------------ screenshots */

export const imagesQuery = (orgId: string, itemId: string, n = 6) => query(imagesCol(orgId, itemId), orderBy('addedAt'), limit(n))

export async function addImage(orgId: string, itemId: string, image: { name: string; dataUrl: string; width: number; height: number }, uid: string) {
  await addDoc(imagesCol(orgId, itemId), { ...image, name: image.name.slice(0, 200) || 'Screenshot', addedBy: uid, addedAt: serverTimestamp() })
}

export const deleteImage = (orgId: string, itemId: string, imageId: string) => deleteDoc(doc(imagesCol(orgId, itemId), imageId))

/* ------------------------------------------------------------- ceremonies */

export const sprintCeremoniesQuery = (orgId: string, sprintId: string) =>
  query(orgCol(orgId, 'ceremonies'), where('sprintId', '==', sprintId), orderBy('scheduledAt'), limit(100))

export const ceremoniesBetweenQuery = (orgId: string, from: Date, to: Date) =>
  query(orgCol(orgId, 'ceremonies'), where('scheduledAt', '>=', Timestamp.fromDate(from)), where('scheduledAt', '<=', Timestamp.fromDate(to)), orderBy('scheduledAt'), limit(300))

export interface CeremonyInput {
  sprintId: string | null
  projectId: string
  type: CeremonyType
  title: string
  scheduledAt: Date
  durationMinutes: number
  notes?: string
  decisions?: string
  actionItems?: ActionItem[]
  attendeeIds?: string[]
  status?: Ceremony['status']
}

export async function createCeremony(orgId: string, input: CeremonyInput, uid: string) {
  await addDoc(orgCol(orgId, 'ceremonies'), {
    ...input,
    scheduledAt: Timestamp.fromDate(input.scheduledAt),
    notes: input.notes ?? '',
    decisions: input.decisions ?? '',
    actionItems: input.actionItems ?? [],
    attendeeIds: input.attendeeIds ?? [],
    status: input.status ?? 'scheduled',
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}

export async function updateCeremony(orgId: string, id: string, patch: Partial<Omit<CeremonyInput, 'sprintId' | 'projectId'>>, uid: string) {
  const data: Record<string, unknown> = { ...patch, updatedAt: serverTimestamp(), updatedBy: uid }
  if (patch.scheduledAt) data.scheduledAt = Timestamp.fromDate(patch.scheduledAt)
  await updateDoc(orgItem(orgId, 'ceremonies', id), data)
}

export const deleteCeremony = (orgId: string, id: string) => deleteDoc(orgItem(orgId, 'ceremonies', id))

/* ---------------------------------------------------------- notifications */

export const notificationsQuery = (orgId: string, uid: string, n = 30) =>
  query(orgCol(orgId, 'notifications'), where('recipientId', '==', uid), orderBy('createdAt', 'desc'), limit(n))

/** Only unread docs are read, so the badge stays cheap however long the history is. */
export const unreadQuery = (orgId: string, uid: string) =>
  query(orgCol(orgId, 'notifications'), where('recipientId', '==', uid), where('readAt', '==', null), limit(99))

export const markRead = (orgId: string, id: string) => updateDoc(orgItem(orgId, 'notifications', id), { readAt: serverTimestamp() })

export async function markAllRead(orgId: string, uid: string) {
  const unread = await getDocs(unreadQuery(orgId, uid))
  const batch = writeBatch(db())
  unread.forEach((d) => batch.update(d.ref, { readAt: serverTimestamp() }))
  await batch.commit()
  return unread.size
}

export const deleteNotification = (orgId: string, id: string) => deleteDoc(orgItem(orgId, 'notifications', id))
