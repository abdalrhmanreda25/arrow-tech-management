// `firebase emulators:exec` exports the emulator hosts. These defaults let the
// suite also run against an emulator started separately with `pnpm emulators`.
process.env.GCLOUD_PROJECT ||= 'demo-arrow-tech'
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9195'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9095'
