import { describe, expect, it, vi } from 'vitest'
import { type IdentityFacadePort, type NotificationRecipientProfile } from '@/modules/notifications/application/ports/identity-facade.port.js'
import {
  type CreateNotificationInput,
  type NotificationRecord,
  type NotificationsRepositoryPort,
} from '@/modules/notifications/application/ports/notifications-repository.port.js'
import { InAppNotifyProvider } from './in-app-notify.provider.js'

function stubIdentityFacade(profile: NotificationRecipientProfile | null): IdentityFacadePort {
  return { getRecipientProfile: vi.fn().mockResolvedValue(profile) }
}

function fakeRecord(input: CreateNotificationInput): NotificationRecord {
  return { ...input, id: 'notification-1', sentAt: new Date('2026-01-01T00:00:00Z'), failedReason: null, createdAt: new Date('2026-01-01T00:00:00Z') }
}

describe('InAppNotifyProvider', () => {
  it('критерий приёмки 3 DTJ-368: синхронная запись с channel=in_app, status=sent НЕМЕДЛЕННО', async () => {
    const identityFacade = stubIdentityFacade({ tenantId: 'tenant-1', telegramChatId: null })
    const create = vi.fn().mockImplementation((input: CreateNotificationInput) => Promise.resolve(fakeRecord(input)))
    const list = vi.fn<NotificationsRepositoryPort['list']>().mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
    const repository: NotificationsRepositoryPort = { create, list }
    const provider = new InAppNotifyProvider(identityFacade, repository)

    const result = await provider.send('user-1', 'in_app', { subject: 'Заказ №1', body: 'Готов к выдаче' })

    expect(result).toEqual({ success: true, providerMessageId: 'notification-1' })
    expect(create).toHaveBeenCalledExactlyOnceWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      channel: 'in_app',
      status: 'sent',
      payload: { subject: 'Заказ №1', body: 'Готов к выдаче' },
    })
  })

  it('без subject — payload содержит только body', async () => {
    const identityFacade = stubIdentityFacade({ tenantId: 'tenant-1', telegramChatId: null })
    const create = vi.fn().mockImplementation((input: CreateNotificationInput) => Promise.resolve(fakeRecord(input)))
    const list = vi.fn<NotificationsRepositoryPort['list']>().mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
    const repository: NotificationsRepositoryPort = { create, list }
    const provider = new InAppNotifyProvider(identityFacade, repository)

    await provider.send('user-1', 'in_app', { body: 'Готов к выдаче' })

    expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ payload: { body: 'Готов к выдаче' } }))
  })

  it('пользователь не найден — { success: false }, запись НЕ создаётся', async () => {
    const identityFacade = stubIdentityFacade(null)
    const create = vi.fn()
    const list = vi.fn<NotificationsRepositoryPort['list']>().mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
    const repository: NotificationsRepositoryPort = { create, list }
    const provider = new InAppNotifyProvider(identityFacade, repository)

    const result = await provider.send('user-missing', 'in_app', { body: 'привет' })

    expect(result).toEqual({ success: false })
    expect(create).not.toHaveBeenCalled()
  })
})
