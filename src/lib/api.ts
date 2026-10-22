'use client'

import {
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { canAssignRole, canRemoveMember, ROLE_LABELS } from '@domain/roles'
import { planCompletion, startStats, validateSprintDates } from '@domain/sprint'
import type { Role, SprintItemFields, SprintStats } from '@domain/types'
import { auth, db } from './firebase'
import { orgCol, orgDoc, orgItem } from './data/refs'
import { getSprintEvents } from './data/sprints'
import { stageAudit, stageNotification } from './audit'

/**
 * Organization, membership, invite and sprint lifecycle operations, all on the
 * Firebase client SDK. Each one runs as a transaction or batch, and
 * firestore.rules re-checks role, ownership and state for every document it
 * touches, so a modified client cannot skip the checks made here.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Rules cap expiry at request.time + 7 days; stay inside it despite clock skew.
const CLOCK_MARGIN_MS = 60 * 60 * 1000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

class OpError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'OpError'
  }
}

/** Current user with a fresh ID token, so a just-verified email reaches the rules. */
async function actor(refresh = false) {
  const user = auth().currentUser
  if (!user) throw new OpError('unauthenticated', 'Sign in first.')
  if (refresh) {
    await user.reload()
    await user.getIdToken(true)
  }
  return {
    uid: user.uid,
    email: (user.email ?? '').toLowerCase(),
    emailVerified: user.emailVerified,
    name: user.displayName || (user.email ?? '').split('@')[0] || 'Member',
  }
}

function randomId(bytes = 32) {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface MemberDoc {
  uid: string
  role: Role
  email?: string
  displayName?: string
}

async function createOrganization({ name, timeZone }: { name: string; timeZone?: string }) {
  const me = await actor()
  const clean = name.trim()
  if (clean.length < 2 || clean.length > 80) throw new OpError('invalid-argument', 'Organization name must be 2-80 characters.')
  const orgRef = orgDoc(randomId(15))
  const batch = writeBatch(db())
  batch.set(orgRef, {
    name: clean,
    description: '',
    timeZone: timeZone || 'UTC',
    ownerId: me.uid,
    ownerIds: [me.uid],
    createdAt: serverTimestamp(),
    createdBy: me.uid,
  })
  batch.set(orgItem(orgRef.id, 'members', me.uid), {
    uid: me.uid,
    orgId: orgRef.id,
    orgName: clean,
    role: 'owner',
    status: 'active',
    email: me.email,
    displayName: me.name.slice(0, 80),
    joinedAt: serverTimestamp(),
  })
  stageAudit(batch, orgRef.id, me.uid, 'org.created', 'org', orgRef.id, { name: clean })
  await batch.commit()
  return { orgId: orgRef.id }
}

async function createInvite({ orgId, email, role }: { orgId: string; email: string; role: Role }) {
  const me = await actor()
  const target = email.trim().toLowerCase()
  if (!EMAIL.test(target)) throw new OpError('invalid-argument', 'Enter a valid email address.')
  const [mine, org, existing] = await Promise.all([
    getDoc(orgItem(orgId, 'members', me.uid)),
    getDoc(orgDoc(orgId)),
    getDocs(query(orgCol(orgId, 'members'), where('email', '==', target), limit(1))),
  ])
  const myRole = mine.get('role') as Role | undefined
  if (!myRole) throw new OpError('permission-denied', 'You are not a member of this organization.')
  const check = canAssignRole(myRole, null, role)
  if (!check.ok) throw new OpError('permission-denied', check.reason)
  if (role === 'owner') throw new OpError('permission-denied', 'Invite as admin, then promote to owner from the member list.')
  if (!existing.empty) throw new OpError('already-exists', 'That person is already a member.')

  // The invite id is the secret in the link: 32 random bytes.
  const inviteId = randomId(32)
  const batch = writeBatch(db())
  batch.set(orgItem(orgId, 'invites', inviteId), {
    email: target,
    role,
    orgId,
    orgName: org.get('name') ?? '',
    status: 'pending',
    invitedBy: me.uid,
    invitedByName: mine.get('displayName') ?? me.name,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS - CLOCK_MARGIN_MS),
  })
  stageAudit(batch, orgId, me.uid, 'invite.created', 'invite', null, { email: target, role })
  await batch.commit()
  return { inviteId, token: inviteId }
}

async function revokeInvite({ orgId, inviteId }: { orgId: string; inviteId: string }) {
  const me = await actor()
  const ref = orgItem(orgId, 'invites', inviteId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new OpError('not-found', 'Invite not found.')
  const batch = writeBatch(db())
  batch.update(ref, { status: 'revoked', revokedBy: me.uid, revokedAt: serverTimestamp() })
  stageAudit(batch, orgId, me.uid, 'invite.revoked', 'invite', null, { email: snap.get('email') })
  await batch.commit()
  return { ok: true as const }
}

async function previewInvite({ orgId, inviteId }: { orgId: string; inviteId: string; token?: string }) {
  await actor()
  let snap
  try {
    snap = await getDoc(orgItem(orgId, 'invites', inviteId))
  } catch (err) {
    if ((err as { code?: string }).code === 'permission-denied') {
      throw new OpError('permission-denied', 'This invite is for a different email address.')
    }
    throw err
  }
  if (!snap.exists()) throw new OpError('not-found', 'This invite link is invalid.')
  const expiresAt = snap.get('expiresAt') as Timestamp
  return {
    orgName: (snap.get('orgName') as string) ?? '',
    role: snap.get('role') as Role,
    email: snap.get('email') as string,
    status: snap.get('status') as string,
    expired: expiresAt.toMillis() < Date.now(),
  }
}

async function acceptInvite({ orgId, inviteId }: { orgId: string; inviteId: string; token?: string }) {
  const me = await actor()
  const inviteRef = orgItem(orgId, 'invites', inviteId)
  return runTransaction(db(), async (tx) => {
    const invite = await tx.get(inviteRef)
    if (!invite.exists()) throw new OpError('not-found', 'This invite link is invalid.')
    if (invite.get('status') === 'accepted' && invite.get('acceptedBy') === me.uid) return { orgId, alreadyMember: true }
    if (invite.get('status') !== 'pending') throw new OpError('failed-precondition', `This invite was ${invite.get('status')}.`)
    if ((invite.get('expiresAt') as Timestamp).toMillis() < Date.now()) throw new OpError('failed-precondition', 'This invite has expired. Ask for a new one.')
    tx.set(orgItem(orgId, 'members', me.uid), {
      uid: me.uid,
      orgId,
      orgName: invite.get('orgName') ?? '',
      role: invite.get('role'),
      status: 'active',
      email: me.email,
      displayName: me.name.slice(0, 80),
      joinedAt: serverTimestamp(),
      inviteId,
      invitedBy: invite.get('invitedBy'),
    })
    tx.update(inviteRef, { status: 'accepted', acceptedBy: me.uid, acceptedAt: serverTimestamp() })
    stageAudit(tx, orgId, me.uid, 'invite.accepted', 'member', me.uid, { email: me.email, role: invite.get('role') })
    stageNotification(tx, orgId, {
      recipientId: invite.get('invitedBy'),
      actorId: me.uid,
      type: 'invite_accepted',
      title: `${me.name} joined the organization`,
      link: '/members/',
    })
    return { orgId, alreadyMember: false }
  })
}

/**
 * Changes another member's role. Owners are mirrored in org.ownerIds in the
 * same transaction; rules keep the two equal and never let the list empty,
 * so two owners demoting each other at once cannot leave the org ownerless.
 */
async function changeMemberRole({ orgId, uid, role }: { orgId: string; uid: string; role: Role }) {
  const me = await actor()
  if (uid === me.uid) throw new OpError('permission-denied', 'You cannot change your own role.')
  await runTransaction(db(), async (tx) => {
    const [mine, target, org] = await Promise.all([
      tx.get(orgItem(orgId, 'members', me.uid)),
      tx.get(orgItem(orgId, 'members', uid)),
      tx.get(orgDoc(orgId)),
    ])
    if (!mine.exists()) throw new OpError('permission-denied', 'You are not a member of this organization.')
    if (!target.exists()) throw new OpError('not-found', 'That person is not a member.')
    const t = target.data() as MemberDoc
    if (t.role === role) return
    const check = canAssignRole((mine.data() as MemberDoc).role, t.role, role)
    if (!check.ok) throw new OpError('permission-denied', check.reason)
    const owners = (org.get('ownerIds') as string[]) ?? []
    let nextOwners = owners
    if (t.role === 'owner' && role !== 'owner') {
      nextOwners = owners.filter((o) => o !== uid)
      if (!nextOwners.length) throw new OpError('failed-precondition', 'An organization needs at least one owner.')
    } else if (role === 'owner' && t.role !== 'owner') {
      nextOwners = [...owners, uid]
    }
    tx.update(target.ref, { role, roleUpdatedBy: me.uid, roleUpdatedAt: serverTimestamp() })
    if (nextOwners !== owners) tx.update(org.ref, { ownerIds: nextOwners, ownerChange: uid })
    stageAudit(tx, orgId, me.uid, 'member.role_changed', 'member', uid, { from: t.role, to: role })
    stageNotification(tx, orgId, {
      recipientId: uid,
      actorId: me.uid,
      type: 'role_changed',
      title: `Your role is now ${ROLE_LABELS[role]}`,
      link: '/members/',
    })
  })
  return { ok: true as const }
}

/** Removes a member, or lets a member leave. The last owner can do neither. */
async function removeMember({ orgId, uid }: { orgId: string; uid: string }) {
  const me = await actor()
  const leaving = uid === me.uid
  const mine = await getDoc(orgItem(orgId, 'members', me.uid))
  const myRole = mine.get('role') as Role | undefined
  if (!myRole) throw new OpError('permission-denied', 'You are not a member of this organization.')
  // Team rosters are a manager task; someone leaving on their own skips them.
  const teams = myRole === 'viewer' || myRole === 'member' ? null : await getDocs(query(orgCol(orgId, 'teams'), where('memberIds', 'array-contains', uid)))

  await runTransaction(db(), async (tx) => {
    const [target, org] = await Promise.all([tx.get(orgItem(orgId, 'members', uid)), tx.get(orgDoc(orgId))])
    if (!target.exists()) throw new OpError('not-found', 'That person is not a member.')
    const t = target.data() as MemberDoc
    if (!leaving) {
      const check = canRemoveMember(myRole, t.role)
      if (!check.ok) throw new OpError('permission-denied', check.reason)
    }
    const owners = (org.get('ownerIds') as string[]) ?? []
    if (t.role === 'owner') {
      const rest = owners.filter((o) => o !== uid)
      if (!rest.length) throw new OpError('failed-precondition', 'Make someone else an owner before the last owner leaves.')
      tx.update(org.ref, { ownerIds: rest, ownerChange: uid })
    }
    teams?.forEach((team) => {
      const ids = (team.get('memberIds') as string[]).filter((m) => m !== uid)
      tx.update(team.ref, { memberIds: ids, updatedAt: serverTimestamp(), updatedBy: me.uid })
    })
    tx.delete(target.ref)
    stageAudit(tx, orgId, me.uid, leaving ? 'member.left' : 'member.removed', 'member', uid, { role: t.role, email: t.email ?? null })
  })
  return { ok: true as const }
}

const itemsOf = async (orgId: string, sprintId: string) =>
  (await getDocs(query(orgCol(orgId, 'items'), where('sprintId', '==', sprintId), limit(401)))).docs

const snapshotItem = (id: string, d: Record<string, unknown>) => ({
  id,
  key: d.key ?? null,
  title: d.title ?? '',
  type: d.type ?? 'task',
  status: d.status ?? 'todo',
  storyPoints: typeof d.storyPoints === 'number' ? d.storyPoints : 0,
  assigneeId: d.assigneeId ?? null,
})

/**
 * Starts a planned sprint. The project document is read and written in the
 * same transaction, and rules require its activeSprintId to point at no
 * other active sprint, so two managers starting two sprints at once cannot
 * both succeed.
 */
async function startSprint({ orgId, sprintId }: { orgId: string; sprintId: string }) {
  const me = await actor()
  const items = await itemsOf(orgId, sprintId)
  if (items.length > 400) throw new OpError('failed-precondition', 'A sprint can hold at most 400 items.')
  const sprintRef = orgItem(orgId, 'sprints', sprintId)
  return runTransaction(db(), async (tx) => {
    const sprint = await tx.get(sprintRef)
    if (!sprint.exists()) throw new OpError('not-found', 'Sprint not found.')
    if (sprint.get('status') !== 'planned') throw new OpError('failed-precondition', `A ${sprint.get('status')} sprint cannot be started.`)
    validateSprintDates(sprint.get('startDate'), sprint.get('endDate'))
    const projectRef = orgItem(orgId, 'projects', sprint.get('projectId'))
    const project = await tx.get(projectRef)
    if (!project.exists()) throw new OpError('not-found', 'The sprint belongs to a project that no longer exists.')
    const activeId = project.get('activeSprintId') as string | null
    if (activeId && activeId !== sprintId) {
      const active = await tx.get(orgItem(orgId, 'sprints', activeId))
      if (active.exists() && active.get('status') === 'active') {
        throw new OpError('failed-precondition', `Finish "${active.get('name')}" before starting another sprint in this project.`)
      }
    }
    const stats = startStats(items.map((d) => d.data() as SprintItemFields))
    tx.update(sprintRef, { status: 'active', startedAt: serverTimestamp(), startedBy: me.uid, stats, updatedAt: serverTimestamp(), updatedBy: me.uid })
    tx.update(projectRef, { activeSprintId: sprintId, updatedAt: serverTimestamp(), updatedBy: me.uid })
    tx.set(doc(sprintRef, 'snapshots', 'start'), {
      kind: 'start',
      takenAt: serverTimestamp(),
      stats,
      items: items.map((d) => snapshotItem(d.id, d.data())),
    })
    tx.set(doc(sprintRef, 'events', 'start'), {
      type: 'sprint_started',
      at: serverTimestamp(),
      actorId: me.uid,
      itemId: null,
      scopeDelta: stats.scopePoints,
      countDelta: stats.scopeCount,
      completedDelta: stats.completedPoints,
      completedCountDelta: stats.completedCount,
      scopeAfter: stats.scopePoints,
      completedAfter: stats.completedPoints,
    })
    stageAudit(tx, orgId, me.uid, 'sprint.started', 'sprint', sprintId, {
      name: sprint.get('name'),
      committedPoints: stats.committedPoints,
      committedCount: stats.committedCount,
    })
    return { stats: stats as SprintStats }
  })
}

/**
 * Moves the unfinished items recorded at completion to their destination.
 * Safe to repeat: rules only let each listed item leave the completed sprint
 * once, so a retry after a dropped connection just finishes the job.
 */
async function finishCarryover({ orgId, sprintId }: { orgId: string; sprintId: string }) {
  const me = await actor()
  const sprint = await getDoc(orgItem(orgId, 'sprints', sprintId))
  const carry = sprint.get('carryover') as { targetSprintId: string | null; itemIds: string[] } | undefined
  if (sprint.get('status') !== 'completed' || !carry) return 0
  const listed = new Set(carry.itemIds)
  const pending = (await itemsOf(orgId, sprintId)).filter((d) => listed.has(d.id) && d.get('status') !== 'done')
  for (let i = 0; i < pending.length; i += 100) {
    const batch = writeBatch(db())
    for (const item of pending.slice(i, i + 100)) {
      batch.update(item.ref, {
        sprintId: carry.targetSprintId,
        carryoverCount: increment(1),
        lastCarriedOverFrom: sprintId,
        version: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: me.uid,
      })
    }
    await batch.commit()
  }
  return pending.length
}

/**
 * Completes the active sprint. Closing totals come from the items at that
 * moment; a final snapshot keeps the report stable when those items change
 * later. Unfinished work then moves to the backlog or a planned sprint.
 */
async function completeSprint({
  orgId,
  sprintId,
  carryover,
  targetSprintId,
}: {
  orgId: string
  sprintId: string
  carryover: 'backlog' | 'sprint'
  targetSprintId?: string
}) {
  const me = await actor()
  const target = carryover === 'sprint' ? targetSprintId ?? null : null
  if (carryover === 'sprint' && !target) throw new OpError('invalid-argument', 'Pick the sprint that receives unfinished work.')
  if (target === sprintId) throw new OpError('invalid-argument', 'Carry work over to a different sprint.')
  const [items, events] = await Promise.all([itemsOf(orgId, sprintId), getSprintEvents(orgId, sprintId)])
  let addedPoints = 0
  let removedPoints = 0
  for (const e of events) {
    if (e.type === 'item_added' || (e.type === 'estimate_changed' && e.scopeDelta > 0)) addedPoints += e.scopeDelta
    if (e.type === 'item_removed' || (e.type === 'estimate_changed' && e.scopeDelta < 0)) removedPoints -= e.scopeDelta
  }
  const sprintRef = orgItem(orgId, 'sprints', sprintId)

  const result = await runTransaction(db(), async (tx) => {
    const sprint = await tx.get(sprintRef)
    if (!sprint.exists()) throw new OpError('not-found', 'Sprint not found.')
    if (sprint.get('status') !== 'active') throw new OpError('failed-precondition', `A ${sprint.get('status')} sprint cannot be completed.`)
    if (target) {
      const t = await tx.get(orgItem(orgId, 'sprints', target))
      if (!t.exists() || t.get('projectId') !== sprint.get('projectId')) throw new OpError('invalid-argument', 'Pick a sprint from the same project.')
      if (t.get('status') !== 'planned') throw new OpError('failed-precondition', 'Work can only carry over to a planned sprint.')
    }
    const projectRef = orgItem(orgId, 'projects', sprint.get('projectId'))
    await tx.get(projectRef)
    const docs = items.map((d) => ({ id: d.id, data: d.data(), ...(d.data() as SprintItemFields) }))
    const started = sprint.get('stats') as SprintStats | undefined
    const plan = planCompletion(docs, {
      committedPoints: started?.committedPoints ?? 0,
      committedCount: started?.committedCount ?? 0,
      addedPoints,
      removedPoints,
    })
    tx.update(sprintRef, {
      status: 'completed',
      completedAt: serverTimestamp(),
      completedBy: me.uid,
      stats: plan.stats,
      historyComplete: Boolean(started),
      carryover: { mode: carryover, targetSprintId: target, itemIds: plan.incomplete.map((i) => i.id) },
      updatedAt: serverTimestamp(),
      updatedBy: me.uid,
    })
    tx.update(projectRef, { activeSprintId: null, updatedAt: serverTimestamp(), updatedBy: me.uid })
    tx.set(doc(sprintRef, 'snapshots', 'final'), {
      kind: 'final',
      takenAt: serverTimestamp(),
      stats: plan.stats,
      completed: plan.completed.map((i) => snapshotItem(i.id, i.data)),
      incomplete: plan.incomplete.map((i) => snapshotItem(i.id, i.data)),
      carryover: { mode: carryover, targetSprintId: target },
    })
    tx.set(doc(sprintRef, 'events', 'complete'), {
      type: 'sprint_completed',
      at: serverTimestamp(),
      actorId: me.uid,
      itemId: null,
      scopeDelta: 0,
      countDelta: 0,
      completedDelta: 0,
      completedCountDelta: 0,
      scopeAfter: plan.stats.scopePoints,
      completedAfter: plan.stats.completedPoints,
    })
    stageAudit(tx, orgId, me.uid, 'sprint.completed', 'sprint', sprintId, {
      name: sprint.get('name'),
      completedPoints: plan.stats.completedPoints,
      carriedOverCount: plan.stats.carriedOverCount ?? 0,
      carryover,
      targetSprintId: target,
    })
    return { stats: plan.stats, carriedOver: plan.incomplete.length }
  })
  await finishCarryover({ orgId, sprintId })
  return result
}

export const api = {
  createOrganization,
  createInvite,
  revokeInvite,
  previewInvite,
  acceptInvite,
  changeMemberRole,
  removeMember,
  startSprint,
  completeSprint,
  finishCarryover,
}
