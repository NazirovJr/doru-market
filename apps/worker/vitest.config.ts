import { defineConfig } from 'vitest/config'

/**
 * Конфигурация тестов `apps/worker` (файла раньше не существовало — `vitest run` использовал
 * дефолты без enforcement покрытия). DTJ-002, тест-план: "Coverage `common/`/`jobs/`
 * (infrastructure-подобный код) — ≥70%". `coverage.enabled` заставляет обычный `vitest run`
 * (а значит и `pnpm test` → `turbo run test`) считать покрытие и падать при просадке ниже
 * порога — без отдельного флага `--coverage` в скрипте `test`.
 *
 * `pool: 'forks'` + `fileParallelism: false` (найдено при DTJ-250/254 — ТРЕТИЙ/ВТОРОЙ
 * `*.job.integration.spec.ts` файл, пишущий в `orders` реальным Postgres, обнажил гонку,
 * которую `apps/api/vitest.integration.config.ts` уже решила ТЕМ ЖЕ приёмом для идентичного
 * класса проблемы, см. её JSDoc): несколько интеграционных файлов (`unpaid-order-timeout`/
 * `pickup-sla-timeout`/`payout-execution`) сеют `orders.order_number` СВОИМ независимым
 * счётчиком, начинающимся с одного и того же префикса-даты — параллельный запуск файлов в
 * разных vitest-воркерах даёт `duplicate key value violates unique constraint
 * "orders_order_number_key"` на конкурентных INSERT против ОДНОЙ реальной БД. Сериализация
 * файлов (тот же компромисс, что у `apps/api`: тесты ВНУТРИ одного файла всё равно
 * распараллеливаются векторно, каждый создаёт свой независимый `pg.Pool`/сервер) убирает гонку
 * без переписывания seed-хелперов каждого файла.
 *
 * **`projects` — `unit`/`full-boot-di` (см. отчёт задачи стабилизации тестов, тот же класс
 * проблемы, что `apps/api/vitest.config.ts`, см. её JSDoc).** `*.module.spec.ts`
 * (`mock-bank-auto-pay`/`partial-fulfillment-timeout`/`picking-sla-watchdog`) поднимают
 * РЕАЛЬНЫЙ Nest-контейнер через `Test.createTestingModule(...).compile()` поверх каскада
 * `await import(...)` (`ConfigModule` + сам искомый модуль). Изолированно компилируется
 * быстро (~0.9–1.1с, см. отчёт задачи), но под параллельным `turbo run test` (все 9 пакетов
 * монорепо разом, песочница 4 CPU) esbuild/rollup-трансформ этого графа зависимостей конкурирует
 * за CPU с остальными пакетами и регулярно не укладывается в дефолтный `testTimeout` Vitest
 * (5000мс) — падает нерегулярно, хотя сам код SUT не менялся (инфраструктурный, а не логический
 * дефект, тот же диагноз, что у `apps/api`).
 *
 * Фикс — отдельный project `full-boot-di` с собственным `testTimeout: 30_000` (запас с кратным
 * резервом от измеренного изолированного времени, тот же порядок обоснования, что у `apps/api`,
 * без раздувания до её 60_000: здесь всего 3 лёгких файла, а не 6 тяжёлых full-boot графов с
 * контроллерами/интеграциями). `unit` project — все остальные специки `apps/worker` (включая
 * `*.job.integration.spec.ts`), поведение (включая `pool`/`fileParallelism` ниже) не меняется.
 * Оба project'а всё равно наследуют `pool: 'forks'` + `fileParallelism: false` (через
 * `extends: true`) — сериализация файлов ВНУТРИ каждого project'а сохраняется (защита от гонки
 * Postgres в `unit` не ослаблена), но `unit` и `full-boot-di` — это ДВА РАЗНЫХ форка, поэтому
 * DI-специки (сетевых/БД-соединений не открывают, см. их собственный JSDoc) больше не стоят в
 * очереди ПОЗАДИ всех остальных специк `apps/worker` внутри одного общего форка.
 */

const COVERAGE_THRESHOLD_PERCENT = 70

// Общие исключения — переиспользуются и `unit`, и `full-boot-di` project'ами ниже.
const COMMON_EXCLUDE = [
  '**/node_modules/**',
  // `dist/**` может содержать скомпилированные `*.spec.js` (см. tsconfig.json `files`),
  // их не нужно запускать повторно как отдельный набор тестов поверх `src/**/*.spec.ts`.
  'dist/**',
]

// Паттерн DI-специк, которые поднимают РЕАЛЬНЫЙ Nest-контейнер целиком (см. JSDoc файла).
const FULL_BOOT_DI_INCLUDE = ['src/**/*.module.spec.ts']

export default defineConfig({
  test: {
    environment: 'node',
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
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...COMMON_EXCLUDE, ...FULL_BOOT_DI_INCLUDE],
          pool: 'forks',
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'full-boot-di',
          include: FULL_BOOT_DI_INCLUDE,
          exclude: COMMON_EXCLUDE,
          pool: 'forks',
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
})
