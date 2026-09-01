/**
 * Интеграционный тест `RedisLockGuard` (DTJ-187, EP-06, SRS-CAT-060) — РЕАЛЬНЫЙ Redis, не мок
 * (тест-план тикета: «реальная атомарность SET NX PX важна для этой логики», `TC-CAT-027`).
 *
 * **Окружение.** Redis берётся из `CATALOG_TEST_REDIS_URL` (fallback: `REDIS_URL`, дефолт
 * совпадает с `vitest.integration.config.ts`). Если Redis недоступен — сьют пропускается через
 * `describe.skipIf` (тот же приём, что `catalog-repository.adapter.integration.spec.ts`, DTJ-092,
 * и `apps/worker/.../health.integration.spec.ts`, SRS-NFR-048/Ж13): это НЕ «зелёный по умолчанию»,
 * а честный skip, который CI обязан запустить с поднятым Redis.
 *
 * Один общий `ioredis`-клиент на весь сьют (как в проде — `RedisLockGuard` получает ОДИН
 * `REDIS_CLIENT` через DI, `infrastructure/redis/redis.provider.ts`) — атомарность `SET NX PX`
 * гарантируется однопоточной обработкой команд самим сервером Redis, не количеством клиентских
 * соединений.
 */
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CacheStampedeUnresolvedError, RedisLockGuard } from '@/modules/catalog/infrastructure/cache/redis-lock-guard.js'

const TEST_REDIS_URL =
  process.env.CATALOG_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379'

const PROBE_TIMEOUT_MS = 1_500
const CONCURRENT_CALLS = 20
const LOCK_TTL_MS = 5_000
const TEST_KEY_PREFIX = 'test:dtj187:lock:'

async function isRedisReachable(url: string): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: PROBE_TIMEOUT_MS, maxRetriesPerRequest: 1 })
  client.on('error', () => undefined)
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

const redisAvailable = await isRedisReachable(TEST_REDIS_URL)

describe.skipIf(!redisAvailable)('RedisLockGuard — integration (DTJ-187, SRS-CAT-060)', () => {
  let redis: Redis
  let guard: RedisLockGuard
  const usedKeys: string[] = []

  beforeAll(() => {
    redis = new Redis(TEST_REDIS_URL)
    guard = new RedisLockGuard(redis)
  })

  afterAll(async () => {
    if (usedKeys.length > 0) {
      await redis.del(...usedKeys).catch(() => undefined)
    }
    await redis.quit().catch(() => undefined)
  })

  afterEach(async () => {
    if (usedKeys.length > 0) {
      await redis.del(...usedKeys).catch(() => undefined)
      usedKeys.length = 0
    }
  })

  function testKey(name: string): string {
    const key = `${TEST_KEY_PREFIX}${name}:${String(Date.now())}`
    usedKeys.push(key)
    return key
  }

  it('критерий приёмки 1 (TC-CAT-027): 20 параллельных идентичных запросов → РОВНО ОДИН compute()', async () => {
    const key = testKey('stampede')
    let computeCalls = 0

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () =>
        guard.withLock(key, LOCK_TTL_MS, () => {
          computeCalls += 1
          return Promise.resolve({ computedAt: 'once', value: 42 })
        }),
      ),
    )

    expect(computeCalls).toBe(1)
    for (const result of results) {
      expect(result).toEqual({ computedAt: 'once', value: 42 })
    }
  })

  it('критерий приёмки 4: исключение в compute() освобождает лок в РЕАЛЬНОМ Redis (не висит до истечения ttlMs)', async () => {
    const key = testKey('failing')
    const boom = new Error('compute failed')

    await expect(guard.withLock(key, LOCK_TTL_MS, () => Promise.reject(boom))).rejects.toThrow(boom)

    const remaining = await redis.get(key)
    expect(remaining).toBeNull()
  })

  it('после ошибки следующий вызов на том же ключе снова выполняет compute() (лок реально свободен)', async () => {
    const key = testKey('retry-after-failure')
    await expect(
      guard.withLock(key, LOCK_TTL_MS, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow()

    let ran = false
    const result = await guard.withLock(key, LOCK_TTL_MS, () => {
      ran = true
      return Promise.resolve('ok')
    })

    expect(ran).toBe(true)
    expect(result).toBe('ok')
  })

  it('исчерпание retry-попыток бросает CacheStampedeUnresolvedError, а не тихо зависает', async () => {
    const key = testKey('stuck')
    // Занимаем ключ напрямую (симулирует держателя лока, чей compute() не завершится за время теста).
    await redis.set(key, '__DTJ_LOCK_PENDING__', 'PX', LOCK_TTL_MS, 'NX')

    await expect(
      guard.withLock(key, LOCK_TTL_MS, () => Promise.resolve('unreachable')),
    ).rejects.toBeInstanceOf(CacheStampedeUnresolvedError)
  })
})
