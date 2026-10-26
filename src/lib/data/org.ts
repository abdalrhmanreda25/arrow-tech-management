import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import { stageAudit } from '../audit'
import type { BoardSettings, Membership, Project, Team } from '../types'
import { orgCol, orgDoc, orgItem } from './refs'

/** Every org the user belongs to, from their own member docs (one query, any number of orgs). */
export const myMembershipsQuery = (uid: string) => query(collectionGroup(db(), 'members'), where('uid', '==', uid), limit(50))

export const membersQuery = (orgId: string) => query(orgCol(orgId, 'members'), limit(500))

export const pendingInvitesQuery = (orgId: string) => query(orgCol(orgId, 'invites'), where('status', '==', 'pending'), limit(100))

/** Saves org settings; a rename also refreshes the name cached on every membership. */
export async function updateOrg(orgId: string, patch: { name?: string; description?: string; timeZone?: string }, uid: string) {
  const current = await getDoc(orgDoc(orgId))
  const renamed = patch.name !== undefined && patch.name !== current.get('name')
  const members = renamed ? await getDocs(membersQuery(orgId)) : null
  const batch = writeBatch(db())
  batch.update(orgDoc(orgId), { ...patch, updatedAt: serverTimestamp(), updatedBy: uid })
  members?.forEach((m) => batch.update(m.ref, { orgName: patch.name }))
  if (renamed) stageAudit(batch, orgId, uid, 'org.renamed', 'org', orgId, { from: current.get('name'), to: patch.name })
  await batch.commit()
}

/* ---------------------------------------------------------------- profile */

export async function ensureProfile(user: User) {
  const ref = doc(db(), 'users', user.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return snap.data()
  const profile = {
    displayName: (user.displayName || (user.email ?? '').split('@')[0] || 'New user').slice(0, 80),
    email: (user.email ?? '').toLowerCase(),
    photoURL: user.photoURL ?? null,
    title: '',
    createdAt: serverTimestamp(),
  }
  await setDoc(ref, profile)
  return profile
}

/** Updates the profile and the copy cached on each membership, in one batch. */
export async function updateMyProfile(uid: string, memberships: Membership[], patch: { displayName: string; title?: string; photoURL?: string | null }) {
  const batch = writeBatch(db())
  batch.update(doc(db(), 'users', uid), { ...patch, updatedAt: serverTimestamp() })
  for (const m of memberships) {
    batch.update(orgItem(m.orgId, 'members', uid), { displayName: patch.displayName, title: patch.title ?? '', ...(patch.photoURL !== undefined ? { photoURL: patch.photoURL } : {}) })
  }
  await batch.commit()
}

/* --------------------------------------------------------------- projects */

/**
 * Projects the user may see: all of them for managers and above, otherwise
 * only those listing `assignedTo` in memberIds (firestore.rules allows no more).
 * The assigned query is unordered to avoid a composite index; sort by name client-side.
 */
export const projectsQuery = (orgId: string, assignedTo: string | null = null) =>
  assignedTo
    ? query(orgCol(orgId, 'projects'), where('memberIds', 'array-contains', assignedTo), limit(200))
    : query(orgCol(orgId, 'projects'), orderBy('name'), limit(200))

export interface ProjectInput {
  name: string
  key: string
  description?: string
  teamId?: string | null
  leadId?: string | null
  status?: Project['status']
  startDate?: string | null
  targetDate?: string | null
  color?: string
  memberIds?: string[]
}

export const normaliseKey = (key: string) => key.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)

export async function createProject(orgId: string, input: ProjectInput, uid: string) {
  const key = normaliseKey(input.key)
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new Error('Keys are 2-10 letters or digits and start with a letter.')
  const ref = orgItem(orgId, 'projects', key)
  if ((await getDoc(ref)).exists()) throw new Error(`The key ${key} is already used by another project.`)
  const batch = writeBatch(db())
  batch.set(ref, {
    name: input.name.trim(),
    key,
    description: input.description ?? '',
    teamId: input.teamId ?? null,
    leadId: input.leadId ?? null,
    status: input.status ?? 'active',
    archived: false,
    startDate: input.startDate ?? null,
    targetDate: input.targetDate ?? null,
    itemSeq: 0,
    activeSprintId: null,
    board: { swimlanes: 'none', wipLimits: {} },
    color: input.color ?? '#f4520b',
    memberIds: input.memberIds ?? [],
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  stageAudit(batch, orgId, uid, 'project.created', 'project', key, { name: input.name.trim() })
  await batch.commit()
  return key
}

export async function updateProject(orgId: string, projectId: string, patch: Partial<Omit<ProjectInput, 'key'>> & { archived?: boolean; board?: BoardSettings }, uid: string) {
  const batch = writeBatch(db())
  batch.update(orgItem(orgId, 'projects', projectId), { ...patch, updatedAt: serverTimestamp(), updatedBy: uid })
  if (patch.archived !== undefined) stageAudit(batch, orgId, uid, patch.archived ? 'project.archived' : 'project.restored', 'project', projectId)
  await batch.commit()
}

/* ------------------------------------------------------------------ teams */

export const teamsQuery = (orgId: string) => query(orgCol(orgId, 'teams'), orderBy('name'), limit(100))

export async function saveTeam(orgId: string, team: Partial<Team> & { name: string; memberIds: string[] }, uid: string) {
  const data = {
    name: team.name.trim(),
    description: team.description ?? '',
    memberIds: team.memberIds,
    leadId: team.leadId ?? null,
    color: team.color ?? '#f4520b',
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }
  if (team.id) {
    await updateDoc(orgItem(orgId, 'teams', team.id), data)
    return team.id
  }
  const ref = doc(orgCol(orgId, 'teams'))
  const batch = writeBatch(db())
  batch.set(ref, { ...data, createdAt: serverTimestamp(), createdBy: uid })
  stageAudit(batch, orgId, uid, 'team.created', 'team', ref.id, { name: data.name })
  await batch.commit()
  return ref.id
}

export async function deleteTeam(orgId: string, teamId: string, uid: string) {
  const batch = writeBatch(db())
  batch.delete(orgItem(orgId, 'teams', teamId))
  stageAudit(batch, orgId, uid, 'team.deleted', 'team', teamId)
  await batch.commit()
}

/* -------------------------------------------------------------- audit log */

export const auditQuery = (orgId: string) => query(orgCol(orgId, 'auditLogs'), orderBy('at', 'desc'))

export async function getAllMembers(orgId: string) {
  return (await getDocs(membersQuery(orgId))).docs.map((d) => ({ id: d.id, ...d.data() }) as Membership)
}
