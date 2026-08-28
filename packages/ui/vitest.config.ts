import { defineConfig } from 'vitest/config'

/**
 * DTJ-400 — скелет `packages/ui` намеренно не вводит предметной логики (см. тест-план тикета),
 * поэтому тестовых файлов на этом шаге нет. Без `passWithNoTests` `vitest run` завершается
 * кодом выхода 1 («No test files found»), из-за чего красный `@dorutj/ui#test` роняет весь
 * монорепный `pnpm test`/`turbo run test`. Компоненты и их тесты добавляются последующими
 * тикетами EP-18 (DTJ-401..403) — `environment: 'jsdom'` уже включён заранее под них.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
    exclude: ['**/node_modules/**', 'dist/**'],
  },
})
