/**
 * Unit-тесты `RedisLockGuard` (DTJ-187, EP-06, SRS-CAT-060) на `FakeRedisClient`
 * (`__tests__/fake-redis-client.ts`) — проверяют КООРДИНАЦИОННУЮ ЛОГИКУ класса.
 *
 * Реальная атомарность `SET NX PX` на настоящем Redis (тест-план тикета, «Testcontainers
 * Redis, НЕ мок») проверяется ОТДЕЛЬНО в
 * `apps/api/test/integration/catalog/redis-lock-guard.integration.spec.ts`.
 *
 * Барьер конкурентного старта — `Promise.all(Array.from({ length: N }, () => ...))`
 * (ВСЕ N вызовов создаются в одном синхронном проходе), НЕ `sleep`-цепочка — так, как
 * предписывает тикет DTJ-187, «Риски и подводные камни» (избегать sleep-синхронизации
 * САМОГО ТЕСТА, иначе флейки под нагрузкой CI).
 */
import type Redis from 'ioredis'
import { describe, expect, it, vi } from 'vitest'
import {
  CacheStampedeUnresolvedError,
  LOCK_PLACEHOLDER_VALUE,
  RedisLockGuard,
} from './redis-lock-guard.js'
import { FakeRedisClient } from './__tests__/fake-redis-client.js'

const CONCURRENT_CALLS = 20
/** С большим запасом больше `STAMPEDE_RETRY_ATTEMPTS * STAMPEDE_RETRY_DELAY_MS` (150мс) —
 * лок в этих тестах не истекает сам по себе раньше, чем сценарий завершится. */
const LOCK_TTL_MS = 5000

function makeGuard(): { readonly guard: RedisLockGuard; readonly redis: FakeRedisClient } {
  const redis = new FakeRedisClient()
  return { guard: new RedisLockGuard(redis as unknown as Redis), redis }
}

describe('RedisLockGuard (DTJ-187)', () => {
  it('критерий приёмки 1: 20 параллельных вызовов → ровно один compute(), остальные получают его результат', async () => {
    const { guard } = makeGuard()
    const compute = vi.fn(async () => Promise.resolve({ value: 'computed-once' }))

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => guard.withLock('stampede-key', LOCK_TTL_MS, compute)),
    )

    expect(compute).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(CONCURRENT_CALLS)
    for (const result of results) {
      expect(result).toEqual({ value: 'computed-once' })
    }
  })

  it('критерий приёмки 4: исключение в compute() освобождает лок и пробрасывается вызывающему коду', async () => {
    const { guard, redis } = makeGuard()
    const boom = new Error('compute failed')

    await expect(guard.withLock('failing-key', LOCK_TTL_MS, () => Promise.reject(boom))).rejects.toThrow(boom)

    // Негативный сценарий: лок НЕ должен висеть в Redis до истечения ttlMs (C12).
    await expect(redis.get('failing-key')).resolves.toBeNull()
  })

  it('после освобождения лока провалившимся compute() следующий вызов снова его выполняет', async () => {
    const { guard } = makeGuard()
    await expect(
      guard.withLock('retry-key', LOCK_TTL_MS, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')

    const secondCompute = vi.fn(async () => Promise.resolve('ok'))
    await expect(guard.withLock('retry-key', LOCK_TTL_MS, secondCompute)).resolves.toBe('ok')
    expect(secondCompute).toHaveBeenCalledTimes(1)
  })

  it('исчерпание retry-попыток без опубликованного результата — типизированный отказ, не тихое зависание', async () => {
    const { guard, redis } = makeGuard()
    // Симулирует держателя лока, чей compute() никогда не завершится за время теста.
    await redis.set('stuck-key', LOCK_PLACEHOLDER_VALUE, 'PX', LOCK_TTL_MS, 'NX')

    await expect(
      guard.withLock('stuck-key', LOCK_TTL_MS, () => Promise.resolve('unreachable')),
    ).rejects.toBeInstanceOf(CacheStampedeUnresolvedError)
  })
})
