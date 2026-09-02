import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Инфраструктура тестов `apps/api` (не в files_owned DTJ-001 явным путём, но необходима
 * для тест-плана тикета — файла раньше не существовало). `test.env` даёт валидный дефолтный
 * ENV, чтобы `AppConfigModule`/Zod-схема не падали при импорте в интеграционных тестах;
 * unit-тесты самой схемы (`env.schema.spec.ts`) вызывают `validateEnv(...)` напрямую, минуя
 * `process.env`.
 */

// Порог покрытия из тикетов волны 1 (DTJ-001 и др.): ≥70% для apps/api. `coverage.enabled`
// заставляет `vitest run` (а значит и `pnpm test` → `turbo run test`) считать покрытие и
// падать при просадке ниже порога без отдельного флага `--coverage` в скрипте `test`.
const COVERAGE_THRESHOLD_PERCENT = 70

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // `dist/**` может содержать скомпилированные `*.spec.js` (см. tsconfig.json `files` —
    // спек-файлы явно включены в компиляцию ради `tsc --noEmit`), их не нужно запускать
    // повторно как отдельный набор тестов поверх `src/**/*.spec.ts`.
    //
    // `test/integration/**` исключён НАМЕРЕННО: у интеграционного набора есть свой конфиг
    // (`vitest.integration.config.ts`) с `pool: 'forks'` + `fileParallelism: false`, потому
    // что его файлы делят ОДНУ реальную Postgres-БД без изоляции схемы и делают
    // `TRUNCATE`/`INSERT` по общим таблицам (`categories`, `medicines`). Дефолтный `include`
    // Vitest ловит `**/*.spec.ts` по всему пакету, то есть без этой строки `pnpm test`
    // запускал интеграционные спеки ЕЩЁ РАЗ, но уже параллельно и без сериализации — что
    // давало ровно те гонки, от которых защищается интеграционный конфиг: посторонние строки
    // в выборках, `medicines_category_id_fkey` при вставке в вычищенную соседом таблицу.
    // Наборы обязаны быть непересекающимися: unit — `src/**`, integration — `test/integration/**`.
    exclude: ['**/node_modules/**', 'dist/**', 'test/integration/**'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/dorutj_test',
      REDIS_URL: 'redis://localhost:6379',
      CORS_STATIC_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'error',
    },
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html'],
      include: ['src/common/**/*.ts', 'src/config/**/*.ts'],
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
