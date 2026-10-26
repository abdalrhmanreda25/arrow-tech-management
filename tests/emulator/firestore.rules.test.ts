import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import { baseItem, ORG_A, ORG_B, PROJECT_ID, seed, USERS } from './seed'

let env: RulesTestEnvironment

const as = (uid: string | null) =>
  (uid ? env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }) : env.unauthenticatedContext()).firestore() as unknown as Firestore

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed(env)
})

afterAll(async () => {
  await env.cleanup()
})

/** Creates the next item the way the app does: bump itemSeq and write the item in one transaction. */
async function createItem(db: Firestore, uid: string, seq: number, extra: Record<string, unknown> = {}, key = `ARW-${seq}`) {
  await runTransaction(db, async (tx) => {
    tx.update(doc(db, `orgs/${ORG_A}/projects/ARW`), { itemSeq: increment(1) })
    tx.set(doc(db, `orgs/${ORG_A}/items/new-${seq}`), baseItem({ key, seq, createdBy: uid, updatedBy: uid, reporterId: uid, updatedAt: serverTimestamp(), ...extra }))
  })
}

describe('authentication', () => {
  it('denies every org read to signed-out users', async () => {
    const db = as(null)
    await assertFails(getDoc(doc(db, `orgs/${ORG_A}`)))
    await assertFails(getDoc(doc(db, `orgs/${ORG_A}/items/i1`)))
    await assertFails(getDocs(collectionGroup(db, 'members')))
  })

  it('keeps user profiles private to their owner', async () => {
    await assertSucceeds(getDoc(doc(as(USERS.member), `users/${USERS.member}`)))
    await assertFails(getDoc(doc(as(USERS.admin), `users/${USERS.member}`)))
    await assertSucceeds(setDoc(doc(as(USERS.outsider), `users/${USERS.outsider}`), { displayName: 'Out', email: 'o@example.com' }))
    await assertFails(setDoc(doc(as(USERS.outsider), `users/${USERS.member}`), { displayName: 'Hijack' }))
  })
})

describe('organization isolation', () => {
  it('lets members read their org and nothing in another org', async () => {
    const db = as(USERS.member)
    await assertSucceeds(getDoc(doc(db, `orgs/${ORG_A}`)))
    await assertSucceeds(getDoc(doc(db, `orgs/${ORG_A}/items/i1`)))
    await assertFails(getDoc(doc(db, `orgs/${ORG_B}`)))
    await assertFails(getDoc(doc(db, `orgs/${ORG_B}/items/iB`)))
    await assertFails(getDocs(collection(db, `orgs/${ORG_B}/members`)))
    await assertFails(getDocs(collection(db, `orgs/${ORG_B}/projects`)))
  })

  it('stops an owner of one org writing into another', async () => {
    const db = as(USERS.otherOwner)
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { title: 'pwned', version: 2, updatedBy: USERS.otherOwner, updatedAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db, `orgs/${ORG_A}/sprints/x`), { projectId: 'ARW', name: 'x', status: 'planned', startDate: '2026-01-01', endDate: '2026-01-02', createdBy: USERS.otherOwner }))
  })

  it('denies outsiders entirely', async () => {
    const db = as(USERS.outsider)
    await assertFails(getDoc(doc(db, `orgs/${ORG_A}`)))
    await assertFails(getDocs(collection(db, `orgs/${ORG_A}/items`)))
  })

  it('lets a user list only their own memberships across orgs', async () => {
    const db = as(USERS.member)
    await assertSucceeds(getDocs(query(collectionGroup(db, 'members'), where('uid', '==', USERS.member))))
    await assertFails(getDocs(query(collectionGroup(db, 'members'), where('uid', '==', USERS.otherOwner))))
    await assertFails(getDocs(collectionGroup(db, 'members')))
  })
})

