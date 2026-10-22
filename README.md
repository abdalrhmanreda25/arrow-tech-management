# Arrow Tech Team Management

Team management dashboard for Arrow Tech: organizations, teams, projects, a product
backlog with epics and stories, Scrum sprints with capacity planning and ceremonies,
a persistent board, sprint history, burndown/burnup, velocity, carryover reports,
calendar, roadmap, notifications, an audit log and CSV export.

It is a Next.js 15 static export that talks to Firebase directly through the
client SDK. There is no server code and no Cloud Functions, so it runs on the free
Spark plan. Security is enforced entirely by `firestore.rules` and `storage.rules`,
including the multi-document invariants (owners, one active sprint per project,
sprint history), which the rules check with `getAfter()`/`existsAfter()`. The look
comes from the arrowtech.online design system: `src/app/brand.css` is copied from
that site.

## Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 15 (App Router, `output: 'export'`), React 19, TypeScript, Recharts |
| Data | Cloud Firestore (persistent local cache), Cloud Storage |
| Auth | Firebase Authentication, email/password. No public sign-up: admins create accounts |
| Server | None. Firebase client SDK only; rules are the trust boundary |
| Tests | Vitest, `@firebase/rules-unit-testing`, Firebase Emulator Suite |

## Getting started

Requirements: Node 22, pnpm, Java 17+ (21 recommended) for the emulators, and `firebase-tools` 14.

```bash
pnpm install

# Run everything locally against emulators (no cloud project touched)
pnpm emulators                      # terminal 1: auth, firestore, storage, UI at :4005
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-arrow-tech pnpm dev:emulators   # terminal 2: http://localhost:3000
```

Create the first user in the Emulator UI (Authentication tab), sign in, and create the
organization. Everyone else is added from Members → Add team member.

To run the app against the real `arrow-tech-managment` project, just `pnpm dev`; the
public web config is in `.env.production` and in `src/lib/firebase.ts`.

## Checks

```bash
pnpm lint              # eslint + tsc
pnpm test:unit         # domain maths: roles, transitions, history entries, reports, capacity, CSV, calendar
pnpm test:emulator     # Firestore + Storage rules, including org creation, invites, owners, sprints, forged history
pnpm test:integration  # real Auth-emulator users drive src/lib/api.ts and the data layer through the rules
pnpm test              # all three
pnpm build             # static export in out/
```

## Architecture

```
src/app/                 routes (all client-rendered, static export)
  (app)/                 signed-in shell: dashboard, backlog, board, sprints, sprint,
                         item, roadmap, calendar, reports, projects, teams, members,
                         notifications, audit, settings, profile
  login signup reset-password invite
src/components/          shell, providers (auth, org, toast), dialogs, charts, ui kit
src/lib/api.ts           org, invite, role, member and sprint lifecycle operations (transactions)
src/lib/data/            items (with sprint history), sprints, org, activity; hooks, errors
src/domain/              pure TypeScript: roles, sprint transitions, history entries, reports,
                         capacity, CSV. The rules mirror the same thresholds and maths.
firestore.rules  storage.rules  firestore.indexes.json
tests/unit  tests/emulator  tests/integration
```

### Data model

```
users/{uid}                              private profile
orgs/{orgId}                             name, timeZone, ownerId, memberCount
  members/{uid}                          role, status, displayName, email, orgName
  invites/{secretId}                     email, role, expiresAt; the id is the link secret
  teams/{teamId}
  projects/{KEY}                         doc id is the project key (unique per org); itemSeq counter
  items/{itemId}                         epic | story | task | bug; key ARW-12; version; sprintId
    comments/{id}  attachments/{id}
  sprints/{sprintId}                     status, dates, capacity, stats
    events/{itemId}-{version}            sprint history, written with each item change (immutable)
    snapshots/start  snapshots/final     commitment and closing record                 (immutable)
  ceremonies/{id}                        planning, stand-up, refinement, review, retro
  notifications/{id}                     per recipient; actor and time stamped by rules
  auditLogs/{id}                         append-only; actor and time stamped by rules
```

### Security model

All enforcement is in the rules; the browser code repeats the checks only to give
clear error messages.

- **Organization isolation.** All org data lives under `orgs/{orgId}`. Every rule
  checks the caller's own member document there, so a member of org A cannot read or
  write anything in org B. Users find their orgs with a collection-group query that
  rules restrict to `uid == request.auth.uid`.
- **Accounts.** There is no sign-up page and no Google sign-in. An admin creates each
  team account from the Members page: the browser creates it in a second, in-memory
  Firebase app (so the admin stays signed in), and the new account joins through a
  single-use invite the admin made a moment earlier. Rules let it take only the invited
  role (never owner) and only for its own email. If the email already has an account,
  the admin gets a 7-day join link instead.
- **Creating an org** is one batch: the org document and the creator's owner
  membership. Rules accept an owner membership only together with a brand-new org whose
  `ownerIds` is exactly the creator. This is how the first owner sets things up.
