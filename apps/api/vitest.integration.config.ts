// Конфигурация Vitest для ИНТЕГРАЦИОННЫХ тестов `apps/api` (DTJ-029).
//
// Отличия от `vitest.config.ts` (unit-тесты):
//   - `include` — ТОЛЬКО файлы в test/integration с суффиксом .spec.ts
//     (НЕ в src).
//   - `coverage.enabled = false` — порог 70% применяется к unit-тестам;
//     integration-тесты — security-сьют, не покрытие.
//   - `testTimeout` 30s — slow e2e сценарии (race, retry) в худшем случае.
//   - `pool: forks` + `fileParallelism: false` — файлы `test/integration/catalog/*.spec.ts`
//     делят ОДНУ реальную Postgres-таблицу (`medicines`/`categories`) без изоляции схемы;
//     параллельный запуск файлов даёт `deadlock detected` (40P01) на конкурентных
//     TRUNCATE/INSERT. Сериализация файлов это убирает (каждый тест внутри файла всё равно
//     создаёт свой NestApplication — см. test-app.ts, — так что параллельность ТЕСТОВ внутри
//     файла не нужна отключать).
//   - `env` — минимальный набор обязательных ENV для bootstrap'а (тест
//     переопределяет в test-app.ts:applyTestEnv).
//
// ПРИМЕЧАНИЕ(WAVE35-CORRECTION): JSDoc-блок с glob-литералом
// `**/*.spec.ts` внутри backtick-строк ломал TS-парсер: он пытался
// разобрать `**/*.spec.ts` как expression и падал с parse error. Перевод
// на line-комментарии устраняет проблему — внутри `//` парсер не
// интерпретирует содержимое. Реальный glob сохраняется в `test.include` ниже.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const INTEGRATION_TEST_TIMEOUT_MS = 30_000

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    testTimeout: INTEGRATION_TEST_TIMEOUT_MS,
    // JSDoc выше уже документировал `pool: forks` + сериализацию, но подключено не было
    // (найдено при выполнении задачи по Redis/DEFECT-3): без `fileParallelism: false` vitest
    // параллелит файлы `test/integration/catalog/*.integration.spec.ts` в отдельных воркерах,
    // а они делят ОДНУ реальную Postgres-таблицу (`medicines`/`categories`) без изоляции схемы —
    // конкурентные TRUNCATE/INSERT из разных файлов дают deadlock detected (40P01), гонки на
    // счётчиках строк и посторонние строки в EXPLAIN-плане. `fileParallelism: false` запускает
    // файлы строго по одному в единственном `forks`-воркере, что убирает гонку (каждый тест
    // внутри файла всё равно создаёт свой NestApplication — см. test-app.ts). Раньше здесь
    // стоял вложенный `poolOptions.forks.singleFork` — Vitest 4 убрал `poolOptions`
    // (`test.poolOptions` was removed in Vitest 4 — все опции стали плоскими верхнеуровневыми),
    // `pool` + `fileParallelism: false` — актуальная замена.
    pool: 'forks',
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/dorutj_test',
      // Redis локально поднят с --requirepass (infra/docker/docker-compose.yml, дефолт
      // REDIS_PASSWORD=dorutj_dev_redis_password — дев-дефолт, заведомо непроизводственный,
      // коммитить можно, Ж13). Без пароля isRedisReachable() даёт false и redis-lock-guard/
      // search-cache integration-сьюты молча пропускались.
      REDIS_URL: 'redis://:dorutj_dev_redis_password@localhost:6379',
      CORS_STATIC_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'error',
    },
    coverage: {
      enabled: false,
    },
  },
})
