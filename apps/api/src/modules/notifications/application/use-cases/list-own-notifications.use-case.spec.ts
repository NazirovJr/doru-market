/**
 * Unit-тест `ListOwnNotificationsUseCase` (DTJ-372).
 */
import { describe, expect, it, vi } from 'vitest'
import type { NotificationStatus, NotificationsRepositoryPort } from '../ports/notifications-repository.port.js'
import { ListOwnNotificationsUseCase } from './list-own-notifications.use-case.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')
const TENANT_ID = 'tenant-1'

function notificationRecord(userId: string, status: NotificationStatus): { id: string; userId: string; tenantId: string; channel: 'in_app'; status: NotificationStatus; payload: Record<string, unknown>; sentAt: Date | null; failedReason: string | null; createdAt: Date } {
  return {
    id: 'notification-1',
    userId,
    tenantId: TENANT_ID,
    channel: 'in_app' as const,
    status,
    payload: { message: 'test' },
    sentAt: null,
    failedReason: null,
    createdAt: NOW,
  }
}

function actor(userId: string): { userId: string; tenantId: string } {
  return { userId, tenantId: TENANT_ID }
}

function buildHarness() {
  const listMock = vi.fn<NotificationsRepositoryPort['list']>().mockResolvedValue({
    items: [notificationRecord('user-1', 'queued')],
    nextCursor: { v: '2026-09-04', id: 'notification-1' },
    hasMore: true,
  })
  const repository: NotificationsRepositoryPort = {
    create: vi.fn(),
    list: listMock,
  }
  const useCase = new ListOwnNotificationsUseCase(repository)
  return { useCase, listMock }
}

describe('ListOwnNotificationsUseCase', () => {
  it('userId из актора', async () => {
    const { useCase, listMock } = buildHarness()
    const command = {
      actor: actor('user-1'),
      status: undefined,
      limit: 20,
      cursor: null,
    }
    await useCase.execute(command)
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tenantId: TENANT_ID,
      }),
    )
  })

  it('фильтр по статусу передаётся в порт как есть', async () => {
    const { useCase, listMock } = buildHarness()
    await useCase.execute({
      actor: actor('user-1'),
      status: 'queued',
      limit: 20,
      cursor: null,
    })
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
      }),
    )
  })

  it('сортировка по createdAt убывающая — от новых к старым', async () => {
    const { useCase, listMock } = buildHarness()
    await useCase.execute({
      actor: actor('user-1'),
      limit: 20,
      cursor: null,
    })
    expect(listMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        limit: 20,
        cursor: null,
      }),
    )
  })

  it('курсор: когда порт вернул строк больше, чем limit, в результате есть nextCursor и hasMore', async () => {
    const { useCase } = buildHarness()
    const cursor = { v: '2026-09-01', id: 'anchor' }
    const result = await useCase.execute({
      actor: actor('user-1'),
      limit: 20,
      cursor,
    })
    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toEqual({ v: '2026-09-04', id: 'notification-1' })
    expect(result.hasMore).toBe(true)
  })
})