describe('membership and roles', () => {
  it('blocks self-made memberships and unstamped role edits', async () => {
    await assertFails(setDoc(doc(as(USERS.outsider), `orgs/${ORG_A}/members/${USERS.outsider}`), { uid: USERS.outsider, role: 'owner', status: 'active' }))
    await assertFails(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/members/${USERS.member}`), { role: 'owner' }))
    await assertFails(updateDoc(doc(as(USERS.owner), `orgs/${ORG_A}/members/${USERS.member}`), { role: 'admin' }))
    // Removing someone you do not outrank is refused.
    await assertFails(deleteDoc(doc(as(USERS.admin), `orgs/${ORG_A}/members/${USERS.owner}`)))
    await assertFails(deleteDoc(doc(as(USERS.manager), `orgs/${ORG_A}/members/${USERS.member}`)))
  })

  it('lets a member refresh only their own cached profile', async () => {
    await assertSucceeds(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/members/${USERS.member}`), { displayName: 'New Name' }))
    await assertFails(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/members/${USERS.viewer}`), { displayName: 'Hacked' }))
    await assertFails(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/members/${USERS.member}`), { displayName: 'X', status: 'active', role: 'admin' }))
  })

  it('keeps invites and audit logs admin-only and read-only', async () => {
    await assertSucceeds(getDoc(doc(as(USERS.admin), `orgs/${ORG_A}/auditLogs/log1`)))
    await assertFails(getDoc(doc(as(USERS.manager), `orgs/${ORG_A}/auditLogs/log1`)))
    await assertFails(setDoc(doc(as(USERS.owner), `orgs/${ORG_A}/auditLogs/fake`), { action: 'x' }))
    await assertFails(setDoc(doc(as(USERS.owner), `orgs/${ORG_A}/invites/fake`), { email: 'a@b.c', role: 'owner' }))
  })

  it('lets admins rename the org but not change its owner', async () => {
    await assertSucceeds(updateDoc(doc(as(USERS.admin), `orgs/${ORG_A}`), { name: 'Arrow Tech', updatedBy: USERS.admin }))
    await assertFails(updateDoc(doc(as(USERS.manager), `orgs/${ORG_A}`), { name: 'Nope', updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(as(USERS.owner), `orgs/${ORG_A}`), { ownerId: USERS.member, updatedBy: USERS.owner }))
  })
})

