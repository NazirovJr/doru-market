/**
 * Vitest config для самопроверок хелперов `tests/e2e/helpers/*.spec.ts` (DTJ-417, тест-план).
 * Только `helpers/**` — Playwright-спеки (`self-check/**\/*.pw.spec.ts`, `smoke/**\/*.pw.spec.ts`)
 * сюда НЕ попадают (другое расширение, `playwright.config.ts` их не пересекает — см. её JSDoc).
 *
 * `pool: 'vmThreads'` — тот же обход Windows sandbox EPERM, что `tests/arch/vitest.config.ts`/
 * `tests/invariants/vitest.config.ts` (см. их JSDoc, `STATE-AND-RESUME-POINT.md` §11.7).
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['helpers/**/*.spec.ts'],
    pool: 'vmThreads',
    environment: 'node',
  },
})
