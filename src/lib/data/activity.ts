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
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage'
import { db, firebase } from '../firebase'
import type { ActionItem, Ceremony, CeremonyType } from '../types'
import { attachmentsCol, commentsCol } from './items'
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

/* ------------------------------------------------------------ attachments */

export const attachmentsQuery = (orgId: string, itemId: string) => query(attachmentsCol(orgId, itemId), orderBy('uploadedAt', 'desc'), limit(50))

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export function uploadAttachment(orgId: string, itemId: string, file: File, uid: string, onProgress?: (fraction: number) => void) {
  if (file.size > MAX_ATTACHMENT_BYTES) return Promise.reject(new Error('Files can be at most 10 MB.'))
  const meta = doc(attachmentsCol(orgId, itemId))
  const path = `orgs/${orgId}/items/${itemId}/${meta.id}`
  const task = uploadBytesResumable(storageRef(firebase().storage, path), file, {
    contentType: file.type || 'application/octet-stream',
    contentDisposition: `attachment; filename="${encodeURIComponent(file.name)}"`,
    customMetadata: { uploadedBy: uid, name: file.name },
  })
  return new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (s) => onProgress?.(s.bytesTransferred / Math.max(1, s.totalBytes)),
      reject,
      () => {
        setDoc(meta, { name: file.name.slice(0, 200), path, size: file.size, contentType: file.type || 'application/octet-stream', uploadedBy: uid, uploadedAt: serverTimestamp() })
          .then(resolve)
          .catch(reject)
      },
    )
  })
}

export const attachmentUrl = (path: string) => getDownloadURL(storageRef(firebase().storage, path))

export async function deleteAttachment(orgId: string, itemId: string, attachmentId: string, path: string) {
  await deleteObject(storageRef(firebase().storage, path)).catch((err) => {
    if (err?.code !== 'storage/object-not-found') throw err
  })
  await deleteDoc(doc(attachmentsCol(orgId, itemId), attachmentId))
}

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