describe('work items', () => {
  it('allocates keys only through the project counter', async () => {
    await assertSucceeds(createItem(as(USERS.member), USERS.member, 2))
    // Reusing a number that is already taken fails.
    await assertFails(createItem(as(USERS.member), USERS.member, 2))
    // Skipping ahead fails too.
    await assertFails(createItem(as(USERS.member), USERS.member, 9))
    // The key must match the project key and number.
    await assertFails(createItem(as(USERS.member), USERS.member, 3, {}, 'XXX-3'))
    // An item written without bumping the counter is rejected.
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/sneaky`), baseItem({ key: 'ARW-3', seq: 3 })))
  })

  it('serialises two members racing for the same key', async () => {
    const a = as(USERS.member)
    const b = as(USERS.manager)
    // Both clients saw itemSeq == 1 and try to take number 2.
    await assertSucceeds(createItem(a, USERS.member, 2))
    await assertFails(setDoc(doc(b, `orgs/${ORG_A}/items/race`), baseItem({ key: 'ARW-2', seq: 2, createdBy: USERS.manager, updatedBy: USERS.manager, updatedAt: serverTimestamp() })))
    // Retrying with the next number works.
    await assertSucceeds(createItem(b, USERS.manager, 3))
  })

  it('blocks viewers and spoofed authors', async () => {
    await assertFails(createItem(as(USERS.viewer), USERS.viewer, 2))
    await assertFails(createItem(as(USERS.member), USERS.manager, 2))
    await assertFails(updateDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/items/i1`), { title: 'x', version: 2, updatedBy: USERS.viewer, updatedAt: serverTimestamp() }))
  })

  it('rejects stale writes with optimistic versioning', async () => {
    const a = as(USERS.member)
    const b = as(USERS.manager)
    await assertSucceeds(updateDoc(doc(a, `orgs/${ORG_A}/items/i1`), { status: 'in_progress', version: 2, updatedBy: USERS.member, updatedAt: serverTimestamp() }))
    // b still holds version 1 and tries to write version 2.
    await assertFails(updateDoc(doc(b, `orgs/${ORG_A}/items/i1`), { status: 'done', version: 2, updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(b, `orgs/${ORG_A}/items/i1`), { status: 'done', version: 1, updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(b, `orgs/${ORG_A}/items/i1`), { status: 'done', version: 3, updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
  })

  it('keeps identity and trusted fields immutable', async () => {
    const db = as(USERS.member)
    const bump = { version: 2, updatedBy: USERS.member, updatedAt: serverTimestamp() }
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { ...bump, key: 'ARW-99' }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { ...bump, projectId: 'MOB' }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { ...bump, carryoverCount: 0, createdBy: USERS.owner }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { ...bump, carryoverCount: 5 }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { ...bump, status: 'archived' }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { ...bump, storyPoints: -1 }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { ...bump, isAdmin: true }))
    // Writes must carry the server commit time, which orders sprint history.
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { version: 2, updatedBy: USERS.member }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { version: 2, updatedBy: USERS.member, updatedAt: new Date(0) }))
  })

  it('only lets items join open sprints of their own project', async () => {
    const db = as(USERS.member)
    const move = (sprintId: string | null, version: number) =>
      updateDoc(doc(db, `orgs/${ORG_A}/items/i1`), { sprintId, version, updatedBy: USERS.member, updatedAt: serverTimestamp() })
    await assertSucceeds(move('sPlanned', 2))
    // Joining the running sprint needs a history entry (see client-ops tests).
    await assertFails(move('sActive', 3))
    await assertFails(move('sDone', 3))
    await assertFails(move('sOther', 3))
    await assertFails(move('missing', 3))
    await assertSucceeds(move(null, 3))
  })

  it('never puts an epic in a sprint', async () => {
    await assertFails(createItem(as(USERS.member), USERS.member, 2, { type: 'epic', sprintId: 'sPlanned' }))
    await assertSucceeds(createItem(as(USERS.member), USERS.member, 2, { type: 'epic', sprintId: null }))
  })

  it('lets creators and managers delete, but not other members', async () => {
    await assertFails(deleteDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/items/i1`)))
    await assertSucceeds(deleteDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1`)))
    await seed(env)
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore() as unknown as Firestore, `orgs/${ORG_A}/items/i2`), baseItem({ createdBy: USERS.owner })))
    await assertFails(deleteDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i2`)))
    await assertSucceeds(deleteDoc(doc(as(USERS.manager), `orgs/${ORG_A}/items/i2`)))
  })

  it('accepts web links only, credited to their author', async () => {
    const link = (uid: string, url: string) => ({ title: 'Design', url, addedBy: uid, addedAt: serverTimestamp() })
    await assertSucceeds(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/links/l1`), link(USERS.member, 'https://figma.com/file/x')))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/links/l2`), link(USERS.member, 'javascript:alert(1)')))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/links/l3`), link(USERS.owner, 'https://x.test')))
    await assertFails(setDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/items/i1/links/l4`), link(USERS.viewer, 'https://x.test')))
    await assertFails(getDoc(doc(as(USERS.otherOwner), `orgs/${ORG_A}/items/i1/links/l1`)))
  })

  it('stores screenshots inline only as bounded JPEG data URLs', async () => {
    const jpeg = 'data:image/jpeg;base64,' + 'A'.repeat(1000)
    const shot = (uid: string, dataUrl: string) => ({ name: 'screen.png', dataUrl, width: 800, height: 600, addedBy: uid, addedAt: serverTimestamp() })
    await assertSucceeds(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/images/a`), shot(USERS.member, jpeg)))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/images/b`), shot(USERS.member, 'data:image/svg+xml;base64,PHN2Zz4=')))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/images/c`), shot(USERS.member, 'https://evil.test/x.jpg')))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/images/d`), shot(USERS.member, 'data:image/jpeg;base64,' + 'A'.repeat(700_001))))
    await assertFails(setDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/items/i1/images/e`), shot(USERS.viewer, jpeg)))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/images/f`), shot(USERS.owner, jpeg)))
  })

  it('accepts small JPEG profile photos only', async () => {
    const self = (photoURL: unknown) => updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/members/${USERS.member}`), { displayName: 'M', photoURL })
    await assertSucceeds(self('data:image/jpeg;base64,' + 'B'.repeat(500)))
    await assertSucceeds(self(null))
    await assertFails(self('https://tracker.test/pixel.gif'))
    await assertFails(self('data:image/jpeg;base64,' + 'B'.repeat(140_001)))
  })

  it('checks comment authorship', async () => {
    const c = { text: 'Looks good', authorName: 'M', createdAt: new Date() }
    await assertSucceeds(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/comments/c1`), { ...c, authorId: USERS.member }))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1/comments/c2`), { ...c, authorId: USERS.owner }))
    await assertFails(setDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/items/i1/comments/c3`), { ...c, authorId: USERS.viewer }))
    await assertFails(updateDoc(doc(as(USERS.manager), `orgs/${ORG_A}/items/i1/comments/c1`), { text: 'edited' }))
    await assertSucceeds(deleteDoc(doc(as(USERS.manager), `orgs/${ORG_A}/items/i1/comments/c1`)))
  })
})

describe('projects', () => {
  const project = (uid: string, key = 'NEW') => ({ name: 'New', key, status: 'planned', itemSeq: 0, activeSprintId: null, createdBy: uid })

  it('lets managers create projects and members only bump the counter', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/projects/NEW`), project(USERS.manager)))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/projects/MEM`), project(USERS.member, 'MEM')))
    await assertFails(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/projects/BIG`), { ...project(USERS.manager, 'BIG'), itemSeq: 10 }))
    // The id must be the key, which keeps keys unique; an existing key cannot be re-created.
    await assertFails(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/projects/p7`), project(USERS.manager, 'ODD')))
    await assertFails(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/projects/ARW`), project(USERS.manager, 'ARW')))
    await assertFails(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/projects/ARW`), { itemSeq: 3 }))
    await assertFails(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/projects/ARW`), { name: 'Renamed' }))
    await assertFails(updateDoc(doc(as(USERS.manager), `orgs/${ORG_A}/projects/ARW`), { activeSprintId: 'sPlanned', updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(as(USERS.manager), `orgs/${ORG_A}/projects/ARW`), { name: 'Renamed', updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
  })
})

