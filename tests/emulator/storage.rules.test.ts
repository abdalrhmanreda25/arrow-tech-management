import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { getBytes, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage'
import { ORG_A, PROJECT_ID, seed, USERS } from './seed'

let env: RulesTestEnvironment

const storageAs = (uid: string | null) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage() as unknown as FirebaseStorage

const file = (size = 16) => new Uint8Array(size)
const meta = (uid: string, contentType = 'application/pdf') => ({ contentType, customMetadata: { uploadedBy: uid } })
const path = (org = ORG_A) => `orgs/${org}/items/i1/att-1`

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.clearStorage()
  await seed(env)
})

afterAll(async () => {
  await env.cleanup()
})

describe('storage rules', () => {
  it('lets members upload attachments that name them as uploader', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs(USERS.member), path()), file(), meta(USERS.member)))
    await assertFails(uploadBytes(ref(storageAs(USERS.member), path()), file(), meta(USERS.owner)))
  })

  it('denies viewers, outsiders and other orgs', async () => {
    await assertFails(uploadBytes(ref(storageAs(USERS.viewer), path()), file(), meta(USERS.viewer)))
    await assertFails(uploadBytes(ref(storageAs(USERS.outsider), path()), file(), meta(USERS.outsider)))
    await assertFails(uploadBytes(ref(storageAs(USERS.otherOwner), path()), file(), meta(USERS.otherOwner)))
    await assertFails(uploadBytes(ref(storageAs(null), path()), file(), meta('anon')))
  })

  it('isolates reads by organization', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs(USERS.member), path()), file(), meta(USERS.member)))
    await assertSucceeds(getBytes(ref(storageAs(USERS.viewer), path())))
    await assertFails(getBytes(ref(storageAs(USERS.otherOwner), path())))
    await assertFails(getBytes(ref(storageAs(USERS.outsider), path())))
  })

  it('enforces size and type limits', async () => {
    await assertFails(uploadBytes(ref(storageAs(USERS.member), path()), file(10 * 1024 * 1024 + 1), meta(USERS.member)))
    await assertFails(uploadBytes(ref(storageAs(USERS.member), path()), file(), meta(USERS.member, 'text/html')))
    await assertFails(uploadBytes(ref(storageAs(USERS.member), path()), file(), meta(USERS.member, 'application/x-msdownload')))
  })

  it('limits org branding to admins', async () => {
    const logo = `orgs/${ORG_A}/branding/logo.png`
    await assertFails(uploadBytes(ref(storageAs(USERS.manager), logo), file(), { contentType: 'image/png' }))
    await assertSucceeds(uploadBytes(ref(storageAs(USERS.admin), logo), file(), { contentType: 'image/png' }))
  })
})
