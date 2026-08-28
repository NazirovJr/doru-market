/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const REQUIRED_BUILD_ENV_VARS = ['VITE_API_BASE_URL'] as const
const DEFAULT_TEST_API_BASE_URL = 'http://localhost:3000'
const COVERAGE_THRESHOLD_PERCENT = 70

/**
 * DTJ-003, критерий приёмки 3: сборка обязана падать на этапе конфигурации, а не тихо собрать
 * бандл, который в браузере будет слать запросы на "undefined" (рантайм-проверка — env.ts).
 */
function assertBuildEnv(env: Record<string, string>): void {
  const missing = REQUIRED_BUILD_ENV_VARS.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(
      `Сборка apps/web остановлена: не заданы обязательные переменные окружения: ${missing.join(', ')}. ` +
        'Смотри apps/web/.env.example и apps/web/src/shared/config/env.ts.',
    )
  }
}

// Полная конфигурация (alias, env, proxy для API в dev) — часть реализации DTJ-003.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (command === 'build') {
    assertBuildEnv(env)
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL || DEFAULT_TEST_API_BASE_URL,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/shared/config/vitest-setup.config.ts'],
      env: {
        VITE_API_BASE_URL: DEFAULT_TEST_API_BASE_URL,
      },
      coverage: {
        provider: 'v8',
        include: ['src/app/**', 'src/shared/**'],
        exclude: ['**/*.spec.{ts,tsx}', '**/*.d.ts'],
        thresholds: {
          lines: COVERAGE_THRESHOLD_PERCENT,
          statements: COVERAGE_THRESHOLD_PERCENT,
          branches: COVERAGE_THRESHOLD_PERCENT,
          functions: COVERAGE_THRESHOLD_PERCENT,
        },
      },
    },
  }
})
