/**
 * Самопроверка `runAxeCheck` (DTJ-417, критерий приёмки №4) — реальный Playwright-прогон
 * против МИНИМАЛЬНОЙ статической HTML-страницы (не требует бэкенда/докер-стека), с намеренным
 * нарушением. Часть `pnpm test:e2e`/`pnpm verify` (не требует живого стека — см.
 * `tests/e2e/README.md`/JSDoc `playwright.config.ts`, `project: 'self-check'`).
 */
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { runAxeCheck } from '../helpers/axe-check.js'

const violationFixtureUrl = fileURLToPath(new URL('../helpers/__fixtures__/a11y-violation.html', import.meta.url))
const cleanFixtureUrl = fileURLToPath(new URL('../helpers/__fixtures__/a11y-clean.html', import.meta.url))

test.describe('runAxeCheck (self-check, DTJ-417)', () => {
  test('ловит нарушение — иконка-кнопка без aria-label', async ({ page }) => {
    await page.goto(`file://${violationFixtureUrl}`)

    await expect(runAxeCheck(page)).rejects.toThrow(/button-name/)
  })

  test('не падает на странице без нарушений (не всегда-зелёная заглушка, не всегда-красная)', async ({ page }) => {
    await page.goto(`file://${cleanFixtureUrl}`)

    await expect(runAxeCheck(page)).resolves.toBeUndefined()
  })
})
