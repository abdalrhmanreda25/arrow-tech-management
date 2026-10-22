export type ErrorKind = 'permission' | 'offline' | 'not-found' | 'conflict' | 'auth' | 'invalid' | 'index' | 'other'

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address is not valid.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account already uses that email.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Use at least 8 characters for your password.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled for the project yet.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/unauthorized-domain': 'This domain is not on the Firebase Authorized domains list.',
  'auth/requires-recent-login': 'Sign in again to continue.',
}

/** Thrown when an item changed between reading it and saving it. */
export class ConflictError extends Error {
  readonly code = 'conflict'
  constructor(message = 'Someone else changed this item while you were editing. Review the latest version and try again.') {
    super(message)
    this.name = 'ConflictError'
  }
}

function codeOf(err: unknown): string {
  const raw = (err as { code?: unknown })?.code
  return typeof raw === 'string' ? raw.replace(/^(functions|firestore|storage)\//, '') : ''
}

export function errorKind(err: unknown): ErrorKind {
  const code = codeOf(err)
  if (code === 'permission-denied' || code === 'unauthorized') return 'permission'
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'auth/network-request-failed' || code === 'retry-limit-exceeded') return 'offline'
  if (code === 'not-found' || code === 'object-not-found') return 'not-found'
  if (code === 'conflict' || code === 'aborted') return 'conflict'
  if (code === 'unauthenticated' || code.startsWith('auth/')) return 'auth'
  if (code === 'invalid-argument') return 'invalid'
  if (code === 'failed-precondition' && /index/i.test(String((err as Error)?.message))) return 'index'
  return 'other'
}

export function friendlyError(err: unknown): string {
  if (!err) return 'Something went wrong.'
  const code = codeOf(err)
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code]
  switch (errorKind(err)) {
    case 'permission':
      // Our own operations explain why; a bare rules denial does not.
      return (err as Error).name === 'OpError' || (err as Error).name === 'DomainError'
        ? (err as Error).message
        : 'You do not have permission to do that. Ask an admin if you need access.'
    case 'offline':
      return 'You appear to be offline. Changes will sync when the connection returns.'
    case 'index':
      return 'This view needs a Firestore index that is not deployed yet. Deploy firestore.indexes.json (firebase deploy --only firestore:indexes), or create it with the link below. Building takes a few minutes.'
    case 'not-found':
      return (err as Error).message || 'That item no longer exists.'
    default:
      break
  }
  const message = (err as Error)?.message
  // Our own operations throw readable messages; Firestore internals do not.
  if (message && !/^\[?firebase|internal assertion/i.test(message)) return message.replace(/^Firebase: /, '')
  return 'Something went wrong. Try again.'
}

/** Firestore's missing-index errors carry a console link that creates the index in one click. */
export function indexLink(err: unknown): string | null {
  const m = String((err as Error)?.message ?? '').match(/https:\/\/console\.firebase\.google\.com\/[^\s)"']+/)
  return m ? m[0] : null
}
