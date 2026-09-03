import { describe, expect, it } from 'vitest'
import type Redis from 'ioredis'
import { OrderNumberSequenceExhaustedError } from '@/shared-kernel/domain/errors/order-number-sequence-exhausted.error.js'
import { RedisOrderNumberGeneratorAdapter } from './redis-order-number-generator.adapter.js'

/**
 * Фейковый `ioredis`-клиент (in-memory `Map`) — заменяет Testcontainers Redis (тикет
 * DTJ-221 просит интеграционный набор, но верхнеуровневая инструкция этой волны прямо
 * запрещает трогать интеграционную инфраструктуру/БД — см. отчёт, `disputed`). Покрывает
 * ТОЛЬКО контракт, который использует адаптер (`incr`/`expire`), не полный API `ioredis`.
 */
class FakeRedis {
  private readonly counters = new Map<string, number>()
  readonly ttlCalls: { key: string; seconds: number }[] = []

  incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, next)
    return Promise.resolve(next)
  }

  expire(key: string, seconds: number): Promise<number> {
    this.ttlCalls.push({ key, seconds })
    return Promise.resolve(1)
  }
}

describe('RedisOrderNumberGeneratorAdapter (DTJ-221, SRS-DOM-085)', () => {
  it('первый вызов дня → seq=1, EXPIRE установлен ровно один раз (48ч)', async () => {
    const redis = new FakeRedis()
    const adapter = new RedisOrderNumberGeneratorAdapter(redis as unknown as Redis)
    const first = await adapter.generate('260827')
    expect(first.value).toBe('DTJ-260827-00001')
    expect(redis.ttlCalls).toEqual([{ key: 'order_seq:260827', seconds: 172_800 }])

    const second = await adapter.generate('260827')
    expect(second.value).toBe('DTJ-260827-00002')
    expect(redis.ttlCalls).toHaveLength(1) // EXPIRE только на первый инкремент
  })

  it('независимые счётчики для разных календарных дней', async () => {
    const redis = new FakeRedis()
    const adapter = new RedisOrderNumberGeneratorAdapter(redis as unknown as Redis)
    await adapter.generate('260827')
    const otherDay = await adapter.generate('260828')
    expect(otherDay.value).toBe('DTJ-260828-00001')
  })

  it('исчерпание последовательности (seq > 99999) → OrderNumberSequenceExhaustedError', async () => {
    const redis = new FakeRedis()
    const adapter = new RedisOrderNumberGeneratorAdapter(redis as unknown as Redis)
    for (let i = 0; i < 99_999; i += 1) {
      // no-await-in-loop выключен для *.spec.ts (eslint.config.mjs) — последовательный INCR,
      // порядок значим для теста, распараллеливать нельзя.
      await adapter.generate('260829')
    }
    await expect(adapter.generate('260829')).rejects.toBeInstanceOf(OrderNumberSequenceExhaustedError)
  })
})
