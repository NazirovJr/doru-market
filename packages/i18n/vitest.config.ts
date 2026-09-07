import { defineConfig } from 'vitest/config'

/**
 * Конфигурация тестов `packages/i18n` (файла раньше не существовало — `vitest run` использовал
 * дефолты без enforcement покрытия). DTJ-004: словари tj/ru/en + `useT()`, порог покрытия
 * ≥70% (тикеты волны 1). `coverage.enabled` заставляет обычный `vitest run` (а значит и
 * `pnpm test` → `turbo run test`) считать покрытие и падать при просадке ниже порога — без
 * отдельного флага `--coverage` в скрипте `test`.
 *
 * DTJ-402: `resolveLocale`/`format-*.ts` — чистые функции (эквивалент `domain`/`application` по
 * строгости требований тикета) — порог для них поднят до 90% отдельным per-file правилом,
 * остальной пакет остаётся на базовом 70%.
 */

const COVERAGE_THRESHOLD_PERCENT = 70
const PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT = 90

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
      // `i18n-provider.tsx` — тонкая React-обвязка (DTJ-402 п.10), без ветвлений бизнес-логики;
      // покрывается компонентными тестами последующих фронтовых тикетов, не входит в скоуп этого.
      exclude: ['**/*.spec.ts', '**/*.d.ts', 'src/index.ts', 'src/i18n-provider.tsx'],
      thresholds: {
        lines: COVERAGE_THRESHOLD_PERCENT,
        statements: COVERAGE_THRESHOLD_PERCENT,
        branches: COVERAGE_THRESHOLD_PERCENT,
        functions: COVERAGE_THRESHOLD_PERCENT,
        'src/resolve-locale.ts': {
          lines: PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT,
          statements: PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT,
          branches: PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT,
          functions: PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT,
        },
        'src/format-*.ts': {
          lines: PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT,
          statements: PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT,
          branches: PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT,
          functions: PURE_FUNCTION_COVERAGE_THRESHOLD_PERCENT,
        },
      },
    },
  },
})