- **Roles.** viewer < member < manager < admin < owner, mirrored from
  `src/domain/roles.ts`. Admins grant up to manager and act only below their own level,
  owners can do anything, and nobody changes their own role. `org.ownerIds` must always
  equal the set of owner members and can never be empty, which the rules check in the
  same batch. So the last owner cannot be demoted or leave, even when two owners demote
  each other at the same moment.
- **Invites.** The invite document id is a 32-byte random secret. Only admins can list
  invites; the invitee can open one only when their account email matches. Accepting
  creates their membership with exactly the invited role and marks the invite accepted
  in the same batch, so it works once.
- **Sprint lifecycle.** Planned → active → completed only, by managers, with the start or
  complete record and snapshot in the same transaction. The project's `activeSprintId`
  moves with it, so a project never has two active sprints. Only the items listed at
  completion can leave a completed sprint, only to the recorded destination, and only
  once.
- **Sprint history.** Any item change that alters an active sprint's scope or done
  points must create history entry `{itemId}-{version}` in the same transaction. The
  rules recompute that entry's numbers from the item before and after the write, so the
  history behind burndown and velocity cannot be forged or skipped.
- **Concurrency.** Item keys come from a transaction that bumps the project counter.
  Every item write moves `version` forward by one and stamps `updatedAt` with the server
  time, so stale editors get a conflict.
- **Reports** are rebuilt from the history entries. If a sprint has no start record, the
  report says so and draws nothing rather than guessing.

What client-only enforcement cannot do (a server would be needed):
- The commitment and closing totals stored on a sprint are computed by the manager's
  browser. The rules check who changed the status, and when, but not that arithmetic.
  Daily history entries are fully checked.
- Audit entries are written by the client beside each change. The rules stop them being
  forged or edited, but a modified client could leave one out.
- Firebase's public sign-up endpoint stays open (the app's own account creation uses
  it). An account made that way belongs to no organization and the rules show it
  nothing. To close the endpoint entirely you would need Identity Platform's "Enable
  create (sign-up)" setting, which breaks admin account creation from the browser.
- Admins cannot delete or change other people's sign-in accounts from the browser.
  Removing a member revokes all access to the org; "Reset password" emails a reset link.
- Organization creation is not rate-limited per user.

### Cost controls

Realtime listeners only where they matter: memberships, the current org, members and
projects, the active board, the open item, comments and the unread badge. Backlog,
item lists and the audit log use cursor pages of 50. Reports and sprint history are
one-shot reads loaded when a tab opens. Dashboard counts use aggregation queries.
Long text fields are excluded from indexing. The web SDK uses a persistent IndexedDB
cache, so revisits are served locally.

## Deploying

The repo is configured for the `arrow-tech-managment` Firebase project (`.firebaserc`).

1. **Plan.** The free Spark plan is enough; there are no Cloud Functions.
2. **Authentication.** Enable Email/Password (Google is not used). Under Settings →
   Authorized domains, add the hosting domain(s).
3. **Firestore** in Native mode and **Storage** must exist (create them in the console).
4. Sign in with an account that has Owner or Editor on the project, then deploy:

   ```bash
   firebase login
   pnpm deploy:rules        # firestore rules + indexes, storage rules
   pnpm deploy:hosting      # optional: builds out/ and deploys Firebase Hosting
   ```

   Index builds take a few minutes. Until they finish, list views that need them show a
   "missing index" message.
5. **Storage cross-service rules.** `storage.rules` reads membership from Firestore. On the
   first `deploy:rules`, accept the prompt that grants Storage permission to read Firestore.
6. **App Check (recommended).** Register a reCAPTCHA Enterprise provider and enforce App
   Check for Firestore and Storage so only this web app can call them.

### Vercel (production: https://arrow-tech-management.vercel.app)

1. Push this repo to GitHub and import it at https://vercel.com/new. `vercel.json`
   sets pnpm install/build and the security headers; the static export in `out/` is
   served as is.
2. No environment variables are required: the public Firebase web config is in
   `.env.production` and in `src/lib/firebase.ts`. To point a deployment at another
   Firebase project, set the same `NEXT_PUBLIC_FIREBASE_*` names in Vercel.
3. Firebase Console → Authentication → Settings → **Authorized domains** → add
   `arrow-tech-management.vercel.app` (and any custom domain). Sign-in and password-reset
   links fail on domains that are not listed. Vercel preview URLs
   (`...-git-...vercel.app`) are not covered; test sign-in on production or localhost.
4. Rules are not deployed by Vercel. Deploy them separately with `pnpm deploy:rules`
   whenever `firestore.rules`, `storage.rules` or `firestore.indexes.json` change.

Any other static host can serve `out/` the same way.

## Known limitations

- Admins share temporary passwords themselves (or tick "email a reset link").
- Reports use calendar days, weekends included. Business-day burndowns are not modelled.
- The board workflow has four fixed statuses: To do, In progress, In review, Done.
- Backlog drag-and-drop reorders within the loaded pages.
- A single sprint start or completion handles at most 400 items.
- Item edits use transactions, so they need a connection; cached data still shows offline.
