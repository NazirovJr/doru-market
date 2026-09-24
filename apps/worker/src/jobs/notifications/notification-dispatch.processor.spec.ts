/** Каскад на следующий канал при исчерпании попыток (АС2), permanent-fail для нереализованных каналов. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job, Queue } from 'bullmq'
import type { NotificationDispatchJobData } from '@dorutj/contracts'
import type {
  CreateNotificationRowResult,
  NotificationDispatchStorePort,
  WorkerNotificationTemplate,
  WorkerUserProfile,
} from './notification-dispatch-store.port.js'
import type { TelegramSenderPort, TelegramSendResult } from './telegram-sender.port.js'
import { NotificationDispatchProcessor } from './notification-dispatch.processor.js'

const TELEGRAM_BOT_TOKEN_NEUTRAL = 'TELEGRAM_BOT_TOKEN_NEUTRAL'

function baseJobData(overrides?: Partial<NotificationDispatchJobData>): NotificationDispatchJobData {
  return {
    notificationId: 'notif-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    channel: 'telegram',
    eventType: 'order.paid',
    sourceEventId: 'evt-1',
    remainingChannels: ['sms', 'web_push'],
    templateVariables: { orderNumber: '42' },
    ...overrides,
  }
}

function fakeJob(data: NotificationDispatchJobData, attemptsMade: number, attempts = 3): Job<NotificationDispatchJobData> {
  return { id: data.notificationId, data, attemptsMade, opts: { attempts } } as Job<NotificationDispatchJobData>
}

interface StoreHarness {
  readonly store: NotificationDispatchStorePort
  readonly getUserProfile: ReturnType<typeof vi.fn>
  readonly createNotification: ReturnType<typeof vi.fn>
  readonly markNotificationResult: ReturnType<typeof vi.fn>
}

function buildStore(overrides?: { readonly profile?: WorkerUserProfile | null; readonly createNotificationResult?: CreateNotificationRowResult }): StoreHarness {
  const profile: WorkerUserProfile | null =
    overrides?.profile === undefined ? { tenantId: 'tenant-1', telegramChatId: 555n, preferredLocale: 'ru' } : overrides.profile
  const template: WorkerNotificationTemplate = {
    subject: null,
    body: '{{brandName}}: заказ {{orderNumber}} оплачен',
    requiredVariables: ['brandName', 'orderNumber'],
  }

  const getUserProfile = vi.fn().mockResolvedValue(profile)
  const createNotification = vi
    .fn()
    .mockResolvedValue(overrides?.createNotificationResult ?? ({ id: 'notif-2', created: true } satisfies CreateNotificationRowResult))
  const markNotificationResult = vi.fn().mockResolvedValue(undefined)

  const store: NotificationDispatchStorePort = {
    getUserProfile,
    getBrandName: vi.fn().mockResolvedValue('Апрель'),
    findTemplate: vi.fn().mockResolvedValue(template),
    createNotification,
    markNotificationResult,
  }
  return { store, getUserProfile, createNotification, markNotificationResult }
}

interface QueueHarness {
  readonly queue: Queue<NotificationDispatchJobData>
  readonly add: ReturnType<typeof vi.fn>
}

function buildQueue(): QueueHarness {
  const add = vi.fn().mockResolvedValue(undefined)
  return { queue: { add } as unknown as Queue<NotificationDispatchJobData>, add }
}

function buildTelegramSender(result: TelegramSendResult): { readonly sender: TelegramSenderPort; readonly send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue(result)
  return { sender: { send }, send }
}

describe('NotificationDispatchProcessor (DTJ-370)', () => {
  beforeEach(() => {
    process.env[TELEGRAM_BOT_TOKEN_NEUTRAL] = 'test-token'
  })

  it('telegram отправлен успешно — markNotificationResult("sent"), каскад НЕ вызывается', async () => {
    const { store, markNotificationResult } = buildStore()
    const { queue, add } = buildQueue()
    const { sender } = buildTelegramSender({ success: true, providerMessageId: '1' })
    const processor = new NotificationDispatchProcessor(store, queue, sender)

    await processor.process(fakeJob(baseJobData(), 0))

    expect(markNotificationResult).toHaveBeenCalledExactlyOnceWith('notif-1', 'sent')
    expect(add).not.toHaveBeenCalled()
  })

  it('telegram провален, НЕ последняя попытка — бросает (BullMQ ретраит), markNotificationResult НЕ вызван', async () => {
    const { store, markNotificationResult } = buildStore()
    const { queue, add } = buildQueue()
    const { sender } = buildTelegramSender({ success: false, failedReason: 'blocked' })
    const processor = new NotificationDispatchProcessor(store, queue, sender)

    await expect(processor.process(fakeJob(baseJobData(), 0, 3))).rejects.toThrow()
    expect(markNotificationResult).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it('АС2/TC-ADM-025: последняя попытка провалена — failed + каскад на следующий канал матрицы (sms)', async () => {
    const { store, markNotificationResult, createNotification } = buildStore()
    const { queue, add } = buildQueue()
    const { sender } = buildTelegramSender({ success: false, failedReason: 'blocked' })
    const processor = new NotificationDispatchProcessor(store, queue, sender)

    await processor.process(fakeJob(baseJobData(), 2, 3))

    expect(markNotificationResult).toHaveBeenCalledExactlyOnceWith('notif-1', 'failed', expect.any(String))
    expect(createNotification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ channel: 'sms', status: 'queued' }))
    expect(add).toHaveBeenCalledExactlyOnceWith('sms', expect.objectContaining({ channel: 'sms', remainingChannels: ['web_push'] }), expect.any(Object))
  })

  it('канал без провайдера (sms) — permanent-fail НЕМЕДЛЕННО, каскад даже на попытке 0 (не тратит 3 ретрая впустую)', async () => {
    const { store, markNotificationResult, createNotification } = buildStore()
    const { queue } = buildQueue()
    const { sender, send } = buildTelegramSender({ success: true })
    const processor = new NotificationDispatchProcessor(store, queue, sender)

    await processor.process(fakeJob(baseJobData({ channel: 'sms', remainingChannels: ['web_push'] }), 0, 3))

    expect(markNotificationResult).toHaveBeenCalledExactlyOnceWith('notif-1', 'failed', expect.any(String))
    expect(createNotification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ channel: 'web_push' }))
    expect(send).not.toHaveBeenCalled()
  })

  it('нет telegram_chat_id — permanent-fail немедленно, без вызова провайдера', async () => {
    const { store, markNotificationResult } = buildStore({ profile: { tenantId: 'tenant-1', telegramChatId: null, preferredLocale: 'ru' } })
    const { queue } = buildQueue()
    const { sender, send } = buildTelegramSender({ success: true })
    const processor = new NotificationDispatchProcessor(store, queue, sender)

    await processor.process(fakeJob(baseJobData({ remainingChannels: [] }), 0, 3))

    expect(send).not.toHaveBeenCalled()
    expect(markNotificationResult).toHaveBeenCalledExactlyOnceWith('notif-1', 'failed', expect.any(String))
  })

  it('remainingChannels пуст на последней попытке — failed, каскад не ставит job (панель недоставленных, DTJ-373)', async () => {
    const { store, markNotificationResult, createNotification } = buildStore()
    const { queue, add } = buildQueue()
    const { sender } = buildTelegramSender({ success: false, failedReason: 'blocked' })
    const processor = new NotificationDispatchProcessor(store, queue, sender)

    await processor.process(fakeJob(baseJobData({ remainingChannels: [] }), 2, 3))

    expect(markNotificationResult).toHaveBeenCalledExactlyOnceWith('notif-1', 'failed', expect.any(String))
    expect(createNotification).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it('каскад на уже существующий (created:false) — не ставит вторую job (идемпотентность)', async () => {
    const { store } = buildStore({ createNotificationResult: { id: 'notif-2', created: false } })
    const { queue, add } = buildQueue()
    const { sender } = buildTelegramSender({ success: false, failedReason: 'blocked' })
    const processor = new NotificationDispatchProcessor(store, queue, sender)

    await processor.process(fakeJob(baseJobData(), 2, 3))

    expect(add).not.toHaveBeenCalled()
  })
})
