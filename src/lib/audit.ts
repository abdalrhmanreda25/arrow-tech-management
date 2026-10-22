import { doc, serverTimestamp, type DocumentReference } from 'firebase/firestore'
import { orgCol } from './data/refs'

/** The slice of Transaction and WriteBatch these helpers need. */
interface Writer {
  set(ref: DocumentReference, data: Record<string, unknown>): unknown
}

/**
 * Appends an audit entry in the same batch or transaction as the change it
 * describes. Rules stamp actor and time and make entries immutable.
 */
export function stageAudit(
  w: Writer,
  orgId: string,
  uid: string,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown> = {},
) {
  w.set(doc(orgCol(orgId, 'auditLogs')), { action, actorId: uid, targetType, targetId, details, at: serverTimestamp() })
}

export function stageNotification(
  w: Writer,
  orgId: string,
  n: { recipientId: string; actorId: string; type: string; title: string; body?: string; link?: string | null },
) {
  w.set(doc(orgCol(orgId, 'notifications')), {
    recipientId: n.recipientId,
    type: n.type,
    title: n.title,
    body: n.body ?? '',
    link: n.link ?? null,
    actorId: n.actorId,
    readAt: null,
    createdAt: serverTimestamp(),
  })
}
