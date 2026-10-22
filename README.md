# Arrow Tech Team Management

Team management dashboard for Arrow Tech: organizations, teams, projects, a product
backlog with epics and stories, Scrum sprints with capacity planning and ceremonies,
a persistent board, sprint history, burndown/burnup, velocity, carryover reports,
calendar, roadmap, notifications, an audit log and CSV export.

It is a Next.js 15 static export that talks to Firebase directly. Anything that has
to be trusted (membership, roles, invites, sprint start and completion, sprint
history, audit logs, notifications) runs in Cloud Functions. The look comes from the
arrowtech.online design system: `src/app/brand.css` is copied from that site.

## Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 15 (App Router, `output: 'export'`), React 19, TypeScript, Recharts |
| Data | Cloud Firestore (persistent local cache), Cloud Storage |
| Auth | Firebase Authentication (email/password with email verification, Google) |
| Server | Cloud Functions v2 (Node 22): callables and Firestore triggers |
| Tests | Vitest, `@firebase/rules-unit-testing`, Firebase Emulator Suite |

## Getting started

Requirements: Node 22, pnpm, Java 17+ (21 recommended) for the emulators, and `firebase-tools` 14.

```bash
pnpm install
pnpm --dir functions install

# Run everything locally against emulators (no cloud project touched)
pnpm emulators                      # terminal 1: auth, firestore, storage, functions, UI at :4005
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-arrow-tech pnpm dev:emulators   # terminal 2: http://localhost:3000
```

Users created in the Auth emulator start unverified. Verify one from the Emulator UI
(Authentication tab) before creating an organization.

To run the app against the real `arrow-tech-managment` project, just `pnpm dev`; the
public web config is in `.env.production` and in `src/lib/firebase.ts`.

## Checks

```bash
pnpm lint              # eslint + tsc (web) + tsc (functions)
pnpm test:unit         # domain maths: roles, transitions, history deltas, reports, capacity, CSV, calendar
pnpm test:emulator     # Firestore + Storage rules, and services against the Firestore emulator
pnpm test:integration  # full emulator suite: real sign-in -> callables over HTTP -> triggers
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
src/lib/                 firebase init, callable client, data layer, hooks, errors
functions/src/domain/    pure TypeScript shared by web and functions:
                         roles, sprint transitions, history deltas, reports, capacity, CSV
functions/src/services/  trusted operations (org, invites, members, sprints, history, notifications)
functions/src/index.ts   callable wrappers and Firestore triggers
firestore.rules  storage.rules  firestore.indexes.json
tests/unit  tests/emulator  tests/integration  functions/test
```

### Data model

```
users/{uid}                              private profile
orgs/{orgId}                             name, timeZone, ownerId, memberCount
  members/{uid}                          role, status, displayName, email, orgName   (functions only)
  invites/{id}                           email, role, tokenHash, expiresAt           (functions only)
  teams/{teamId}
  projects/{KEY}                         doc id is the project key (unique per org); itemSeq counter
  items/{itemId}                         epic | story | task | bug; key ARW-12; version; sprintId
    comments/{id}  attachments/{id}
  sprints/{sprintId}                     status, dates, capacity, stats
    events/{id}                          sprint history, written by the item trigger   (functions only)
    snapshots/start  snapshots/final     commitment and closing record                (functions only)
  ceremonies/{id}                        planning, stand-up, refinement, review, retro
  notifications/{id}                     per recipient                                (functions only)
  auditLogs/{id}                                                                      (functions only)
```

### Security model

- **Organization isolation.** All org data lives under `orgs/{orgId}`. Every rule
  checks the caller's own member document there, so a member of org A cannot read or
  write anything in org B. Users find their orgs with a collection-group query that
  rules restrict to `uid == request.auth.uid`.
- **Roles.** viewer < member < manager < admin < owner. Thresholds live in
  `functions/src/domain/roles.ts` and are mirrored in both rules files. Member docs are
  never client-writable, so nobody can change a role from the browser. Role changes go
  through `changeMemberRole`, which re-reads the caller's role in a transaction:
  admins can grant up to manager and only act below their own level, nobody changes
  their own role, and the last owner cannot be demoted or leave.
- **Invites.** `createInvite` returns a one-time token; only its SHA-256 is stored.
  Accepting needs the token, the invited email address and a verified email.
- **Sprint lifecycle.** Status, stats, events and snapshots are function-only.
  `startSprint` serialises on the project document, so a project never has two active
  sprints. `completeSprint` recomputes closing numbers from the items, moves unfinished
  work to the backlog or a planned sprint, and stores a final snapshot.
- **Concurrency.** Item keys come from a transaction that bumps the project counter;
  rules reject a key that does not match it. Every item write must bump `version` by
  one and stamp `updatedAt` with the server time, so stale editors get a conflict and
  history is ordered by commit time.
- **Sprint history.** The `onItemWritten` trigger turns each item write into sprint
  events (added, removed, re-estimated, completed, reopened) and keeps running totals.
  It is idempotent per trigger event and ignores writes made before the sprint started.
- **Reports** are rebuilt from those events. If a sprint has no start record (for
  example, it started before functions were deployed), the report says so and draws
  nothing rather than guessing.

### Cost controls

Realtime listeners only where they matter: memberships, the current org, members and
projects, the active board, the open item, comments and the unread badge. Backlog,
item lists and the audit log use cursor pages of 50. Reports and sprint history are
one-shot reads loaded when a tab opens. Dashboard counts use aggregation queries.
Long text fields are excluded from indexing. The web SDK uses a persistent IndexedDB
cache, so revisits are served locally.

## Deploying

The repo is configured for the `arrow-tech-managment` Firebase project (`.firebaserc`).

1. **Plan.** Cloud Functions need the Blaze (pay as you go) plan.
2. **Authentication.** Enable Email/Password (enable Google too if you want the Google
   button to work). Under Settings → Authorized domains, add the hosting domain(s).
3. **Firestore** in Native mode and **Storage** must exist (create them in the console).
4. Sign in with an account that has Owner or Editor on the project, then deploy:

   ```bash
   firebase login
   pnpm deploy:rules        # firestore rules + indexes, storage rules
   pnpm deploy:functions    # 9 callables + 6 triggers (runs install + build first)
   pnpm deploy:hosting      # optional: builds out/ and deploys Firebase Hosting
   ```

   Index builds take a few minutes. Until they finish, list views that need them show a
   "missing index" message.
5. **Storage cross-service rules.** `storage.rules` reads membership from Firestore. On the
   first `deploy:rules`, accept the prompt that grants Storage permission to read Firestore.
6. **Region.** Functions deploy to `us-central1`. To move them, change
   `functions/src/config.ts` and `NEXT_PUBLIC_FUNCTIONS_REGION` together.
7. **App Check (recommended).** Register a reCAPTCHA Enterprise provider, add App Check
   to the web app, then set `ENFORCE_APP_CHECK=true` for the functions.

Any static host can serve `out/` instead of Firebase Hosting; add its domain to the
Authorized domains list.

## Known limitations

- Invite emails are not sent. Admins copy the invite link and send it themselves (adding
  the Trigger Email extension would automate this).
- Reports use calendar days, weekends included. Business-day burndowns are not modelled.
- The board workflow has four fixed statuses: To do, In progress, In review, Done.
- Backlog drag-and-drop reorders within the loaded pages.
- History exists only for sprints started after the functions were deployed.
- A single sprint start or completion handles at most 400 items.
