import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        resolve: { alias },
        test: {
          name: 'emulator',
          // Service tests live under functions/ so they load that package's Admin SDK.
          include: ['tests/emulator/**/*.test.ts'],
          environment: 'node',
          // Every file shares one emulator, so files run one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
          setupFiles: ['tests/emulator/setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60_000,
          setupFiles: ['tests/emulator/setup.ts'],
        },
      },
    ],
  },
})
