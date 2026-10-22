/**
 * End to end against the Auth and Firestore emulators, driving the real app
 * modules (src/lib/api.ts and the data layer) as signed-in users. No server
 * code exists: everything here goes through firestore.rules.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { collection, getDoc, getDocs, orderBy, query } from 'firebase/firestore'

process.env.NEXT_PUBLIC_USE_EMULATORS = 'true'
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-arrow-tech'

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9095'
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID

type Modules = {
  fb: typeof import('@/lib/firebase')
  api: typeof import('@/lib/api')['api']
  items: typeof import('@/lib/data/items')
  sprints: typeof import('@/lib/data/sprints')
  org: typeof import('@/lib/data/org')
  refs: typeof import('@/lib/data/refs')
  reports: typeof import('@domain/reports')
}
let m: Modules

async function createUser(email: string) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret-pass-1', displayName: email.split('@')[0] }),
  })
  const { localId } = (await res.json()) as { localId: string }
  await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ localId, emailVerified: true }),
  })
  return localId
}

async function as(email: string) {
  const auth = m.fb.auth()
  if (auth.currentUser) await signOut(auth)
  await signInWithEmailAndPassword(auth, email, 'secret-pass-1')
  await auth.currentUser!.getIdToken(true)
  return auth.currentUser!.uid
}

const stamp = Date.now()
const OWNER = `owner${stamp}@arrow.test`
const NEWBIE = `newbie${stamp}@arrow.test`
const OTHER = `other${stamp}@arrow.test`

beforeAll(async () => {
  m = {
    fb: await import('@/lib/firebase'),
    api: (await import('@/lib/api')).api,
    items: await import('@/lib/data/items'),
    sprints: await import('@/lib/data/sprints'),
    org: await import('@/lib/data/org'),
    refs: await import('@/lib/data/refs'),
    reports: await import('@domain/reports'),
  }
  await Promise.all([createUser(OWNER), createUser(NEWBIE), createUser(OTHER)])
})

describe('end to end on the client SDK', () => {
  let orgId = ''
  let ownerUid = ''
  const ids: Record<string, string> = {}

  it('creates an organization, project and numbered items', async () => {
    ownerUid = await as(OWNER)
    orgId = (await m.api.createOrganization({ name: 'Arrow Tech', timeZone: 'Africa/Cairo' })).orgId
    expect((await getDoc(m.refs.orgItem(orgId, 'members', ownerUid))).get('role')).toBe('owner')

    await m.org.createProject(orgId, { name: 'Website', key: 'web' }, ownerUid)
    // Two items created at the same moment get distinct, consecutive keys.
    const [a, b] = await Promise.all([
      m.items.createItem(orgId, { projectId: 'WEB', type: 'story', title: 'Login', storyPoints: 5 }, ownerUid),
      m.items.createItem(orgId, { projectId: 'WEB', type: 'story', title: 'Signup', storyPoints: 3 }, ownerUid),
    ])
    expect([a.key, b.key].sort()).toEqual(['WEB-1', 'WEB-2'])
    ids.a = a.id
    ids.b = b.id
  })

  it('runs a sprint with tracked scope changes', async () => {
    ids.s1 = await m.sprints.createSprint(orgId, { projectId: 'WEB', name: 'Sprint 1', startDate: '2026-10-19', endDate: '2026-10-30' }, ownerUid)
    ids.s2 = await m.sprints.createSprint(orgId, { projectId: 'WEB', name: 'Sprint 2', startDate: '2026-11-02', endDate: '2026-11-13' }, ownerUid)
    await m.items.patchItems(orgId, [ids.a, ids.b], { sprintId: ids.s1 }, ownerUid)

    const started = await m.api.startSprint({ orgId, sprintId: ids.s1 })
    expect(started.stats).toMatchObject({ committedPoints: 8, committedCount: 2 })
    await expect(m.api.startSprint({ orgId, sprintId: ids.s2 })).rejects.toThrow(/Finish "Sprint 1"/)

    const c = await m.items.createItem(orgId, { projectId: 'WEB', type: 'bug', title: 'Crash', storyPoints: 2, sprintId: ids.s1 }, ownerUid)
    ids.c = c.id
    await m.items.patchItem(orgId, ids.a, { status: 'done' }, ownerUid)
    await m.items.patchItem(orgId, ids.b, { storyPoints: 5 }, ownerUid)

    const events = m.sprints.toDomainEvents(await m.sprints.getSprintEvents(orgId, ids.s1))
    expect(events.map((e) => e.type).sort()).toEqual(['estimate_changed', 'item_added', 'item_completed', 'sprint_started'])
    const series = m.reports.buildSprintSeries({ status: 'active', startDate: '2026-10-19', endDate: '2026-10-30' }, events, { timeZone: 'Africa/Cairo' })
    expect(series).toMatchObject({ sufficient: true, committed: 8, scope: 12, completed: 5, added: 4, removed: 0 })
  })

  it('rejects a stale edit with a conflict', async () => {
    const item = await m.items.getItem(orgId, ids.b)
    await m.items.patchItem(orgId, ids.b, { priority: 'high' }, ownerUid)
    await expect(m.items.saveItem(orgId, ids.b, item!.version, { title: 'Old copy' }, ownerUid)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('completes the sprint and carries unfinished work over once', async () => {
    const res = await m.api.completeSprint({ orgId, sprintId: ids.s1, carryover: 'sprint', targetSprintId: ids.s2 })
    expect(res).toMatchObject({ carriedOver: 2, stats: { committedPoints: 8, completedPoints: 5, carriedOverPoints: 7, addedPoints: 4 } })
    for (const id of [ids.b, ids.c]) {
      const item = await m.items.getItem(orgId, id)
      expect(item).toMatchObject({ sprintId: ids.s2, carryoverCount: 1, lastCarriedOverFrom: ids.s1 })
    }
    // Running the carryover again changes nothing.
    expect(await m.api.finishCarryover({ orgId, sprintId: ids.s1 })).toBe(0)
    expect((await getDoc(m.refs.orgItem(orgId, 'projects', 'WEB'))).get('activeSprintId')).toBeNull()

    const sprint = await getDoc(m.refs.orgItem(orgId, 'sprints', ids.s1))
    const v = m.reports.velocityReport([{ id: ids.s1, ...sprint.data(), completedAt: sprint.get('completedAt').toMillis() } as never])
    expect(v.rows[0]).toMatchObject({ committed: 8, completed: 5, carriedOver: 7 })

    const audit = await getDocs(query(collection(m.fb.db(), 'orgs', orgId, 'auditLogs'), orderBy('at')))
    expect(audit.docs.map((d) => d.get('action'))).toEqual(
      expect.arrayContaining(['org.created', 'project.created', 'sprint.created', 'sprint.started', 'sprint.completed']),
    )
  })

  it('lets an admin create a team account that can sign in at once', async () => {
    const { provisionAccount } = await import('@/lib/provision')
    const email = `dev${stamp}@arrow.test`
    const res = await provisionAccount({ orgId, email, displayName: 'New Dev', role: 'manager', password: 'temp-pass-123', sendResetLink: false })
    expect(res.status).toBe('created')
    // The admin is still signed in as themselves.
    expect(m.fb.auth().currentUser!.uid).toBe(ownerUid)
    // The new person signs in with the temporary password and is a manager.
    await signOut(m.fb.auth())
    const cred = await signInWithEmailAndPassword(m.fb.auth(), email, 'temp-pass-123')
    expect((await getDoc(m.refs.orgItem(orgId, 'members', cred.user.uid))).get('role')).toBe('manager')
    // An admin cannot use this path to mint owners.
    await as(OWNER)
    await expect(provisionAccount({ orgId, email: `boss${stamp}@arrow.test`, displayName: 'Boss', role: 'owner', password: 'temp-pass-123', sendResetLink: false })).rejects.toBeTruthy()
  })

  it('gives an existing account a join link instead', async () => {
    const { provisionAccount } = await import('@/lib/provision')
    const res = await provisionAccount({ orgId, email: NEWBIE, displayName: 'Newbie', role: 'member', password: 'temp-pass-123', sendResetLink: false })
    expect(res.status).toBe('existing')
  })

  it('invites a teammate who joins with the invited role', async () => {
    const pending = await getDocs(query(collection(m.fb.db(), 'orgs', orgId, 'invites')))
    const inviteId = pending.docs.find((d) => d.get('email') === NEWBIE.toLowerCase() && d.get('status') === 'pending')!.id
    const newbieUid = await as(NEWBIE)
    expect(await m.api.previewInvite({ orgId, inviteId })).toMatchObject({ orgName: 'Arrow Tech', role: 'member', expired: false })
    await m.api.acceptInvite({ orgId, inviteId })
    expect((await getDoc(m.refs.orgItem(orgId, 'members', newbieUid))).get('role')).toBe('member')
    // A member cannot promote anyone, themselves included.
    await expect(m.api.changeMemberRole({ orgId, uid: ownerUid, role: 'member' })).rejects.toBeTruthy()
    ids.newbie = newbieUid
  })

  it('protects the last owner and lets owners hand over', async () => {
    await as(OWNER)
    await expect(m.api.removeMember({ orgId, uid: ownerUid })).rejects.toThrow(/last owner/)
    await m.api.changeMemberRole({ orgId, uid: ids.newbie, role: 'owner' })
    expect((await getDoc(m.refs.orgDoc(orgId))).get('ownerIds').sort()).toEqual([ownerUid, ids.newbie].sort())
    await m.api.removeMember({ orgId, uid: ownerUid })
    expect((await getDoc(m.refs.orgDoc(orgId).withConverter(null)).catch((e) => e))).toMatchObject({ code: 'permission-denied' })
  })

  it('keeps other organizations out', async () => {
    await as(OTHER)
    await m.api.createOrganization({ name: 'Rival' })
    await expect(getDocs(query(collection(m.fb.db(), 'orgs', orgId, 'items')))).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(m.api.startSprint({ orgId, sprintId: ids.s2 })).rejects.toBeTruthy()
  })
})
