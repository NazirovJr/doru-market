/**
 * `rate-limiting.spec.ts` (DTJ-425, `TC-NFR-018`, `SRS-NFR-018`) — 101-й анонимный запрос
 * `GET /api/v1/medicines/search` за минуту с одного IP → `429 RATE_LIMITED` с `Retry-After > 0`;
 * предыдущие 100 — НЕ блокированы (точная граница, буквально как в критерии приёмки №4 тикета).
 *
 * Механизм — реальный ГЛОБАЛЬНЫЙ `@fastify/rate-limit` плагин (DTJ-432,
 * `apps/api/src/common/http/rate-limit/rate-limit.config.ts`), тот же, что уже покрыт
 * `apps/api/test/integration/common/rate-limit.integration.spec.ts` (DTJ-432) — ТОТ файл
 * использует урезанный лимит (`RATE_LIMIT_ANON_PER_MIN_TEST=3`) ради скорости CI; этот файл — тот
 * же механизм с ЛИТЕРАЛЬНЫМ порогом тикета (100/мин), т.к. `security-audit` — отдельная,
 * НЕ дублирующая `integration-tests` job (не дублирование, а буквальное соответствие AC №4:
 * «проверка точной границы, не примерно сотня»).
 *
 * `RATE_LIMIT_ANON_PER_MIN` устанавливается здесь ПРЯМЫМ присваиванием (не `??=`) ДО динамического
 * `import('@/main.js')` — переопределяет щедрый дефолт `vitest.config.ts` (нужен другим файлам
 * пакета, которые НЕ тестируют rate-limit и не должны словить 429 на паре десятков запросов).
 */
process.env.RATE_LIMIT_ANON_PER_MIN = '100'
process.env.RATE_LIMIT_USER_PER_MIN = '1000'

import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const ANON_LIMIT = 100
const FULL_BOOT_TIMEOUT_MS = 30_000

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1_500 })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}
const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

interface RateLimitedErrorBody {
  readonly error: { readonly code: string }
}

describe.skipIf(!postgresAvailable)('tests/security/rate-limiting (DTJ-425, TC-NFR-018)', () => {
  let app: NestFastifyApplication
  let httpServer: Server

  beforeAll(async () => {
    const { createApp } = await import('@/main.js')
    app = await createApp()
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    httpServer = app.getHttpServer()
  }, FULL_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await app.close()
  })

  it(`Given ${String(ANON_LIMIT + 1)} запросов /medicines/search с одного IP, When ${String(ANON_LIMIT + 1)}-й отправлен, Then 429 RATE_LIMITED с Retry-After > 0; предыдущие ${String(ANON_LIMIT)} — НЕ 429`, async () => {
    const ip = `10.77.${String(randomUUID().charCodeAt(0) % 200)}.${String(randomUUID().charCodeAt(1) % 200)}`
    const responses: request.Response[] = []
    for (let i = 0; i < ANON_LIMIT + 1; i += 1) {
      responses.push(
        await request(httpServer).get('/api/v1/medicines/search?q=paracetamol').set('X-Forwarded-For', ip),
      )
    }

    const underLimit = responses.slice(0, ANON_LIMIT)
    const overLimit = responses[ANON_LIMIT]
    if (overLimit === undefined) throw new Error('expected a 101st response')

    for (const [index, res] of underLimit.entries()) {
      expect(res.status, `request ${String(index + 1)}/${String(ANON_LIMIT)}`).not.toBe(429)
    }

    expect(overLimit.status).toBe(429)
    const retryAfter = Number(overLimit.headers['retry-after'])
    expect(Number.isFinite(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    const body = overLimit.body as RateLimitedErrorBody
    expect(body.error.code).toBe('RATE_LIMITED')
  }, FULL_BOOT_TIMEOUT_MS)
})
