import { HealthIndicatorService } from '@nestjs/terminus'
import { describe, expect, it } from 'vitest'
import { RedisReadinessIndicator } from '@/common/health/redis-readiness.indicator'
import type { AppConfigService } from '@/config/app-config.service'

/** Порт, на котором заведомо никто не слушает — быстрый детерминированный ECONNREFUSED. */
const UNREACHABLE_PORT = '1'

function fakeConfig(redisUrl: string): AppConfigService {
  return { redisUrl } as unknown as AppConfigService
}

describe('RedisReadinessIndicator', () => {
  it('помечает redis как down при недоступном соединении (SRS-NFR-037)', async () => {
    const indicator = new RedisReadinessIndicator(
      fakeConfig(`redis://127.0.0.1:${UNREACHABLE_PORT}`),
      new HealthIndicatorService(),
    )

    try {
      const result = await indicator.check()
      expect(result.redis?.status).toBe('down')
      expect(typeof result.redis?.message).toBe('string')
    } finally {
      indicator.onModuleDestroy()
    }
  })
})
