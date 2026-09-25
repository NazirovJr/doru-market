import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * DTJ-400 — скелет `packages/ui`. DTJ-403 добавляет первые тестовые файлы (`src/a11y/**`),
 * поэтому `passWithNoTests` остаётся: будущие пакетные срезы без тестов (до появления
 * следующего компонента) не должны ронять монорепный `pnpm test`/`turbo run test`.
 *
 * Порог покрытия — 90% для `src/a11y/assert-hit-area.ts`, `use-reduced-motion.ts`,
 * `use-focus-trap.ts` и `test-utils.ts` (тикет DTJ-403, тест-план): вся инфраструктура
 * автопроверки доступности, на которую будут полагаться ВСЕ последующие компоненты `packages/ui`
 * (начиная с DTJ-404), приравнена по строгости к `domain`/testing-инфраструктуре
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §6). `coverage.enabled` заставляет обычный `vitest run`
 * (а значит и `pnpm test` → `turbo run test`) считать покрытие и падать при просадке ниже
 * порога — без отдельного флага `--coverage` в скрипте `test`.
 *
 * DTJ-404 добавляет `src/components` (файлы `.tsx`) в тот же порог (тикет: «90% для всех файлов .tsx
 * (не генерируемых) в этом тикете» — эквивалент строгости `domain`/`application` для
 * `packages/ui`). `*.stories.tsx` — не продуктовый код (Storybook-демонстрация), исключён.
 *
 * DTJ-406 расширяет `include` до `.ts` внутри `src/components` (`toast/use-toast.ts` — логика
 * без JSX) и добавляет `src/hooks/**` (`use-connection-status.ts`/`use-ui-circuit-breaker.ts`,
 * тикет DTJ-406 «Что сделать» п.7) — без этого их продуктовый код молча выпадал бы из порога 90%.
 */
const COVERAGE_THRESHOLD_PERCENT = 90

export default defineConfig({
  resolve: {
    // Соответствует tsconfig.json (`baseUrl: "./src"`, `paths: { "@/*": ["*"] }`) — без этого
    // алиас резолвится компилятором типов, но не рантаймом vitest/esbuild.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.config.ts'],
    passWithNoTests: true,
    exclude: ['**/node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'html'],
      include: ['src/a11y/**/*.ts', 'src/components/**/*.tsx', 'src/components/**/*.ts', 'src/hooks/**/*.ts'],
      // `index.ts` — барабанный экспорт (D-27); фикстуры-нарушители — тестовые данные,
      // не продуктовая логика; `*.stories.tsx` — Storybook-демонстрация, не продуктовый код
      // (тикет DTJ-404: «90% для всех файлов .tsx (не генерируемых) в этом тикете»).
      exclude: [
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/*.stories.tsx',
        '**/*.d.ts',
        'src/a11y/index.ts',
        '**/__fixtures__/**',
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
