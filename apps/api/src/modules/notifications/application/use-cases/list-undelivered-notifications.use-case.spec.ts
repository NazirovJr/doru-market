import { describe, expect, it, vi } from 'vitest'
import type { FindUndeliveredPage, NotificationsRepositoryPort } from '../ports/notifications-repository.port.js'
import { ListUndeliveredNotificationsUseCase } from './list-undelivered-notifications.use-case.js'

const PAGE: FindUndeliveredPage = {
  items: [
    {
      userId: 'user-1',
      tenantId: 'tenant-1',
      eventType: 'order.paid',
      sourceEventId: 'event-1',
      attempts: [
        { channel: 'telegram', status: 'failed', failedReason: 'нет telegram_chat_id', attemptedAt: new Date('2026-09-01T00:00:00.000Z') },
        { channel: 'sms', status: 'failed', failedReason: 'провайдер не реализован', attemptedAt: new Date('2026-09-01T00:00:05.000Z') },
      ],
      lastAttemptAt: new Date('2026-09-01T00:00:05.000Z'),
    },
  ],
  nextCursor: { v: '2026-09-01T00:00:05.000Z', id: 'notif-2' },
  hasMore: true,
}

function buildHarness(): {
  useCase: ListUndeliveredNotificationsUseCase
  findMock: ReturnType<typeof vi.fn<NotificationsRepositoryPort['findUndeliveredAcrossAllChannels']>>
} {
  const findMock = vi.fn<NotificationsRepositoryPort['findUndeliveredAcrossAllChannels']>().mockResolvedValue(PAGE)
  const port: NotificationsRepositoryPort = {
    create: vi.fn(),
    list: vi.fn(),
    findUndeliveredAcrossAllChannels: findMock,
  }
  return { useCase: new ListUndeliveredNotificationsUseCase(port), findMock }
}

describe('ListUndeliveredNotificationsUseCase (DTJ-373)', () => {
  it('передаёт limit/cursor из command в порт без изменений', async () => {
    const { useCase, findMock } = buildHarness()
    const cursor = { v: '2026-08-01T00:00:00.000Z', id: 'anchor' }

    await useCase.execute({ limit: 20, cursor })

    expect(findMock).toHaveBeenCalledWith({ limit: 20, cursor })
  })

  it('cursor отсутствует в command → порт получает cursor: null', async () => {
    const { useCase, findMock } = buildHarness()

    await useCase.execute({ limit: 20 })

    expect(findMock).toHaveBeenCalledWith({ limit: 20, cursor: null })
  })

  it('пробрасывает items/nextCursor/hasMore из порта без изменений', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ limit: 20 })

    expect(result).toEqual(PAGE)
  })
})
