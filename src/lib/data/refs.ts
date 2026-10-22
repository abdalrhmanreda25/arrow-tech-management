import { collection, doc, type DocumentData, type DocumentSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export const orgDoc = (orgId: string) => doc(db(), 'orgs', orgId)
export const orgCol = (orgId: string, name: string) => collection(db(), 'orgs', orgId, name)
export const orgItem = (orgId: string, name: string, id: string) => doc(db(), 'orgs', orgId, name, id)

export function withId<T>(snap: DocumentSnapshot<DocumentData>): T | null {
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null
}
