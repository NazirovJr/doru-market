/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * `test` слит В ЭТОТ файл (DTJ-350/EP-15, было отдельным `vitest.config.ts`, R1/EP-01/EP-05
 * placeholder) — тот же единый паттерн, что `apps/web/vite.config.ts`/`apps/pharmacy/vite.config.ts`
 * (`/// <reference types="vitest/config" />` даёт типы поля `test` внутри `defineConfig` из `vite`).
 *
 * Причина слияния — найденный дефект: отдельный `vitest.config.ts` НЕ содержал `resolve.alias`,
 * которым владеет только этот файл. `tsc --noEmit` резолвит `@/*` через СВОЙ `tsconfig.json` (paths)
 * и не видел проблемы, но Vite-трансформ `vitest run` — отдельный резолвер, синхронизируемый
 * вручную, если конфиги существуют раздельно; `role-routes.ts` (DTJ-350) стал ПЕРВЫМ файлом
 * `apps/admin`, использующим `@/` внутри динамического `import()`, и обнажил рассинхронизацию
 * (`role-routes.spec.ts` падал на "Failed to resolve import" при живом `pnpm typecheck`). Единый
 * файл делает дублирование конфигурации физически невозможным — то же решение, что уже принято
 * `web`/`pharmacy`, `apps/admin` было единственным исключением.
 *
 * `passWithNoTests: true` остаётся: не каждый будущий тикет эпика EP-15/EP-16 обязательно
 * добавляет `*.spec.ts`, гейт не должен падать на "No test files".
 *
 * `environment: 'jsdom'` (DTJ-350) — тесты, которым нужны DOM-глобалы (`localStorage`, `atob`,
 * `Response`) — `current-role.spec.ts`/`admin-client.spec.ts`.
 *
 * `globals: true` — перенесено сюда при слиянии `feat/ep-14-support-flow`/`feat/ep-15-16-skeletons`
 * в `development` (DTJ-283, EP-14): без этого флага `@testing-library/jest-dom`
 * (`features/support/ui/*.spec.tsx`) падал `ReferenceError: expect is not defined` — рантайм не
 * подставлял `describe`/`it`/`expect` как настоящие глобалы, несмотря на `types: ["vitest/globals"]`
 * в `tsconfig.json`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
