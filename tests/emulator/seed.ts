import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, type Firestore } from 'firebase/firestore'

export const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-arrow-tech'

export const ORG_A = 'orgA'
export const ORG_B = 'orgB'

export const USERS = {
  owner: 'u-owner',
  admin: 'u-admin',
  manager: 'u-manager',
  member: 'u-member',
  viewer: 'u-viewer',
  otherOwner: 'u-other-owner',
  outsider: 'u-outsider',
} as const

const member = (uid: string, role: string, orgId: string) => ({
  uid,
  orgId,
  orgName: orgId,
  role,
  status: 'active',
  email: `${uid}@example.com`,
  displayName: uid,
})

export const baseItem = (o: Record<string, unknown> = {}) => ({
  projectId: 'ARW',
  key: 'ARW-1',
  seq: 1,
  type: 'story',
  title: 'Existing story',
  description: '',
  status: 'todo',
  priority: 'medium',
  storyPoints: 3,
  assigneeId: null,
  reporterId: USERS.member,
  epicId: null,
  parentId: null,
  sprintId: null,
  labels: [],
  rank: 1024,
  carryoverCount: 0,
  version: 1,
  createdBy: USERS.member,
  updatedBy: USERS.member,
  ...o,
})

/** Two orgs: A with one person per role, B with its own owner. */
export async function seed(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore
    const writes: [string, Record<string, unknown>][] = [
      [`orgs/${ORG_A}`, { name: 'Org A', ownerId: USERS.owner, ownerIds: [USERS.owner], timeZone: 'UTC' }],
      [`orgs/${ORG_B}`, { name: 'Org B', ownerId: USERS.otherOwner, ownerIds: [USERS.otherOwner], timeZone: 'UTC' }],
      [`orgs/${ORG_A}/members/${USERS.owner}`, member(USERS.owner, 'owner', ORG_A)],
      [`orgs/${ORG_A}/members/${USERS.admin}`, member(USERS.admin, 'admin', ORG_A)],
      [`orgs/${ORG_A}/members/${USERS.manager}`, member(USERS.manager, 'manager', ORG_A)],
      [`orgs/${ORG_A}/members/${USERS.member}`, member(USERS.member, 'member', ORG_A)],
      [`orgs/${ORG_A}/members/${USERS.viewer}`, member(USERS.viewer, 'viewer', ORG_A)],
      [`orgs/${ORG_B}/members/${USERS.otherOwner}`, member(USERS.otherOwner, 'owner', ORG_B)],
      [`orgs/${ORG_A}/projects/ARW`, { name: 'Website', key: 'ARW', status: 'active', itemSeq: 1, activeSprintId: 'sActive', memberIds: [USERS.member, USERS.viewer], createdBy: USERS.manager }],
      [`orgs/${ORG_A}/projects/MOB`, { name: 'Mobile', key: 'MOB', status: 'active', itemSeq: 0, activeSprintId: null, createdBy: USERS.manager }],
      [`orgs/${ORG_B}/projects/SEC`, { name: 'Secret', key: 'SEC', status: 'active', itemSeq: 1, activeSprintId: null, createdBy: USERS.otherOwner }],
      [`orgs/${ORG_A}/items/i1`, baseItem()],
      [`orgs/${ORG_B}/items/iB`, baseItem({ projectId: 'SEC', key: 'SEC-1', createdBy: USERS.otherOwner, updatedBy: USERS.otherOwner })],
      [`orgs/${ORG_A}/sprints/sPlanned`, { projectId: 'ARW', name: 'Sprint 2', status: 'planned', startDate: '2026-03-16', endDate: '2026-03-29', createdBy: USERS.manager }],
      [`orgs/${ORG_A}/sprints/sActive`, { projectId: 'ARW', name: 'Sprint 1', status: 'active', startDate: '2026-03-02', endDate: '2026-03-15', createdBy: USERS.manager }],
      [`orgs/${ORG_A}/sprints/sDone`, { projectId: 'ARW', name: 'Sprint 0', status: 'completed', startDate: '2026-02-16', endDate: '2026-03-01', createdBy: USERS.manager }],
      [`orgs/${ORG_A}/sprints/sOther`, { projectId: 'MOB', name: 'Mobile 1', status: 'planned', startDate: '2026-03-02', endDate: '2026-03-15', createdBy: USERS.manager }],
      [`orgs/${ORG_A}/sprints/sActive/events/start`, { type: 'sprint_started', scopeDelta: 0 }],
      [`orgs/${ORG_A}/auditLogs/log1`, { action: 'org.created', actorId: USERS.owner }],
      [`orgs/${ORG_A}/notifications/n1`, { recipientId: USERS.member, type: 'assigned', title: 'Hi', readAt: null }],
      [`users/${USERS.member}`, { displayName: 'Member', email: 'u-member@example.com' }],
    ]
    for (const [path, data] of writes) await setDoc(doc(db, path), data)
  })
}
