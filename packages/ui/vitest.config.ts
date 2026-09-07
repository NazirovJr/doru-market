import { defineConfig } from 'vitest/config'

/**
 * DTJ-400 добавил этот файл со скелетом `packages/ui` без тестов и `passWithNoTests: true`
 * (без него `vitest run` падает с «No test files found», роняя весь `pnpm test`). DTJ-403 вводит
 * ПЕРВЫЕ настоящие тесты пакета (`src/a11y/**`) — `passWithNoTests` больше не нужен и намеренно
 * убран: гейт, который зеленеет и когда тестов нет вообще (например, если кто-то по ошибке удалит
 * все `*.spec.ts`), не гейт (`AGENTS.md` §3). Компоненты DTJ-404+ принесут собственные тесты в
 * `src/components/**`, к тому моменту "No test files found" в любом случае недостижимо, пока
 * `src/a11y/**` остаётся в пакете.
 */
const COVERAGE_THRESHOLD_PERCENT = 90

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/a11y/vitest.setup.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html'],
      // Порог 90% (DTJ-403) применяется точечно к файлам, которые его требуют по тикету —
      // не ко всему `packages/ui` (там появятся токены DTJ-401 и компоненты DTJ-404+ со своими
      // требованиями к покрытию, эта конфигурация не должна их неявно на них распространять).
      // DTJ-404 расширяет include на `src/components/**` — тот же порог 90% явно требуется
      // тест-планом тикета для всех `.tsx`-файлов реализации компонентов.
      // Хуки компонентов — `.ts`, а не `.tsx`: без этой строки `use-toast`, `use-cursor-pagination`,
      // `use-connection-status`, `use-ui-circuit-breaker`, `use-map-markers` и `use-swipe-to-close`
      // не попадали в отчёт вовсе, и порог 90% к ним фактически не применялся (найдено на DTJ-409).
      include: ['src/a11y/*.ts', 'src/components/**/*.tsx', 'src/components/**/*.ts'],
      exclude: [
        'src/a11y/*.spec.ts',
        'src/a11y/vitest.setup.ts',
        'src/components/**/*.spec.tsx',
        'src/components/**/*.stories.tsx',
        'src/components/**/*.spec.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: COVERAGE_THRESHOLD_PERCENT,
        statements: COVERAGE_THRESHOLD_PERCENT,
        branches: COVERAGE_THRESHOLD_PERCENT,
        functions: COVERAGE_THRESHOLD_PERCENT,
      },
    },
  },
})
