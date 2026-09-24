// Поднимает AnalyticsModule реальным Nest-контейнером (ловит забытый провайдер) и проверяет
// вставку в product_events через реальный Postgres (тот же приём, что audit-log-repository.e2e.spec.ts).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const REQUIRED_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: 'redis://localhost:6379/0',
  LOG_LEVEL: 'silent',
}

function applyRequiredTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
    process.env[key] ??= value
  }
}

const PROBE_TIMEOUT_MS = 1_500

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
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

/** Реальный контейнер + живые соединения: под конкурентным прогоном 5 с может не хватить (см. admin-аналог). */
const FULL_BOOT_TIMEOUT_MS = 30_000

interface ProductEventRow {
  tenant_id: string
  user_id: string | null
  session_id: string
  event_type: string
  savings_diram: string | null
  occurred_at: Date
}

describe.skipIf(!postgresAvailable)('AnalyticsModule — DI целиком + реальная вставка в product_events (DTJ-378)', () => {
  let pool: Pool
  let tenantId: string

  beforeAll(async () => {
    applyRequiredTestEnv()
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      tenantId,
      `dtj378-${tenantId.slice(0, 8)}`,
    ])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM product_events WHERE tenant_id = $1', [tenantId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  it(
    'компилирует AnalyticsModule реальным Nest-контейнером и AnalyticsFacade.recordEvent() вставляет строку с корректным occurred_at (АС1 DTJ-378)',
    async () => {
      // Импорты после applyRequiredTestEnv() — AppConfigModule валидирует process.env при компиляции, не лениво.
      const { AppConfigModule } = await import('@/config/config.module.js')
      const { LoggerModule } = await import('@/common/logging/logger.module.js')
      const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
      const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
      const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
      const { AnalyticsModule, AnalyticsFacade } = await import('@/modules/analytics/index.js')

      const moduleRef = await Test.createTestingModule({
        imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, AnalyticsModule],
      }).compile()

      const facade = moduleRef.get(AnalyticsFacade)
      expect(facade).toBeInstanceOf(AnalyticsFacade)

      const sessionId = `session-${randomUUID()}`
      const before = new Date()
      await facade.recordEvent({
        tenantId,
        sessionId,
        eventType: 'search_performed',
        metadata: { query: 'парацетамол' },
      })
      const after = new Date()

      const result = await pool.query<ProductEventRow>(
        `SELECT tenant_id, user_id, session_id, event_type, savings_diram, occurred_at FROM product_events WHERE session_id = $1`,
        [sessionId],
      )
      expect(result.rows).toHaveLength(1)
      const row = result.rows[0]
      if (row === undefined) throw new Error('product_events row not found')

      expect(row.tenant_id).toBe(tenantId)
      expect(row.user_id).toBeNull()
      expect(row.event_type).toBe('search_performed')
      expect(row.savings_diram).toBeNull()
      expect(row.occurred_at.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(row.occurred_at.getTime()).toBeLessThanOrEqual(after.getTime())

      await moduleRef.close()
    },
    FULL_BOOT_TIMEOUT_MS,
  )

  it('AnalyticsFacade.recordEvent() с невалидным eventType НЕ пробрасывает исключение вызывающему (сбой аналитики не ломает бизнес-операцию, JSDoc facade)', async () => {
    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { AnalyticsModule, AnalyticsFacade } = await import('@/modules/analytics/index.js')

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, AnalyticsModule],
    }).compile()
    const facade = moduleRef.get(AnalyticsFacade)

    await expect(
      facade.recordEvent({ tenantId, sessionId: `session-${randomUUID()}`, eventType: 'typo_event' }),
    ).resolves.toBeUndefined()

    await moduleRef.close()
  }, FULL_BOOT_TIMEOUT_MS)
})
