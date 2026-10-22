/**
 * Rules for the operations that used to need a server: creating orgs,
 * invites, role changes, sprint start/complete, carryover and sprint history.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, increment, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
import { baseItem, ORG_A, PROJECT_ID, seed, USERS } from './seed'

let env: RulesTestEnvironment

const as = (uid: string, verified = true, email = `${uid}@example.com`) =>
  env.authenticatedContext(uid, { email, email_verified: verified }).firestore() as unknown as Firestore

async function admin<T>(fn: (db: Firestore) => Promise<T>): Promise<T> {
  let out!: T
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx.firestore() as unknown as Firestore)
  })
  return out
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => {
  await env.clearFirestore()
  await seed(env)
})
afterAll(async () => {
  await env.cleanup()
})

const member = (uid: string, orgId: string, role: string, extra: Record<string, unknown> = {}) => ({
  uid, orgId, orgName: 'X', role, status: 'active', email: `${uid}@example.com`, displayName: uid, joinedAt: serverTimestamp(), ...extra,
})

describe('organization creation', () => {
  const create = (db: Firestore, uid: string, orgId: string, orgOverrides: Record<string, unknown> = {}, role = 'owner') => {
    const b = writeBatch(db)
    b.set(doc(db, `orgs/${orgId}`), { name: 'New Co', description: '', timeZone: 'UTC', ownerId: uid, ownerIds: [uid], createdAt: serverTimestamp(), createdBy: uid, ...orgOverrides })
    b.set(doc(db, `orgs/${orgId}/members/${uid}`), member(uid, orgId, role))
    return b.commit()
  }

  it('creates an org together with its owner membership', async () => {
    await assertSucceeds(create(as(USERS.outsider), USERS.outsider, 'newOrg'))
  })

  it('requires a verified email, the caller as owner, and both docs at once', async () => {
    await assertFails(create(as(USERS.outsider, false), USERS.outsider, 'o1'))
    await assertFails(create(as(USERS.outsider), USERS.outsider, 'o2', { ownerIds: [USERS.outsider, USERS.member] }))
    await assertFails(create(as(USERS.outsider), USERS.outsider, 'o3', {}, 'admin'))
    await assertFails(setDoc(doc(as(USERS.outsider), 'orgs/o4'), { name: 'Solo', ownerId: USERS.outsider, ownerIds: [USERS.outsider], createdAt: serverTimestamp(), createdBy: USERS.outsider }))
  })

  it('never lets anyone make themselves owner of an existing org', async () => {
    await assertFails(setDoc(doc(as(USERS.outsider), `orgs/${ORG_A}/members/${USERS.outsider}`), member(USERS.outsider, ORG_A, 'owner')))
    await assertFails(create(as(USERS.outsider), USERS.outsider, ORG_A))
  })
})

describe('invites', () => {
  const INVITE = 'i'.repeat(43)
  const invite = (o: Record<string, unknown> = {}) => ({
    email: 'new@example.com', role: 'member', orgId: ORG_A, orgName: 'Org A', status: 'pending', invitedBy: USERS.admin, invitedByName: 'Admin',
    createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000), ...o,
  })
  const accept = (db: Firestore, uid: string, role = 'member', inviteId = INVITE) => {
    const b = writeBatch(db)
    b.set(doc(db, `orgs/${ORG_A}/members/${uid}`), member(uid, ORG_A, role, { email: 'new@example.com', inviteId }))
    b.update(doc(db, `orgs/${ORG_A}/invites/${inviteId}`), { status: 'accepted', acceptedBy: uid, acceptedAt: serverTimestamp() })
    return b.commit()
  }

  it('lets admins invite below their own level only', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.admin), `orgs/${ORG_A}/invites/${INVITE}`), invite()))
    await assertFails(setDoc(doc(as(USERS.admin), `orgs/${ORG_A}/invites/${'a'.repeat(40)}`), invite({ role: 'admin' })))
    await assertFails(setDoc(doc(as(USERS.owner), `orgs/${ORG_A}/invites/${'b'.repeat(40)}`), invite({ role: 'owner', invitedBy: USERS.owner })))
    await assertFails(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/invites/${'c'.repeat(40)}`), invite({ invitedBy: USERS.manager })))
    // Guessable ids and long expiries are refused.
    await assertFails(setDoc(doc(as(USERS.admin), `orgs/${ORG_A}/invites/short`), invite()))
    await assertFails(setDoc(doc(as(USERS.admin), `orgs/${ORG_A}/invites/${'d'.repeat(40)}`), invite({ expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000) })))
  })

  it('lets only the invited, verified address accept, once, with the invited role', async () => {
    await admin((db) => setDoc(doc(db, `orgs/${ORG_A}/invites/${INVITE}`), invite()))
    await assertFails(getDoc(doc(as('stranger', true, 'stranger@example.com'), `orgs/${ORG_A}/invites/${INVITE}`)))
    await assertSucceeds(getDoc(doc(as('newbie', true, 'new@example.com'), `orgs/${ORG_A}/invites/${INVITE}`)))
    await assertFails(accept(as('stranger', true, 'stranger@example.com'), 'stranger'))
    await assertFails(accept(as('newbie', false, 'new@example.com'), 'newbie'))
    await assertFails(accept(as('newbie', true, 'new@example.com'), 'newbie', 'admin'))
    await assertSucceeds(accept(as('newbie', true, 'new@example.com'), 'newbie'))
    // A second account with the same email cannot reuse it.
    await assertFails(accept(as('twin', true, 'new@example.com'), 'twin'))
  })

  it('refuses expired and revoked invites', async () => {
    await admin((db) => setDoc(doc(db, `orgs/${ORG_A}/invites/${INVITE}`), invite({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })))
    await assertFails(accept(as('newbie', true, 'new@example.com'), 'newbie'))
    const other = 'r'.repeat(43)
    await admin((db) => setDoc(doc(db, `orgs/${ORG_A}/invites/${other}`), invite({ status: 'revoked' })))
    await assertFails(accept(as('newbie', true, 'new@example.com'), 'newbie', 'member', other))
  })
})

describe('roles and owners', () => {
  const setRole = (db: Firestore, actor: string, uid: string, role: string, owners?: string[]) => {
    const b = writeBatch(db)
    b.update(doc(db, `orgs/${ORG_A}/members/${uid}`), { role, roleUpdatedBy: actor, roleUpdatedAt: serverTimestamp() })
    if (owners) b.update(doc(db, `orgs/${ORG_A}`), { ownerIds: owners, ownerChange: uid })
    return b.commit()
  }

  it('applies the role ladder', async () => {
    await assertSucceeds(setRole(as(USERS.admin), USERS.admin, USERS.member, 'manager'))
    await assertFails(setRole(as(USERS.admin), USERS.admin, USERS.viewer, 'admin'))
    await assertFails(setRole(as(USERS.admin), USERS.admin, USERS.owner, 'member', []))
    await assertFails(setRole(as(USERS.manager), USERS.manager, USERS.viewer, 'member'))
    await assertFails(setRole(as(USERS.admin), USERS.admin, USERS.admin, 'owner', [USERS.owner, USERS.admin]))
  })

  it('keeps org.ownerIds equal to the owners', async () => {
    // Promoting to owner without listing them, or listing without promoting, fails.
    await assertFails(setRole(as(USERS.owner), USERS.owner, USERS.admin, 'owner'))
    await assertFails(updateDoc(doc(as(USERS.owner), `orgs/${ORG_A}`), { ownerIds: [USERS.owner, USERS.admin], ownerChange: USERS.admin }))
    await assertSucceeds(setRole(as(USERS.owner), USERS.owner, USERS.admin, 'owner', [USERS.owner, USERS.admin]))
    // Now two owners; one may demote the other.
    await assertSucceeds(setRole(as(USERS.admin), USERS.admin, USERS.owner, 'admin', [USERS.admin]))
    const owners = await admin(async (db) => (await getDoc(doc(db, `orgs/${ORG_A}`))).get('ownerIds'))
    expect(owners).toEqual([USERS.admin])
  })

  it('never empties the owner list', async () => {
    await assertFails(updateDoc(doc(as(USERS.owner), `orgs/${ORG_A}`), { ownerIds: [], ownerChange: USERS.owner }))
    const db = as(USERS.owner)
    const leave = writeBatch(db)
    leave.update(doc(db, `orgs/${ORG_A}`), { ownerIds: [], ownerChange: USERS.owner })
    leave.delete(doc(db, `orgs/${ORG_A}/members/${USERS.owner}`))
    await assertFails(leave.commit())
    await assertFails(deleteMember(as(USERS.owner), USERS.owner))
  })

  it('lets members leave and admins remove people below them', async () => {
    await assertSucceeds(deleteMember(as(USERS.viewer), USERS.viewer))
    await assertSucceeds(deleteMember(as(USERS.admin), USERS.member))
    await assertFails(deleteMember(as(USERS.manager), USERS.admin))
  })
})

function deleteMember(db: Firestore, uid: string) {
  const b = writeBatch(db)
  b.delete(doc(db, `orgs/${ORG_A}/members/${uid}`))
  return b.commit()
}

describe('sprint lifecycle', () => {
  const stats = { committedPoints: 3, committedCount: 1, scopePoints: 3, scopeCount: 1, completedPoints: 0, completedCount: 0, addedPoints: 0, removedPoints: 0 }
  const eventBase = (uid: string) => ({ at: serverTimestamp(), actorId: uid, itemId: null, scopeDelta: 3, countDelta: 1, completedDelta: 0, completedCountDelta: 0 })

  const start = (db: Firestore, uid: string, sprintId: string, opts: { event?: boolean; project?: boolean } = {}) => {
    const b = writeBatch(db)
    b.update(doc(db, `orgs/${ORG_A}/sprints/${sprintId}`), { status: 'active', startedAt: serverTimestamp(), startedBy: uid, stats, updatedAt: serverTimestamp(), updatedBy: uid })
    if (opts.project !== false) b.update(doc(db, `orgs/${ORG_A}/projects/ARW`), { activeSprintId: sprintId, updatedAt: serverTimestamp(), updatedBy: uid })
    if (opts.event !== false) b.set(doc(db, `orgs/${ORG_A}/sprints/${sprintId}/events/start`), { type: 'sprint_started', ...eventBase(uid) })
    b.set(doc(db, `orgs/${ORG_A}/sprints/${sprintId}/snapshots/start`), { kind: 'start', takenAt: serverTimestamp(), stats, items: [] })
    return b.commit()
  }

  const complete = (db: Firestore, uid: string, itemIds: string[], target: string | null = null) => {
    const b = writeBatch(db)
    b.update(doc(db, `orgs/${ORG_A}/sprints/sActive`), {
      status: 'completed', completedAt: serverTimestamp(), completedBy: uid, stats, historyComplete: true,
      carryover: { mode: target ? 'sprint' : 'backlog', targetSprintId: target, itemIds }, updatedAt: serverTimestamp(), updatedBy: uid,
    })
    b.update(doc(db, `orgs/${ORG_A}/projects/ARW`), { activeSprintId: null, updatedAt: serverTimestamp(), updatedBy: uid })
    b.set(doc(db, `orgs/${ORG_A}/sprints/sActive/events/complete`), { type: 'sprint_completed', ...eventBase(uid) })
    b.set(doc(db, `orgs/${ORG_A}/sprints/sActive/snapshots/final`), { kind: 'final', takenAt: serverTimestamp(), stats })
    return b.commit()
  }

  const carry = (db: Firestore, uid: string, itemId: string, to: string | null) =>
    updateDoc(doc(db, `orgs/${ORG_A}/items/${itemId}`), { sprintId: to, carryoverCount: increment(1), lastCarriedOverFrom: 'sActive', version: increment(1), updatedAt: serverTimestamp(), updatedBy: uid })

  it('allows one active sprint per project', async () => {
    // sActive is already running in ARW.
    await assertFails(start(as(USERS.manager), USERS.manager, 'sPlanned'))
    await admin((db) => updateDoc(doc(db, `orgs/${ORG_A}/sprints/sActive`), { status: 'completed' }))
    await assertSucceeds(start(as(USERS.manager), USERS.manager, 'sPlanned'))
  })

  it('requires a manager, the start record and the project pointer', async () => {
    await admin((db) => updateDoc(doc(db, `orgs/${ORG_A}/projects/ARW`), { activeSprintId: null }))
    await admin((db) => updateDoc(doc(db, `orgs/${ORG_A}/sprints/sActive`), { status: 'completed' }))
    await assertFails(start(as(USERS.member), USERS.member, 'sPlanned'))
    await assertFails(start(as(USERS.manager), USERS.manager, 'sPlanned', { event: false }))
    await assertFails(start(as(USERS.manager), USERS.manager, 'sPlanned', { project: false }))
    await assertSucceeds(start(as(USERS.manager), USERS.manager, 'sPlanned'))
    // History cannot be rewritten afterwards.
    await assertFails(updateDoc(doc(as(USERS.owner), `orgs/${ORG_A}/sprints/sPlanned/events/start`), { scopeDelta: 99 }))
  })

  it('completes once and carries each listed item over exactly once', async () => {
    await admin(async (db) => {
      await setDoc(doc(db, `orgs/${ORG_A}/items/c1`), baseItem({ key: 'ARW-5', seq: 5, sprintId: 'sActive' }))
      await setDoc(doc(db, `orgs/${ORG_A}/items/c2`), baseItem({ key: 'ARW-6', seq: 6, sprintId: 'sActive' }))
    })
    await assertFails(complete(as(USERS.member), USERS.member, ['c1']))
    await assertSucceeds(complete(as(USERS.manager), USERS.manager, ['c1'], 'sPlanned'))
    await assertFails(complete(as(USERS.manager), USERS.manager, ['c1']))
    // Wrong destination, unlisted item and a member are refused; the listed item moves once.
    await assertFails(carry(as(USERS.manager), USERS.manager, 'c1', null))
    await assertFails(carry(as(USERS.manager), USERS.manager, 'c2', 'sPlanned'))
    await assertFails(carry(as(USERS.member), USERS.member, 'c1', 'sPlanned'))
    await assertSucceeds(carry(as(USERS.manager), USERS.manager, 'c1', 'sPlanned'))
    await assertFails(carry(as(USERS.manager), USERS.manager, 'c1', 'sPlanned'))
  })
})

describe('sprint history', () => {
  const itemPath = `orgs/${ORG_A}/items/h1`
  beforeEach(async () => {
    await admin((db) => setDoc(doc(db, itemPath), baseItem({ key: 'ARW-7', seq: 7, sprintId: 'sActive', storyPoints: 5 })))
  })

  const finish = (db: Firestore, uid: string, event: Record<string, unknown> | null, eventId = 'h1-2') =>
    runTransaction(db, async (tx) => {
      tx.update(doc(db, itemPath), { status: 'done', version: 2, updatedAt: serverTimestamp(), updatedBy: uid })
      if (event) {
        tx.set(doc(db, `orgs/${ORG_A}/sprints/sActive/events/${eventId}`), {
          type: 'item_completed', at: serverTimestamp(), actorId: uid, itemId: 'h1', itemKey: 'ARW-7', itemTitle: 'x',
          scopeDelta: 0, countDelta: 0, completedDelta: 5, completedCountDelta: 1, before: 'todo', after: 'done', ...event,
        })
      }
    })

  it('requires a history entry for changes to an active sprint', async () => {
    await assertFails(finish(as(USERS.member), USERS.member, null))
    await assertSucceeds(finish(as(USERS.member), USERS.member, {}))
  })

  it('recomputes every number, so history cannot be forged', async () => {
    await assertFails(finish(as(USERS.member), USERS.member, { completedDelta: 50 }))
    await assertFails(finish(as(USERS.member), USERS.member, { scopeDelta: -5 }))
    await assertFails(finish(as(USERS.member), USERS.member, { type: 'item_added' }))
    await assertFails(finish(as(USERS.member), USERS.member, { actorId: USERS.owner }))
    await assertFails(finish(as(USERS.member), USERS.member, {}, 'h1-9'))
    // A free-standing event with no matching item change is refused too.
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/sprints/sActive/events/h1-2`), {
      type: 'item_completed', at: serverTimestamp(), actorId: USERS.member, itemId: 'h1', scopeDelta: 0, countDelta: 0, completedDelta: 5, completedCountDelta: 1,
    }))
  })

  it('needs no history for planned sprints', async () => {
    await assertSucceeds(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1`), { sprintId: 'sPlanned', version: 2, updatedAt: serverTimestamp(), updatedBy: USERS.member }))
  })
})

describe('notifications and audit entries', () => {
  const note = (actorId: string, recipientId: string) => ({ recipientId, type: 'assigned', title: 'Hi', body: '', link: null, actorId, readAt: null, createdAt: serverTimestamp() })
  const entry = (actorId: string) => ({ action: 'project.created', actorId, targetType: 'project', targetId: 'X', details: {}, at: serverTimestamp() })

  it('stamps the actor and only reaches current members', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/notifications/a`), note(USERS.member, USERS.viewer)))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/notifications/b`), note(USERS.owner, USERS.viewer)))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/notifications/c`), note(USERS.member, USERS.member)))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/notifications/d`), note(USERS.member, USERS.outsider)))
    await assertFails(setDoc(doc(as(USERS.outsider), `orgs/${ORG_A}/notifications/e`), note(USERS.outsider, USERS.member)))
  })

  it('keeps the audit log append-only and self-attributed', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/auditLogs/a`), entry(USERS.manager)))
    await assertFails(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/auditLogs/b`), entry(USERS.owner)))
    await assertFails(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/auditLogs/c`), { ...entry(USERS.manager), at: Timestamp.fromMillis(0) }))
    await assertFails(setDoc(doc(as(USERS.outsider), `orgs/${ORG_A}/auditLogs/d`), entry(USERS.outsider)))
    await assertFails(updateDoc(doc(as(USERS.owner), `orgs/${ORG_A}/auditLogs/log1`), { action: 'nothing.happened' }))
  })
})