describe('project assignment', () => {
  const assigned = (db: Firestore) => getDocs(query(collection(db, `orgs/${ORG_A}/projects`), where('memberIds', 'array-contains', USERS.member)))

  it('shows members and viewers only the projects they are assigned to', async () => {
    await assertSucceeds(getDoc(doc(as(USERS.member), `orgs/${ORG_A}/projects/ARW`)))
    await assertFails(getDoc(doc(as(USERS.member), `orgs/${ORG_A}/projects/MOB`)))
    await assertFails(getDocs(collection(as(USERS.member), `orgs/${ORG_A}/projects`)))
    await assertSucceeds(assigned(as(USERS.member)))
    await assertSucceeds(getDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/projects/ARW`)))
    await assertFails(getDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/projects/MOB`)))
  })

  it('shows managers and above every project', async () => {
    await assertSucceeds(getDocs(collection(as(USERS.manager), `orgs/${ORG_A}/projects`)))
    await assertSucceeds(getDoc(doc(as(USERS.admin), `orgs/${ORG_A}/projects/MOB`)))
  })

  it('lets managers assign members, and only to a list of uids', async () => {
    const save = (memberIds: unknown) => updateDoc(doc(as(USERS.manager), `orgs/${ORG_A}/projects/MOB`), { memberIds, updatedBy: USERS.manager, updatedAt: serverTimestamp() })
    await assertSucceeds(save([USERS.member]))
    await assertFails(save('everyone'))
    await assertFails(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/projects/ARW`), { memberIds: [USERS.member, USERS.admin] }))
    await assertSucceeds(getDoc(doc(as(USERS.member), `orgs/${ORG_A}/projects/MOB`)))
  })

  it('keeps members from adding or editing work in projects they are not on', async () => {
    const db = as(USERS.member)
    await assertFails(
      runTransaction(db, async (tx) => {
        tx.update(doc(db, `orgs/${ORG_A}/projects/MOB`), { itemSeq: increment(1) })
        tx.set(doc(db, `orgs/${ORG_A}/items/mob-1`), baseItem({ projectId: 'MOB', key: 'MOB-1', seq: 1, updatedAt: serverTimestamp() }))
      }),
    )
    await assertSucceeds(createItem(db, USERS.member, 2))
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore() as unknown as Firestore, `orgs/${ORG_A}/items/mob-0`), baseItem({ projectId: 'MOB', key: 'MOB-0', seq: 0 })))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/items/mob-0`), { title: 'x', version: 2, updatedBy: USERS.member, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(as(USERS.manager), `orgs/${ORG_A}/items/mob-0`), { title: 'x', version: 2, updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
  })
})

