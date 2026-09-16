/**
 * Интеграционный тест `PartialFulfillmentTimeoutProcessor` (EP-12, DTJ-304) — РЕАЛЬНЫЙ
 * BullMQ/Redis (не мок), тот же приём, что `mock-bank.provider.integration.spec.ts` (EP-10,
 * DTJ-238) «enqueueWebhookJob() — РЕАЛЬНЫЙ BullMQ/Redis»: DoD тикета явно требует джобу,
 * покрытую тестом идемпотентности повторного планирования (`jobId`) против настоящего Redis,
 * не мока `queue.add`.
 *
 * Покрывает: (1) `jobId = requestId` — повторный `schedule()` с ТЕМ ЖЕ `requestId` НЕ создаёт
 * вторую джобу (BullMQ отбрасывает дубликат `jobId`, DoD тикета); (2) `delay` — корректно
 * переведён из минут в миллисекунды; (3) payload — `{ requestId, tenantId }`, форма СВОЯ копия
 * которой должна совпадать с `apps/worker/.../partial-fulfillment-timeout.types.ts` (см. JSDoc
 * процессора).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import Redis from 'ioredis'
import {
  PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME,
  PartialFulfillmentTimeoutProcessor,
} from '@/modules/orders/infrastructure/jobs/partial-fulfillment-timeout.processor.js'

const TEST_REDIS_URL = process.env.ORDERS_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379'
const PROBE_TIMEOUT_MS = 1_500
const TENANT_ID = 'tenant-1'

/** Тот же приём, что `mock-bank.provider.integration.spec.ts`/`redis-cart-hold-store.adapter.integration.spec.ts`. */
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

describe.skipIf(!redisAvailable)('PartialFulfillmentTimeoutProcessor — РЕАЛЬНЫЙ BullMQ/Redis (DTJ-304)', () => {
  let redis: Redis
  let processor: PartialFulfillmentTimeoutProcessor
  const scheduledRequestIds: string[] = []

  beforeAll(() => {
    redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
    processor = new PartialFulfillmentTimeoutProcessor(redis)
  })

  afterAll(async () => {
    await processor.onModuleDestroy()
    redis.disconnect()
  })

  afterEach(async () => {
    // Прямой доступ к приватному `queue` только для очистки тестовых джоб — тот же приём,
    // что `mock-bank.provider.integration.spec.ts` (`queue.getJob(id).remove()`).
    const queue = (processor as unknown as { queue: { getJob: (id: string) => Promise<{ remove: () => Promise<void> } | undefined> } }).queue
    for (const id of scheduledRequestIds.splice(0)) {
      const job = await queue.getJob(id)
      await job?.remove().catch(() => undefined)
    }
  })

  it('DoD — повторное schedule() с ТЕМ ЖЕ requestId идемпотентно: ровно ОДНА джоба в очереди', async () => {
    const requestId = randomUUID()
    scheduledRequestIds.push(requestId)

    await processor.schedule({ requestId, tenantId: TENANT_ID, timeoutMinutes: 10 })
    await processor.schedule({ requestId, tenantId: TENANT_ID, timeoutMinutes: 10 })

    const queue = (processor as unknown as { queue: { getJob: (id: string) => Promise<{ id?: string } | undefined> } }).queue
    const job = await queue.getJob(requestId)
    expect(job).toBeDefined()
    expect(job?.id).toBe(requestId)
  })

  it('jobId = requestId, delay = timeoutMinutes × 60000 мс, payload = { requestId, tenantId }', async () => {
    const requestId = randomUUID()
    scheduledRequestIds.push(requestId)

    await processor.schedule({ requestId, tenantId: TENANT_ID, timeoutMinutes: 7 })

    const queue = (
      processor as unknown as {
        queue: { getJob: (id: string) => Promise<{ id?: string; data: { requestId: string; tenantId: string }; opts: { delay?: number } } | undefined> }
      }
    ).queue
    const job = await queue.getJob(requestId)
    expect(job?.id).toBe(requestId)
    expect(job?.data).toEqual({ requestId, tenantId: TENANT_ID })
    expect(job?.opts.delay).toBe(7 * 60_000)
  })

  it('очередь называется PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME (1:1 с apps/worker QUEUE_NAMES.PARTIAL_FULFILLMENT_TIMEOUT)', () => {
    expect(PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME).toBe('partial-fulfillment-timeout')
  })
})
