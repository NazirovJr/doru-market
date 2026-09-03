/**
 * Интеграционный тест `RedisCartHoldStoreAdapter` (EP-09, DTJ-224) — РЕАЛЬНЫЙ Redis, не мок
 * (тест-план тикета: `hold`/`extend`/TTL-истечение/`getActiveHolds` с несколькими холдами и
 * исключением; D-EP09-14 `reports/EP09-CTO-BRIEF.md`: Testcontainers не используются — живой
 * локальный Redis + `describe.skipIf`, тот же приём, что `redis-lock-guard.integration.spec.ts`).
 *
 * TTL в тестах — искусственно короткий (секунды, не 900), чтобы дождаться реального истечения
 * без раздувания времени прогона (ticket «Тест-план»: «искусственно короткий TTL, не 900»).
 */
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { RedisCartHoldStoreAdapter } from '@/modules/orders/infrastructure/adapters/redis-cart-hold-store.adapter.js'

const TEST_REDIS_URL =
  process.env.ORDERS_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379'

const PROBE_TIMEOUT_MS = 1_500
const SHORT_TTL_SECONDS = 1
const LONGER_TTL_SECONDS = 3
const TTL_WAIT_BUFFER_MS = 1_200
const TEST_KEY_PREFIX = 'test:dtj224:'

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const redisAvailable = await isRedisReachable(TEST_REDIS_URL)