describe('task hours', () => {
  const edit = (o: Record<string, unknown>) => updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/items/i1`), { ...o, version: 2, updatedBy: USERS.member, updatedAt: serverTimestamp() })

  it('accepts hours between 0 and 1000, or none', async () => {
    await assertSucceeds(edit({ hours: 6.5 }))
    await env.clearFirestore()
    await seed(env)
    await assertSucceeds(edit({ hours: null }))
    await assertFails(edit({ hours: -1 }))
    await assertFails(edit({ hours: 1001 }))
    await assertFails(edit({ hours: '4' }))
  })

  it('records hours on new items', async () => {
    await assertSucceeds(createItem(as(USERS.member), USERS.member, 2, { hours: 3 }))
  })
})

describe('sprints', () => {
  const sprint = (o: Record<string, unknown> = {}) => ({
    projectId: 'ARW',
    name: 'Sprint 3',
    goal: '',
    status: 'planned',
    startDate: '2026-04-01',
    endDate: '2026-04-14',
    createdBy: USERS.manager,
    ...o,
  })

  it('lets managers plan sprints, not members', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/sprints/s3`), sprint()))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/sprints/s4`), sprint({ createdBy: USERS.member })))
    await assertFails(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/sprints/s5`), sprint({ endDate: '2026-03-01' })))
    await assertFails(setDoc(doc(as(USERS.manager), `orgs/${ORG_A}/sprints/s6`), sprint({ projectId: 'nope' })))
  })

  it('reserves status, stats and history for Cloud Functions', async () => {
    const db = as(USERS.owner)
    await assertFails(setDoc(doc(db, `orgs/${ORG_A}/sprints/s7`), sprint({ status: 'active', createdBy: USERS.owner })))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/sprints/sPlanned`), { status: 'active', updatedBy: USERS.owner }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/sprints/sActive`), { stats: { completedPoints: 999 }, updatedBy: USERS.owner }))
    await assertFails(setDoc(doc(db, `orgs/${ORG_A}/sprints/sActive/events/fake`), { type: 'item_completed' }))
    await assertFails(setDoc(doc(db, `orgs/${ORG_A}/sprints/sActive/snapshots/final`), { stats: {} }))
    await assertSucceeds(getDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/sprints/sActive/events/start`)))
  })

  it('freezes dates once started and everything once completed', async () => {
    const db = as(USERS.manager)
    await assertSucceeds(updateDoc(doc(db, `orgs/${ORG_A}/sprints/sPlanned`), { endDate: '2026-03-30', updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/sprints/sActive`), { endDate: '2026-03-30', updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(db, `orgs/${ORG_A}/sprints/sActive`), { goal: 'Ship login', updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, `orgs/${ORG_A}/sprints/sDone`), { goal: 'Rewrite history', updatedBy: USERS.manager, updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(doc(db, `orgs/${ORG_A}/sprints/sActive`)))
    await assertSucceeds(deleteDoc(doc(db, `orgs/${ORG_A}/sprints/sPlanned`)))
  })
})

describe('notifications', () => {
  it('belong to their recipient, who may only mark them read', async () => {
    await assertSucceeds(getDocs(query(collection(as(USERS.member), `orgs/${ORG_A}/notifications`), where('recipientId', '==', USERS.member))))
    await assertFails(getDocs(query(collection(as(USERS.admin), `orgs/${ORG_A}/notifications`), where('recipientId', '==', USERS.member))))
    await assertSucceeds(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/notifications/n1`), { readAt: new Date() }))
    await assertFails(updateDoc(doc(as(USERS.member), `orgs/${ORG_A}/notifications/n1`), { title: 'changed' }))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/notifications/n2`), { recipientId: USERS.owner, title: 'spam' }))
  })
})

describe('ceremonies', () => {
  const ceremony = (uid: string) => ({ sprintId: 'sActive', projectId: 'ARW', type: 'retrospective', title: 'Retro', status: 'scheduled', scheduledAt: new Date(), notes: '', actionItems: [], createdBy: uid })

  it('lets members record ceremonies, viewers only read', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/ceremonies/c1`), ceremony(USERS.member)))
    await assertFails(setDoc(doc(as(USERS.viewer), `orgs/${ORG_A}/ceremonies/c2`), ceremony(USERS.viewer)))
    await assertFails(setDoc(doc(as(USERS.member), `orgs/${ORG_A}/ceremonies/c3`), { ...ceremony(USERS.member), type: 'party' }))
  })
})
