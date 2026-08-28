import { defineConfig } from 'vitest/config'

/**
 * Конфигурация тестов `packages/testing-kit` (файла раньше не существовало — `vitest run`
 * использовал дефолты без enforcement покрытия). DTJ-416: порог покрытия — 90% (эквивалент
 * domain/application по строгости для тестовой инфраструктуры, на которую полагаются все
 * остальные тесты платформы). `coverage.enabled` заставляет обычный `vitest run` (а значит и
 * `pnpm test` → `turbo run test`) считать покрытие и падать при просадке ниже порога — без
 * отдельного флага `--coverage` в скрипте `test`.
 */

const COVERAGE_THRESHOLD_PERCENT = 90

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // `index.ts` — барабанный экспорт (D-27), без собственной логики.
      exclude: ['**/*.spec.ts', '**/*.d.ts', 'src/index.ts'],
      thresholds: {
        lines: COVERAGE_THRESHOLD_PERCENT,
        statements: COVERAGE_THRESHOLD_PERCENT,
        branches: COVERAGE_THRESHOLD_PERCENT,
        functions: COVERAGE_THRESHOLD_PERCENT,
      },
    },
  },
})
