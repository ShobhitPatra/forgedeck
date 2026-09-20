import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Many tests compile whole fixture apps (ts-morph program loads) or spawn
    // the CLI via tsx; both routinely exceed the 5s default under a loaded
    // worker pool. Bounded workers + a wider timeout keep the default
    // `pnpm test` deterministic instead of contention-flaky.
    testTimeout: 30_000,
    maxWorkers: 4,
    minWorkers: 1,
  },
})
