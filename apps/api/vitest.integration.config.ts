// Конфигурация Vitest для ИНТЕГРАЦИОННЫХ тестов `apps/api` (DTJ-029).
//
// Отличия от `vitest.config.ts` (unit-тесты):
//   - `include` — ТОЛЬКО файлы в test/integration с суффиксом .spec.ts
//     (НЕ в src).
//   - `coverage.enabled = false` — порог 70% применяется к unit-тестам;
//     integration-тесты — security-сьют, не покрытие.
//   - `testTimeout` 30s — slow e2e сценарии (race, retry) в худшем случае.
//   - `pool: forks` + `singleFork: true` — InMemory-репозитории глобальны
//     в одном процессе, но ЗДЕСЬ каждый тест создаёт СВОЙ NestApplication
//     (см. test-app.ts), поэтому параллельность допустима. Оставляем
//     forks для стабильности.
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
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/dorutj_test',
      REDIS_URL: 'redis://localhost:6379',
      CORS_STATIC_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'error',
    },
    coverage: {
      enabled: false,
    },
  },
})
