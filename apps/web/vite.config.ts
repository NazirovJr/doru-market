/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const REQUIRED_BUILD_ENV_VARS = ['VITE_API_BASE_URL'] as const
const DEFAULT_TEST_API_BASE_URL = 'http://localhost:3000'
/**
 * Пороги покрытия — ПОЛЫ, ниже которых падает сборка. Не «цель», а храповик: их можно только
 * поднимать. Цель §6.4 — 70% по всем четырём метрикам.
 *
 * Почему сейчас не ровно 70. Раньше `include` охватывал только `src/app` и `src/shared` — 10
 * файлов из 56, то есть 82% продуктового кода (`features/**`, `pages/**`) в измерение не входило
 * вовсе. Порог «70» выполнялся на выборке, где почти нет кода, и не значил ничего: любая фича
 * могла быть покрыта нулём, а гейт оставался зелёным. Найдено при сдаче DTJ-234.
 *
 * После включения ВСЕГО кода фактические цифры — statements 69.61, branches 66.04,
 * functions 72.20, lines 69.73. Полы выставлены по факту. Честные 69 на 100% кода строго
 * сильнее фиктивных 70 на 18%, поэтому это ужесточение гейта, а не послабление.
 *
 * До 70 не дотягивает практически один файл — `pages/login/login-page.tsx`, покрытие 0% при
 * 157 строках (экран логина без единого теста). Как только он будет покрыт, все четыре пола
 * поднимаются до 70 и этот комментарий удаляется.
 */
const COVERAGE_FLOOR_STATEMENTS = 69
const COVERAGE_FLOOR_BRANCHES = 66
const COVERAGE_FLOOR_FUNCTIONS = 72
const COVERAGE_FLOOR_LINES = 69

/**
 * DTJ-003, критерий приёмки 3: сборка обязана падать на этапе конфигурации, а не тихо собрать
 * бандл, который в браузере будет слать запросы на "undefined" (рантайм-проверка — env.ts).
 */
function assertBuildEnv(env: Record<string, string>): void {
  // ПУСТАЯ строка — легитимное значение, а не пропуск: она означает «API на том же origin»
  // (запросы уходят относительными путями `/api/v1/...`, их проксирует nginx). Отличать
  // «не задано» от «задано пустым» обязательно: `!env[key]` заваливал сборку образа, где
  // абсолютный адрес вреден — порт API наружу не публикуется.
  const missing = REQUIRED_BUILD_ENV_VARS.filter((key) => env[key] === undefined)
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
        include: ['src/app/**', 'src/shared/**', 'src/features/**', 'src/pages/**'],
        exclude: ['**/*.spec.{ts,tsx}', '**/*.d.ts'],
        thresholds: {
          lines: COVERAGE_FLOOR_LINES,
          statements: COVERAGE_FLOOR_STATEMENTS,
          branches: COVERAGE_FLOOR_BRANCHES,
          functions: COVERAGE_FLOOR_FUNCTIONS,
        },
      },
    },
  }
})
