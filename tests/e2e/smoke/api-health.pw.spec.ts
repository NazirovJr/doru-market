/**
 * Живой smoke-тест каркаса DTJ-417 — НЕ CUJ-сценарий (те — DTJ-418..423, «пустой набор
 * реальных CUJ на этом шаге», DoD тикета). Подтверждает, что `playwright.config.ts` реально
 * умеет бить по поднятому Docker-стеку (DTJ-412/413): `GET /health` (liveness, без БД/Redis) и
 * `GET /ready` (readiness — Postgres+Redis, `HealthController`, DTJ-001).
 *
 * НЕ входит в дефолтный `pnpm test:e2e` (`playwright.config.ts`'s `testMatch` подхватил бы его
 * так же, как self-check — здесь он вынесен в отдельный npm-скрипт `test:smoke`, требующий
 * `E2E_REQUIRE_API=true`, иначе `pnpm verify`/`pnpm test:e2e` ломались бы на машинах без
 * поднятого стека, DoD тикета «pnpm verify не ломается новыми файлами»). `test.skip` без
 * `E2E_REQUIRE_API=true` — не флак, осознанный пропуск.
 */
import { test, expect } from '@playwright/test'

test.describe('smoke: живой Docker-стек (DTJ-417, не CUJ)', () => {
  test.skip(process.env.E2E_REQUIRE_API !== 'true', 'запускается только через `pnpm test:smoke` (живой стек)')

  test('GET /health отвечает { data: { status: "ok" } }', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL ?? ''}/health`)
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { data: { status: string } }
    expect(body.data.status).toBe('ok')
  })

  test('GET /ready отвечает 200 (Postgres+Redis готовы)', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL ?? ''}/ready`)
    expect(response.status()).toBe(200)
  })
})
