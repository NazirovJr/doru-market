/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * DTJ-166: `apps/pharmacy` — кабинет аптеки (`pharmacist`/`pharmacy_admin`/`super_admin`).
 *
 * В отличие от `apps/web` (DTJ-003 критерий приёмки 3, fail-fast на отсутствующем
 * `VITE_API_BASE_URL`) этот конфиг НЕ падает на этапе сборки без `.env`: `shared/api/http-client.ts`
 * использует безопасный дефолт `http://localhost:3000` — тот же паттерн, что уже принят в
 * `apps/admin` (DTJ-075, `shared/api/http-client.ts`). Внутреннее ролевое приложение первой волны
 * не имеет ещё реального прод-деплоя с отдельным API-хостом; ужесточение до fail-fast — предмет
 * отдельного тикета, когда появится реальное окружение (см. DTJ-166 отчёт, ДОПУЩЕНИЯ).
 *
 * Пороги покрытия — ПОЛЫ (не цель): подняты по факту фактического покрытия тест-планом DTJ-166,
 * тем же принципом, что `apps/web/vite.config.ts` (см. комментарий там) — не «цель 70%», а
 * храповик, который можно только поднимать.
 */
const COVERAGE_FLOOR_STATEMENTS = 70
const COVERAGE_FLOOR_BRANCHES = 70
const COVERAGE_FLOOR_FUNCTIONS = 70
const COVERAGE_FLOOR_LINES = 70

/** Свой порт для параллельного запуска с apps/web (5173) при локальной разработке (.claude/launch.json). */
const DEV_SERVER_PORT = 5174

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: DEV_SERVER_PORT,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/shared/config/vitest-setup.config.ts'],
    env: {
      VITE_API_BASE_URL: 'http://localhost:3000',
    },
    coverage: {
      provider: 'v8',
      include: ['src/app/**', 'src/shared/**', 'src/features/**', 'src/pages/**'],
      exclude: ['**/*.spec.{ts,tsx}', '**/*.d.ts', 'src/app/App.tsx'],
      thresholds: {
        lines: COVERAGE_FLOOR_LINES,
        statements: COVERAGE_FLOOR_STATEMENTS,
        branches: COVERAGE_FLOOR_BRANCHES,
        functions: COVERAGE_FLOOR_FUNCTIONS,
      },
    },
  },
})
