/**
 * Реальный BullMQ+Redis, тестовые `NotificationDispatchStorePort`/`TelegramSenderPort` через DI.
 * АС2: telegram проваливается все 3 попытки (короткий тестовый backoff) → failed + реальная job каскада на sms.
 */
import IORedis, { type Redis } from 'ioredis'
import { Queue, Worker } from 'bullmq'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NotificationDispatchJobData } from '@dorutj/contracts'
import { NotificationDispatchProcessor } from './notification-dispatch.processor.js'
import type { CreateNotificationRowResult, NotificationDispatchStorePort, WorkerNotificationTemplate, WorkerUserProfile } from './notification-dispatch-store.port.js'
import type { TelegramSenderPort } from './telegram-sender.port.js'

const TEST_REDIS_URL = process.env.WORKER_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const PROBE_TIMEOUT_MS = 500
const QUEUE_NAME = 'notification-dispatch-e2e-DTJ-370'
const TEST_BACKOFF_TYPE = 'test-fast-backoff'
const TEST_BACKOFF_MS = [50, 80, 120]
const TEST_BACKOFF_LAST_MS = 120
const TEST_TIMEOUT_MS = 15_000
const WAIT_MARGIN_MS = 5_000

async function isRedisReachable(url: string): Promise<boolean> {
  const client = new IORedis(url, { lazyConnect: true, connectTimeout: PROBE_TIMEOUT_MS, maxRetriesPerRequest: 0, retryStrategy: () => null })
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

function fakeStore(): { readonly store: NotificationDispatchStorePort; readonly markCalls: { id: string; status: string; reason?: string | undefined }[]; readonly createCalls: NotificationDispatchJobData['channel'][] } {
  const profile: WorkerUserProfile = { tenantId: 'tenant-e2e', telegramChatId: 777n, preferredLocale: 'ru' }
  const template: WorkerNotificationTemplate = { subject: null, body: '{{brandName}}: {{orderNumber}}', requiredVariables: ['brandName', 'orderNumber'] }
  const markCalls: { id: string; status: string; reason?: string | undefined }[] = []
  const createCalls: NotificationDispatchJobData['channel'][] = []
  let nextId = 1

  const store: NotificationDispatchStorePort = {
    getUserProfile: () => Promise.resolve(profile),
    getBrandName: () => Promise.resolve('DTJ-370-e2e'),
    findTemplate: () => Promise.resolve(template),
    createNotification: (input) => {
      createCalls.push(input.channel)
      nextId += 1
      return Promise.resolve({ id: `notif-cascade-${String(nextId)}`, created: true } satisfies CreateNotificationRowResult)
    },
    markNotificationResult: (id, status, reason) => {
      markCalls.push({ id, status, reason })
      return Promise.resolve()
    },
  }
  return { store, markCalls, createCalls }
}

describe.skipIf(!testRedisAvailable)('NotificationDispatchProcessor — e2e (DTJ-370, реальный BullMQ + Redis)', () => {
  let connection: Redis
  let queue: Queue<NotificationDispatchJobData>
  let worker: Worker<NotificationDispatchJobData>

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN_NEUTRAL = 'test-bot-token-for-notification-dispatch-e2e'
    connection = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
    queue = new Queue<NotificationDispatchJobData>(QUEUE_NAME, { connection })
    await queue.obliterate({ force: true }).catch(() => undefined)
  })

  afterAll(async () => {
    await worker.close()
    await queue.obliterate({ force: true }).catch(() => undefined)
    await queue.close()
    connection.disconnect()
  })

  it(
    'АС2: telegram проваливается все 3 попытки (реальный retry/backoff BullMQ) → failed + реальная job каскада на sms',
    async () => {
      const { store, markCalls, createCalls } = fakeStore()
      const send = vi.fn().mockResolvedValue({ success: false, failedReason: 'HTTP 500' })
      const alwaysFails: TelegramSenderPort = { send }
      const processor = new NotificationDispatchProcessor(store, queue, alwaysFails)

      worker = new Worker<NotificationDispatchJobData>(QUEUE_NAME, (job) => processor.process(job), {
        connection,
        settings: { backoffStrategy: (attemptsMade: number) => TEST_BACKOFF_MS[attemptsMade - 1] ?? TEST_BACKOFF_LAST_MS },
      })
      await worker.waitUntilReady()

      const jobData: NotificationDispatchJobData = {
        notificationId: 'notif-e2e-1',
        userId: 'user-e2e-1',
        tenantId: 'tenant-e2e',
        channel: 'telegram',
        eventType: 'order.paid',
        sourceEventId: 'evt-e2e-1',
        remainingChannels: ['sms'],
        templateVariables: { orderNumber: '777' },
      }
      await queue.add('telegram', jobData, { jobId: 'notif-e2e-1', attempts: 3, backoff: { type: TEST_BACKOFF_TYPE } })

      await expect.poll(() => markCalls.length, { timeout: WAIT_MARGIN_MS, interval: 25 }).toBeGreaterThan(0)
      expect(markCalls[0]).toMatchObject({ id: 'notif-e2e-1', status: 'failed' })
      expect(send).toHaveBeenCalledTimes(3)

      await expect.poll(() => createCalls.length, { timeout: WAIT_MARGIN_MS, interval: 25 }).toBeGreaterThan(0)
      expect(createCalls).toContain('sms')
    },
    TEST_TIMEOUT_MS,
  )
})
