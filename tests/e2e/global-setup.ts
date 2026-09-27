/**
 * Playwright `globalSetup` (DTJ-417, «Что сделать» п.2) — защита на случай локального запуска
 * БЕЗ предварительного `wait-on`/`curl`-опроса из CI `job: e2e` (DTJ-414): страхует именно тот
 * сценарий, когда разработчик поднял `docker compose` и тут же запустил `pnpm test:e2e`, не
 * дождавшись healthcheck'а.
 *
 * Ждёт `${baseURL}/ready` ТОЛЬКО когда `E2E_REQUIRE_API=true` (проставляется `test:smoke`
 * скриптом `tests/e2e/package.json` и может быть выставлена вручную) — самопроверочные
 * (`self-check/**`) и `helpers/*.spec.ts` тесты этого тикета НЕ бьют по реальному бэкенду
 * (файловые/локальные фикстуры), поэтому по умолчанию `pnpm test:e2e`/`pnpm verify` не блокируются
 * ожиданием стека, которого может не быть локально — критерий DoD DTJ-417 «pnpm verify не
 * ломается новыми файлами».
 */
import { type FullConfig } from '@playwright/test'
import { waitForReady } from './helpers/wait-for-ready.js'

const DEFAULT_BASE_URL = 'http://localhost:3000'

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.E2E_REQUIRE_API !== 'true') {
    return
  }
  const baseURL = config.projects[0]?.use.baseURL ?? process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL
  await waitForReady({ url: `${baseURL}/ready` })
}
