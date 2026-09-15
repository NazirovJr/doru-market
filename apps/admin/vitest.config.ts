/**
 * Vitest config для apps/admin (R1, EP-01/EP-05 placeholder, обновлено DTJ-283).
 *
 * `environment: 'jsdom'` — ДОБАВЛЕНО DTJ-283: первые component-тесты `apps/admin`
 * (`features/support/**`, Testing Library) требуют DOM (`jsdom`/`@testing-library/*` уже были в
 * `devDependencies` заранее — заготовлено под этот момент, JSDoc ниже «планируются в EP-01/
 * DTJ-022 вместе с появлением реальных фич админки» буквально описывает эту правку).
 * `environment: 'node'` был безопасен ТОЛЬКО пока тестов не было вовсе — глобальная смена
 * окружения не ломает ничего существующего (других тестов в `apps/admin` не было).
 *
 * `passWithNoTests` остаётся — другие будущие фичи `apps/admin` всё ещё могут не иметь тестов.
 *
 * `globals: true` — ДОБАВЛЕНО DTJ-283: `tsconfig.json` уже объявлял `types: ["vitest/globals"]`
 * заранее (та же заготовка, что `jsdom`/Testing Library в devDependencies), но без этого флага
 * рантайм не подставлял `describe`/`it`/`expect` как настоящие глобалы — побочный импорт
 * `@testing-library/jest-dom` (сам вызывает `globalThis.expect.extend(...)`) падал с
 * `ReferenceError: expect is not defined` независимо от локального `import { expect } from
 * 'vitest'` в самом тестовом файле — обнаружено живым прогоном первых component-тестов
 * `apps/admin` (`features/support/ui/**`, DTJ-283).
 *
 * `resolve.alias` — ДОБАВЛЕНО DTJ-283: `vite.config.ts` (dev/build) уже несёт `@ → ./src`, но
 * `vitest.config.ts` — ОТДЕЛЬНЫЙ конфиг (не наследует `vite.config.ts`) — первые тесты,
 * импортирующие `@/...` (`features/support/ui/**`), падали `Failed to resolve import "@/..."`
 * без этой правки — тот же alias, 1:1.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    passWithNoTests: true,
    environment: 'jsdom',
    globals: true,
  },
})
