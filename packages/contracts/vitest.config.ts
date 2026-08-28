import { defineConfig } from 'vitest/config'

/**
 * Конфигурация тестов `packages/contracts` (файла раньше не существовало — `vitest run`
 * использовал дефолты без enforcement покрытия). DTJ-005: ErrorCode/permission-строки/
 * cursor-пагинация — доменно-подобный код общего пользования, порог покрытия ≥70% (тикеты
 * волны 1). `coverage.enabled` заставляет обычный `vitest run` (а значит и `pnpm test` →
 * `turbo run test`) считать покрытие и падать при просадке ниже порога — без отдельного
 * флага `--coverage` в скрипте `test`.
 */

const COVERAGE_THRESHOLD_PERCENT = 70

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.d.ts'],
      thresholds: {
        lines: COVERAGE_THRESHOLD_PERCENT,
        statements: COVERAGE_THRESHOLD_PERCENT,
        branches: COVERAGE_THRESHOLD_PERCENT,
        functions: COVERAGE_THRESHOLD_PERCENT,
      },
    },
  },
})
