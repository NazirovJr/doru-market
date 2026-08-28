import { HealthIndicatorService } from '@nestjs/terminus'
import { describe, expect, it } from 'vitest'
import { PostgresReadinessIndicator } from '@/common/health/postgres-readiness.indicator'
import type { AppConfigService } from '@/config/app-config.service'

/** Порт, на котором заведомо никто не слушает — быстрый детерминированный ECONNREFUSED. */
const UNREACHABLE_PORT = '1'

function fakeConfig(databaseUrl: string): AppConfigService {
  return { databaseUrl } as unknown as AppConfigService
}

describe('PostgresReadinessIndicator', () => {
  it('помечает postgres как down при недоступном соединении (SRS-NFR-037)', async () => {
    const indicator = new PostgresReadinessIndicator(
      fakeConfig(`postgres://test:test@127.0.0.1:${UNREACHABLE_PORT}/dorutj_unreachable`),
      new HealthIndicatorService(),
    )

    try {
      const result = await indicator.check()
      expect(result.postgres?.status).toBe('down')
      expect(typeof result.postgres?.message).toBe('string')
    } finally {
      await indicator.onModuleDestroy()
    }
  })
})
