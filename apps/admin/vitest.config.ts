/**
 * Vitest config для apps/admin (R1, EP-01/EP-05 placeholder).
 *
 * apps/admin — React 19 SPA, в нём пока НЕТ unit-тестов (планируются в
 * EP-01 / DTJ-022 вместе с появлением реальных фич админки). Чтобы
 * `pnpm verify` не падал с "No test files found" (vitest exit 1 = красный
 * `pnpm test` в turbo), включаем `passWithNoTests: true`. Это явное
 * self-documented ожидание, а не workaround.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: 'node',
  },
})
