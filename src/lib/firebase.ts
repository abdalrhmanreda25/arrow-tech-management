'use client'

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

/**
 * Public web configuration for the arrow-tech-managment Firebase project.
 * These values ship in the bundle by design. Access control lives in
 * firestore.rules, never here.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBACBvt8V-AhgkrWf7EHCCj6yNw_OBkxYc',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'arrow-tech-managment.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'arrow-tech-managment',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'arrow-tech-managment.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '813291682092',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:813291682092:web:f9c7edc441982dbd371489',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-6S2Z5WZDYY',
}

export const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true'

interface Services {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

// Kept on globalThis so hot reload and repeated imports reuse one instance;
// initializeFirestore and connect*Emulator both throw if called twice.
const KEY = '__arrowTechFirebase__'
type Holder = typeof globalThis & { [KEY]?: Services }

export function firebase(): Services {
  const holder = globalThis as Holder
  if (holder[KEY]) return holder[KEY]

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  let db: Firestore
  try {
    // IndexedDB cache: reloads and revisits are served locally and listeners
    // resume from a token, so unchanged documents are not billed again.
    const browser = typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
    db = initializeFirestore(app, {
      localCache: browser && !USE_EMULATORS ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache(),
    })
  } catch {
    db = getFirestore(app)
  }
  const auth = getAuth(app)

  if (USE_EMULATORS) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9095', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8085)
  }

  holder[KEY] = { app, auth, db }
  return holder[KEY]
}

export const db = () => firebase().db
export const auth = () => firebase().auth

let analyticsStarted = false

/** Analytics only where the browser supports it; failure never affects the app. */
export function initAnalytics() {
  if (analyticsStarted || typeof window === 'undefined' || USE_EMULATORS) return
  analyticsStarted = true
  import('firebase/analytics')
    .then(({ isSupported, getAnalytics }) => isSupported().then((ok) => ok && getAnalytics(firebase().app)))
    .catch(() => {})
}
