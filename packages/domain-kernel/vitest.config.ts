import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest для `packages/domain-kernel` (чистый VO-пакет, приравнивается к `domain/`
 * по порогу покрытия ≥90%, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §6).
 */
const COVERAGE_THRESHOLD_PERCENT = 90

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'dist/**'],
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.d.ts', '**/index.ts'],
      thresholds: {
        lines: COVERAGE_THRESHOLD_PERCENT,
        statements: COVERAGE_THRESHOLD_PERCENT,
        branches: COVERAGE_THRESHOLD_PERCENT,
        functions: COVERAGE_THRESHOLD_PERCENT,
      },
    },
  },
})
