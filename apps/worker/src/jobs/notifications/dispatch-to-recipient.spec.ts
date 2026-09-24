/** DTJ-370 — тест-план: in_app синхронно и первым (даже без внешних каналов), идемпотентность через created:false. */
import { describe, expect, it, vi } from 'vitest'
import type { NotificationChannel } from '@dorutj/contracts'
import type { CreateNotificationRowResult, NotificationDispatchStorePort, WorkerNotificationTemplate, WorkerUserProfile } from './notification-dispatch-store.port.js'
import { dispatchToRecipient } from './dispatch-to-recipient.js'

const PROFILE: WorkerUserProfile = { tenantId: 'tenant-1', telegramChatId: 555n, preferredLocale: 'ru' }
const IN_APP_TEMPLATE: WorkerNotificationTemplate = { subject: null, body: '{{brandName}}: заказ {{orderNumber}} оплачен', requiredVariables: ['brandName', 'orderNumber'] }

function buildStore(overrides?: Partial<NotificationDispatchStorePort>): NotificationDispatchStorePort {
  return {
    insertProcessedEventIfNew: vi.fn(),
    getUserProfile: vi.fn().mockResolvedValue(PROFILE),
    getBrandName: vi.fn().mockResolvedValue('Апрель'),
    findTemplate: vi.fn().mockResolvedValue(IN_APP_TEMPLATE),
    createNotification: vi.fn().mockResolvedValue({ id: 'notif-1', created: true } satisfies CreateNotificationRowResult),
    markNotificationResult: vi.fn(),
    ...overrides,
  }
}

function buildDeps(store: NotificationDispatchStorePort) {
  const callOrder: string[] = []
  const trackedStore: NotificationDispatchStorePort = {
    ...store,
    createNotification: vi.fn().mockImplementation((input: Parameters<NotificationDispatchStorePort['createNotification']>[0]) => {
      callOrder.push(`createNotification:${input.channel}`)
      return store.createNotification(input)
    }),
  }
  const enqueue = vi.fn().mockImplementation(() => {
    callOrder.push('enqueue')
    return Promise.resolve()
  })
  return { deps: { store: trackedStore, enqueue, logger: { warn: vi.fn(), error: vi.fn() } }, callOrder, enqueue }
}

describe('dispatchToRecipient (DTJ-370)', () => {
  it('in_app создаётся ДО постановки внешнего канала в очередь', async () => {
    const store = buildStore()
    const { deps, callOrder } = buildDeps(store)

    await dispatchToRecipient(deps, {
      userId: 'user-1',
      eventType: 'order.paid',
      sourceEventId: 'evt-1',
      channels: ['telegram', 'sms', 'in_app'],
      variables: { orderNumber: '42' },
    })

    expect(callOrder.indexOf('createNotification:in_app')).toBeLessThan(callOrder.indexOf('enqueue'))
  })

  it('ставит в очередь только первый внешний канал, remainingChannels — остальные без in_app', async () => {
    const store = buildStore()
    const { deps, enqueue } = buildDeps(store)

    await dispatchToRecipient(deps, {
      userId: 'user-1',
      eventType: 'order.paid',
      sourceEventId: 'evt-1',
      channels: ['telegram', 'sms', 'web_push', 'in_app'],
      variables: { orderNumber: '42' },
    })

    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ channel: 'telegram' satisfies NotificationChannel, remainingChannels: ['sms', 'web_push'] }),
      'notif-1',
    )
  })

  it('только in_app в матрице (нет внешних каналов) — очередь не вызывается', async () => {
    const store = buildStore()
    const { deps, enqueue } = buildDeps(store)

    await dispatchToRecipient(deps, { userId: 'user-1', eventType: 'ops.sla_breached', sourceEventId: 'evt-1', channels: ['in_app'], variables: {} })

    expect(enqueue).not.toHaveBeenCalled()
  })

  it('пользователь не найден — ничего не создаётся, не бросает', async () => {
    const store = buildStore({ getUserProfile: vi.fn().mockResolvedValue(null) })
    const { deps, enqueue } = buildDeps(store)

    await expect(
      dispatchToRecipient(deps, { userId: 'missing', eventType: 'order.paid', sourceEventId: 'evt-1', channels: ['telegram', 'in_app'], variables: {} }),
    ).resolves.toBeUndefined()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('нет шаблона in_app — in_app пропущен (не бросает), внешний канал всё равно ставится в очередь', async () => {
    const store = buildStore({ findTemplate: vi.fn().mockResolvedValue(null) })
    const { deps, enqueue, callOrder } = buildDeps(store)

    await dispatchToRecipient(deps, { userId: 'user-1', eventType: 'order.paid', sourceEventId: 'evt-1', channels: ['telegram', 'in_app'], variables: { orderNumber: '42' } })

    expect(callOrder).not.toContain('createNotification:in_app')
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it('идемпотентность: created:false для внешнего канала — job НЕ ставится повторно', async () => {
    const store = buildStore({
      createNotification: vi
        .fn()
        .mockResolvedValueOnce({ id: 'notif-1', created: true })
        .mockResolvedValueOnce({ id: 'notif-2', created: false }),
    })
    const { deps, enqueue } = buildDeps(store)

    await dispatchToRecipient(deps, { userId: 'user-1', eventType: 'order.paid', sourceEventId: 'evt-1', channels: ['telegram', 'in_app'], variables: { orderNumber: '42' } })

    expect(enqueue).not.toHaveBeenCalled()
  })
})
