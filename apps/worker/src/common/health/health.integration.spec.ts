import IORedis, { type Redis } from 'ioredis'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { createHealthServer } from './health-server.js'
import { HealthService } from './health.service.js'

/**
 * Интеграционный тест `GET /health` (тест-план DTJ-002: «health-эндпоинт worker'а через
 * реальный/тестовый Redis»). Сценарий «Redis недоступен» (AC2) детерминирован везде — соединение
 * на недоступный адрес всегда падает. Сценарий «Redis доступен» (AC1) требует реального Redis
 * (`WORKER_TEST_REDIS_URL`, дефолт `redis://127.0.0.1:6379`) и пропускается, если он недоступен
 * в текущем окружении (CI поднимает Redis сервисом — см. `docker-compose.test.yml`, SRS-NFR-048).
 */

const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1'
const TEST_REDIS_URL = process.env.WORKER_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379'
const PROBE_TIMEOUT_MS = 500
const EPHEMERAL_PORT = 0

interface RunningHealthServer {
  readonly server: Server
  readonly url: string
}

async function startHealthServerFor(redis: Redis): Promise<RunningHealthServer> {
  const server = createHealthServer(new HealthService(redis))
  await new Promise<void>((resolve) => server.listen(EPHEMERAL_PORT, resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('не удалось получить порт health-сервера')
  }
  return { server, url: `http://127.0.0.1:${String(address.port)}/health` }
}

async function isRedisReachable(url: string): Promise<boolean> {
  const client = new IORedis(url, {
    lazyConnect: true,
    connectTimeout: PROBE_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  try {
    await client.connect()
    await client.ping()
    return true
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}

const testRedisAvailable = await isRedisReachable(TEST_REDIS_URL)

describe('GET /health (apps/worker, SRS-NFR-037)', () => {
  it('возвращает 503, когда Redis недоступен (AC2)', async () => {
    const redis = new IORedis(UNREACHABLE_REDIS_URL, { lazyConnect: true })
    const { server, url } = await startHealthServerFor(redis)

    try {
      const response = await fetch(url)
      expect(response.status).toBe(503)
    } finally {
      server.close()
      redis.disconnect()
    }
  })

  it('возвращает 404 на неизвестный путь', async () => {
    const redis = new IORedis(UNREACHABLE_REDIS_URL, { lazyConnect: true })
    const { server, url } = await startHealthServerFor(redis)

    try {
      const response = await fetch(url.replace('/health', '/unknown'))
      expect(response.status).toBe(404)
    } finally {
      server.close()
      redis.disconnect()
    }
  })

  describe.skipIf(!testRedisAvailable)('с реальным тестовым Redis', () => {
    let redis: Redis

    afterAll(() => {
      redis.disconnect()
    })

    it('возвращает 200, когда соединение с Redis установлено (AC1)', async () => {
      redis = new IORedis(TEST_REDIS_URL)
      const { server, url } = await startHealthServerFor(redis)

      try {
        const response = await fetch(url)
        expect(response.status).toBe(200)
      } finally {
        server.close()
      }
    })
  })
})