describe.skipIf(!redisAvailable)('RedisCartHoldStoreAdapter — integration (DTJ-224)', () => {
  let redis: Redis
  let adapter: RedisCartHoldStoreAdapter
  const usedIndexKeys: string[] = []

  beforeAll(() => {
    redis = new Redis(TEST_REDIS_URL)
    adapter = new RedisCartHoldStoreAdapter(redis)
  })

  afterAll(async () => {
    await redis.quit().catch(() => undefined)
  })

  afterEach(async () => {
    // Индекс (`ZSET`) не имеет собственного TTL — подчищаем явно, значения холдов (`SET ... EX`)
    // сами истекают, но не будем ждать (правило 5 AGENTS.md: ноль мусора после прогонов).
    const keys = await redis.keys(`${TEST_KEY_PREFIX}*`)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
    if (usedIndexKeys.length > 0) {
      await redis.del(...usedIndexKeys)
      usedIndexKeys.length = 0
    }
  })

  function testIds(name: string): { pharmacyId: string; medicineId: string } {
    const suffix = `${name}:${String(Date.now())}`
    const pharmacyId = `${TEST_KEY_PREFIX}pharm:${suffix}`
    const medicineId = `${TEST_KEY_PREFIX}med:${suffix}`
    usedIndexKeys.push(`cart:hold:idx:${pharmacyId}:${medicineId}`)
    return { pharmacyId, medicineId }
  }

  it('hold + getActiveHolds — один холд, без исключения → его количество', async () => {
    const { pharmacyId, medicineId } = testIds('single')
    const cartItemId = 'item-1'

    await adapter.hold({ pharmacyId, medicineId, cartItemId, quantity: 3, ttlSeconds: LONGER_TTL_SECONDS })

    expect(await adapter.getActiveHolds(pharmacyId, medicineId)).toBe(3)
  })

  it('getActiveHolds суммирует НЕСКОЛЬКО активных холдов на одну пару (pharmacyId, medicineId)', async () => {
    const { pharmacyId, medicineId } = testIds('sum')

    await adapter.hold({ pharmacyId, medicineId, cartItemId: 'item-a', quantity: 3, ttlSeconds: LONGER_TTL_SECONDS })
    await adapter.hold({ pharmacyId, medicineId, cartItemId: 'item-b', quantity: 5, ttlSeconds: LONGER_TTL_SECONDS })

    expect(await adapter.getActiveHolds(pharmacyId, medicineId)).toBe(8)
  })

  it('getActiveHolds с excludeCartItemId исключает СВОЙ холд из суммы', async () => {
    const { pharmacyId, medicineId } = testIds('exclude')

    await adapter.hold({ pharmacyId, medicineId, cartItemId: 'item-own', quantity: 3, ttlSeconds: LONGER_TTL_SECONDS })
    await adapter.hold({
      pharmacyId,
      medicineId,
      cartItemId: 'item-other',
      quantity: 5,
      ttlSeconds: LONGER_TTL_SECONDS,
    })

    expect(await adapter.getActiveHolds(pharmacyId, medicineId, 'item-own')).toBe(5)
  })

  it('hold дважды на тот же cartItemId ПЕРЕЗАПИСЫВАЕТ количество (SET, не INCR)', async () => {
    const { pharmacyId, medicineId } = testIds('overwrite')

    await adapter.hold({ pharmacyId, medicineId, cartItemId: 'item-1', quantity: 2, ttlSeconds: LONGER_TTL_SECONDS })
    await adapter.hold({ pharmacyId, medicineId, cartItemId: 'item-1', quantity: 7, ttlSeconds: LONGER_TTL_SECONDS })

    expect(await adapter.getActiveHolds(pharmacyId, medicineId)).toBe(7)
  })

  it('TTL истёк → просроченный холд не учитывается в getActiveHolds (AC3 DTJ-224)', async () => {
    const { pharmacyId, medicineId } = testIds('expiry')

    await adapter.hold({
      pharmacyId,
      medicineId,
      cartItemId: 'item-expiring',
      quantity: 4,
      ttlSeconds: SHORT_TTL_SECONDS,
    })
    expect(await adapter.getActiveHolds(pharmacyId, medicineId)).toBe(4)

    await wait(SHORT_TTL_SECONDS * 1000 + TTL_WAIT_BUFFER_MS)

    expect(await adapter.getActiveHolds(pharmacyId, medicineId)).toBe(0)
  })

  it('extend продлевает TTL — холд переживает исходный короткий срок', async () => {
    const { pharmacyId, medicineId } = testIds('extend')
    const cartItemId = 'item-extended'

    await adapter.hold({ pharmacyId, medicineId, cartItemId, quantity: 6, ttlSeconds: SHORT_TTL_SECONDS })
    await adapter.extend({ pharmacyId, medicineId, cartItemId, ttlSeconds: LONGER_TTL_SECONDS })

    await wait(SHORT_TTL_SECONDS * 1000 + TTL_WAIT_BUFFER_MS)

    // Пережил бы SHORT_TTL, если бы extend не сработал.
    expect(await adapter.getActiveHolds(pharmacyId, medicineId)).toBe(6)
  })

  it('extend на НЕСУЩЕСТВУЮЩИЙ холд — no-op, не создаёт фантомную запись', async () => {
    const { pharmacyId, medicineId } = testIds('extend-missing')

    await expect(
      adapter.extend({ pharmacyId, medicineId, cartItemId: 'never-held', ttlSeconds: LONGER_TTL_SECONDS }),
    ).resolves.toBeUndefined()

    expect(await adapter.getActiveHolds(pharmacyId, medicineId)).toBe(0)
  })

  it('getActiveHolds без единого холда на паре → 0', async () => {
    const { pharmacyId, medicineId } = testIds('empty')

    expect(await adapter.getActiveHolds(pharmacyId, medicineId)).toBe(0)
  })

  it('НЕ использует KEYS/SCAN — только SET/EXPIRE/ZADD/ZRANGE/ZREMRANGEBYSCORE/MGET (DoD DTJ-224)', async () => {
    const { pharmacyId, medicineId } = testIds('no-keys')
    const monitor = await redis.monitor()
    const commandsSeen: string[] = []
    monitor.on('monitor', (_time: string, args: string[]) => {
      commandsSeen.push(args[0]?.toUpperCase() ?? '')
    })

    await adapter.hold({ pharmacyId, medicineId, cartItemId: 'item-1', quantity: 1, ttlSeconds: LONGER_TTL_SECONDS })
    await adapter.getActiveHolds(pharmacyId, medicineId)
    await adapter.extend({ pharmacyId, medicineId, cartItemId: 'item-1', ttlSeconds: LONGER_TTL_SECONDS })
    await wait(50)
    monitor.disconnect()

    expect(commandsSeen).not.toContain('KEYS')
    expect(commandsSeen).not.toContain('SCAN')
  })
})
