import { defineConfig } from 'vitest/config'

/**
 * Конфигурация тестов `apps/worker` (файла раньше не существовало — `vitest run` использовал
 * дефолты без enforcement покрытия). DTJ-002, тест-план: "Coverage `common/`/`jobs/`
 * (infrastructure-подобный код) — ≥70%". `coverage.enabled` заставляет обычный `vitest run`
 * (а значит и `pnpm test` → `turbo run test`) считать покрытие и падать при просадке ниже
 * порога — без отдельного флага `--coverage` в скрипте `test`.
 */

const COVERAGE_THRESHOLD_PERCENT = 70

export default defineConfig({
  test: {
    environment: 'node',
    // `dist/**` может содержать скомпилированные `*.spec.js` (см. tsconfig.json `files`),
    // их не нужно запускать повторно как отдельный набор тестов поверх `src/**/*.spec.ts`.
    exclude: ['**/node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html'],
      include: ['src/common/**/*.ts', 'src/jobs/**/*.ts'],
      // `*.module.ts` — чистая DI-разводка Nest (метаданные `@Module`, без своей логики).
      // `outbox-relay.scheduler.ts` намеренно не юнит-тестируется без реального BullMQ
      // `Worker`/Redis (см. комментарий в `outbox-relay.processor.ts` — эта логика оставлена
      // юнит-тестируемой отдельно от планировщика ровно по этой причине); он покрывается
      // integration/e2e-тестами позже (DTJ-016).
      exclude: ['**/*.spec.ts', '**/*.d.ts', '**/*.module.ts', '**/outbox-relay.scheduler.ts'],
      thresholds: {
        lines: COVERAGE_THRESHOLD_PERCENT,
        statements: COVERAGE_THRESHOLD_PERCENT,
        branches: COVERAGE_THRESHOLD_PERCENT,
        functions: COVERAGE_THRESHOLD_PERCENT,
      },
    },
  },
})
