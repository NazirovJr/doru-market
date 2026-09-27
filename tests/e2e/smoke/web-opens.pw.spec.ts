/**
 * Живой smoke-тест открытия `apps/web` (DTJ-417, не CUJ — см. JSDoc `api-health.pw.spec.ts`).
 *
 * `apps/web`/`apps/admin` в `infra/docker/docker-compose.yml` (DTJ-412) НЕ публикуют
 * собственный хост-порт — доступны только через `nginx`, который `docker-compose.test.yml`
 * (DTJ-413) намеренно снимает с автозапуска тестового стека (см. её JSDoc, «`nginx`/`certbot`/
 * `seed`… НЕ должны стартовать»). Поэтому этот тест бьёт по `E2E_WEB_URL` — отдельно
 * поднятому `apps/web` (`pnpm --filter @dorutj/web preview`/`dev`), НЕ по docker-compose стеку.
 * Без `E2E_WEB_URL` — `test.skip` (осознанный пропуск, не флак): проверка публикации `apps/web`
 * через nginx в тестовом e2e-прогоне — вне объёма этого тикета (см. риски DTJ-413/417).
 */
import { test, expect } from '@playwright/test'

test.describe('smoke: apps/web открывается (DTJ-417, не CUJ)', () => {
  const webUrl = process.env.E2E_WEB_URL
  test.skip(webUrl === undefined, 'запускается только с E2E_WEB_URL=<адрес поднятого apps/web>')

  test('главная страница apps/web загружается и рендерит контент', async ({ page }) => {
    await page.goto(webUrl!)
    await expect(page.locator('body')).not.toBeEmpty()
    await expect(page).toHaveTitle(/.+/)
  })
})
