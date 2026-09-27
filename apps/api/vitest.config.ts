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

// Общие исключения — переиспользуются и `unit`, и `full-boot-di` project'ами ниже (иначе
// пришлось бы держать один и тот же список в двух местах и различие само стало бы дефектом).
const COMMON_EXCLUDE = [
  '**/node_modules/**',
  // `dist/**` может содержать скомпилированные `*.spec.js` (см. tsconfig.json `files` —
  // спек-файлы явно включены в компиляцию ради `tsc --noEmit`), их не нужно запускать
  // повторно как отдельный набор тестов поверх `src/**/*.spec.ts`.
  'dist/**',
  // `test/integration/**` исключён НАМЕРЕННО: у интеграционного набора есть свой конфиг
  // (`vitest.integration.config.ts`) с `pool: 'forks'` + `fileParallelism: false`, потому
  // что его файлы делят ОДНУ реальную Postgres-БД без изоляции схемы и делают
  // `TRUNCATE`/`INSERT` по общим таблицам (`categories`, `medicines`). Дефолтный `include`
  // Vitest ловит `**/*.spec.ts` по всему пакету, то есть без этой строки `pnpm test`
  // запускал интеграционные спеки ЕЩЁ РАЗ, но уже параллельно и без сериализации — что
  // давало ровно те гонки, от которых защищается интеграционный конфиг: посторонние строки
  // в выборках, `medicines_category_id_fkey` при вставке в вычищенную соседом таблицу.
  // Наборы обязаны быть непересекающимися: unit — `src/**`, integration — `test/integration/**`.
  'test/integration/**',
]

// Паттерн DI-специк, которые поднимают РЕАЛЬНЫЙ Nest-контейнер целиком через каскад
// `await import(...)` (AppConfigModule → ... → искомый модуль) — `*.full-boot.di.spec.ts`
// (admin/orders/notifications/inventory/support/payments) и `*driver.spec.ts`
// (payments.module.non-mock-driver / payments.module.dc-next-driver).
const FULL_BOOT_DI_INCLUDE = ['src/**/*.full-boot.di.spec.ts', 'src/**/*driver.spec.ts']

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
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
    /**
     * ПОЧЕМУ ДВА PROJECT'А (не один плоский конфиг).
     *
     * `*.full-boot.di.spec.ts`/`*driver.spec.ts` (admin/orders/notifications/inventory/
     * support/payments) поднимают РЕАЛЬНЫЙ Nest-контейнер через `Test.createTestingModule(...)
     * .compile()` поверх каскада `await import(...)` всего графа модулей (AppConfigModule,
     * LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, IdempotencyModule,
     * AuditLogModule, DomainEventsModule, + сам искомый модуль и его собственные импорты
     * вроде OrdersModule/PaymentsModule). Изолированно такой импорт+compile занимает
     * ~8–20с (замерено `time pnpm exec vitest run <файл>`, см. коммит). Внутри каждого файла
     * уже стоит явный `it(..., 30_000)` (`FULL_BOOT_TIMEOUT_MS`) — этого достаточно, когда
     * файл гоняется один.
     *
     * Но под `pnpm test` → `turbo run test` (все 9 пакетов монорепо параллельно, песочница
     * 4 CPU) дефолтный пул Vitest раскладывает файлы по нескольким форкам по мере готовности:
     * если 2+ из этих тяжёлых файлов достаются РАЗНЫМ форкам ОДНОВРЕМЕННО, каждый форк
     * заново (с нуля, cold) прогоняет esbuild/rollup-трансформ одного и того же огромного
     * графа зависимостей — и на 4 CPU, разделённых ещё и между остальными 8 пакетами
     * монорепо, это регулярно упирается в `FULL_BOOT_TIMEOUT_MS`. Замер: изолированно файл
     * компилируется за ~9с (`transform 5.97s`), при параллельном `turbo run test` —
     * до 19.6с (см. отчёт тикета, замеры `time pnpm exec turbo run test --force`,
     * `payments.module.non-mock-driver.spec.ts` 19365мс/19652мс на двух подряд прогонах).
     * Изолированные прогоны проходят стабильно — тесты написаны верно, ломается только
     * конкурентное расписание, поэтому это инфраструктурный, а не логический дефект.
     *
     * Фикс: отдельный project `full-boot-di` с `pool: 'forks'` + `fileParallelism: false` —
     * все такие специки гоняются ПОСЛЕДОВАТЕЛЬНО в ОДНОМ форке. Эффект двойной:
     * 1) они больше не конкурируют ДРУГ С ДРУГОМ за CPU (не могут попасть в разные форки
     *    одновременно — форк один);
     * 2) esbuild/rollup-транcформ общего графа (AppConfigModule и т.д.) прогревается
     *    ОДИН раз для первого файла в форке и переиспользуется Vite dev-сервером того же
     *    процесса для остальных — этим объясняется наблюдаемое ускорение внутри одного
     *    прогона (первый файл 19.6с, следующие в том же прогоне — 1.7–7.7с, см. тот же
     *    отчёт).
     * `testTimeout: 60_000` — вторая линия защиты ПОВЕРХ файлового `FULL_BOOT_TIMEOUT_MS`
     * (тот по-прежнему стоит явно 30_000 в самих файлах и именно он определяет фактический
     * бюджет; если его когда-нибудь уберут по ошибке, дефолт Vitest — 5_000мс — упал бы
     * мгновенно). 60_000 — не «задранное на всякий случай число», а запас (~3× от
     * измеренного худшего случая 19.6с при параллельном `turbo run test`), обоснованный
     * этим же комментарием.
     *
     * `unit` project — все остальные специки `apps/api`, дефолтный пул (многопоточный),
     * поведение не меняется.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...COMMON_EXCLUDE, ...FULL_BOOT_DI_INCLUDE],
        },
      },
      {
        extends: true,
        test: {
          name: 'full-boot-di',
          include: FULL_BOOT_DI_INCLUDE,
          exclude: COMMON_EXCLUDE,
          pool: 'forks',
          // Vitest 4 убрал `poolOptions.forks.singleFork` (см. migration guide —
          // `poolOptions` целиком удалён, опции пула теперь top-level). Эквивалент —
          // `fileParallelism: false`: файлы этого project'а гоняются последовательно
          // в одном форке.
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },
    ],
  },
})
