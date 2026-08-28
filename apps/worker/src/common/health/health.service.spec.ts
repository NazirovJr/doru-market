import type { Redis } from 'ioredis'
import { describe, expect, it } from 'vitest'
import { HealthService } from './health.service.js'

function createFakeRedis(ping: () => Promise<string>): Redis {
  return { ping } as unknown as Redis
}

describe('HealthService', () => {
  it('возвращает true, когда PING успешен', async () => {
    const service = new HealthService(createFakeRedis(() => Promise.resolve('PONG')))

    await expect(service.checkRedisConnection()).resolves.toBe(true)
  })

  it('возвращает false, когда Redis отвечает ошибкой (AC2 DTJ-002)', async () => {
    const service = new HealthService(createFakeRedis(() => Promise.reject(new Error('ECONNREFUSED'))))

    await expect(service.checkRedisConnection()).resolves.toBe(false)
  })
})
