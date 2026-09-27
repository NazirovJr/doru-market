/**
 * Playwright-конфиг (DTJ-417, «Что сделать» п.1). Только Chromium в R1 (`SRS-NFR-059`) —
 * `projects` намеренно содержит ровно один проект.
 *
 * `testMatch: '**\/*.pw.spec.ts'` — отделяет Playwright-спеки (`self-check/**`, `smoke/**`,
 * будущие `specs/**` из DTJ-418..423) от Vitest-самопроверок хелперов (`helpers/*.spec.ts`,
 * `tests/e2e/vitest.config.ts`) — оба используют один и тот же корень пакета, разное
 * расширение исключает конфликт «playwright пытается запустить vitest-спек и наоборот».
 *
 * `retries`: `0` локально / `1` в CI (`process.env.CI`) — КОМПЕНСИРУЕТ редкую сетевую
 * флакиность Docker-стека (задержка старта контейнера, холодный TCP-connect), НЕ МАСКИРУЕТ
 * реальные баги — `SRS-NFR-030` (детерминированность через `FixedClockAdapter`/
 * `FixedOtpGeneratorAdapter`/`SequentialTestIdGenerator`, `packages/testing-kit`) остаётся
 * обязательным для каждого сценария независимо от ретраев.
 *
 * Таймауты — с запасом под Slow-3G-подобные сценарии (`SRS-NFR-0xx`, мобильный трафик РТ):
 * `timeout` (весь тест) и `expect.timeout` (одно ожидание) заметно выше Playwright-дефолтов
 * (30s/5s), чтобы не ловить ложные красные на медленной сети, а не потому что сценарии сами
 * по себе долгие.
 *
 * `executablePath` — окружение этого тикета предустанавливает Chromium ПО ФИКСИРОВАННОЙ
 * ревизии (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `chromium-1194`, живым прогоном
 * подтверждено: `playwright-core@1.62.1` по умолчанию ищет headless-shell ревизию `1234`,
 * которой там нет — `browserType.launch` падает с «Executable doesn't exist» без явного пути).
 * Указываем ПОЛНЫЙ Chromium (`chrome-linux/chrome`, а не headless-shell) — та единственная
 * ревизия, что реально установлена. Если версия `@playwright/test` в `package.json` этого
 * пакета изменится и путь перестанет резолвиться — заменить ревизию в пути ниже на актуальную
 * (`ls $PLAYWRIGHT_BROWSERS_PATH`).
 */
import { defineConfig, devices } from '@playwright/test'

const DEFAULT_BASE_URL = 'http://localhost:3000'
const TEST_TIMEOUT_MS = 60_000
const EXPECT_TIMEOUT_MS = 15_000
const CI_RETRIES = 1
const LOCAL_RETRIES = 0

const PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
const CHROMIUM_EXECUTABLE_PATH =
  PLAYWRIGHT_BROWSERS_PATH !== undefined
    ? `${PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome`
    : undefined

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.pw.spec.ts',
  globalSetup: './global-setup.ts',
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  retries: process.env.CI !== undefined ? CI_RETRIES : LOCAL_RETRIES,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL,
    trace: 'retain-on-failure',
    launchOptions: CHROMIUM_EXECUTABLE_PATH !== undefined ? { executablePath: CHROMIUM_EXECUTABLE_PATH } : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
