/**
 * Unit-тест `ListOwnNotificationsUseCase` (DTJ-372).
 */
import { describe, expect, it, vi } from 'vitest'
import type { NotificationStatus, NotificationsRepositoryPort, ListNotificationsPage } from '../ports/notifications-repository.port.js'
import { ListOwnNotificationsUseCase, type ListNotificationsCursor } from './list-own-notifications.use-case.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')
const TENANT_ID = 'tenant-1'

function actor(userId: string, tenantId: string | null = TENANT_ID): { userId: string; tenantId: string | null } {
  return { userId, tenantId }
}

function buildHarness() {
  const listMock = vi.fn<NotificationsRepositoryPort['list']>()
  listMock.mockResolvedValue({
    items: [{
      id: 'notification-1',
      userId: 'user-1',
      tenantId: TENANT_ID,
      channel: 'in_app',
      status: 'queued',
      payload: { message: 'test' },
      sentAt: null,
      failedReason: null,
      createdAt: NOW,
    }],
    nextCursor: { v: '2026-09-04T10:00:00.000Z', id: 'notification-1' },
    hasMore: true,
  } as unknown as ListNotificationsPage)
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
    const command: ListOwnNotificationsCommand = {
      actor: actor('user-1'),
      statuses: undefined,
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

  it('super_admin без тенанта: в порт уходит tenantId: null', async () => {
    const { useCase, listMock } = buildHarness()
    const command: ListOwnNotificationsCommand = {
      actor: actor('user-1', null),
      statuses: undefined,
      limit: 20,
      cursor: null,
    }
    await useCase.execute(command)
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: null,
      }),
    )
  })

  it(' statuses [queued, sent] уходит в порт как есть', async () => {
    const { useCase, listMock } = buildHarness()
    const command: ListOwnNotificationsCommand = {
      actor: actor('user-1'),
      statuses: ['queued', 'sent'] as const,
      limit: 20,
      cursor: null,
    }
    await useCase.execute(command)
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['queued', 'sent'],
      }),
    )
  })

  it('порт всегда получает order: createdAt:desc', async () => {
    const { useCase, listMock } = buildHarness()
    const command: ListOwnNotificationsCommand = {
      actor: actor('user-1'),
      statuses: undefined,
      limit: 20,
      cursor: null,
    }
    await useCase.execute(command)
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        order: 'createdAt:desc',
      }),
    )
  })

  it('nextCursor и hasMore приходят из порта без изменений', async () => {
    const { useCase } = buildHarness()
    const cursor: ListNotificationsCursor = { v: '2026-09-01', id: 'anchor' }
    const result = await useCase.execute({
      actor: actor('user-1'),
      statuses: undefined,
      limit: 20,
      cursor,
    })
    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toEqual({ v: '2026-09-04T10:00:00.000Z', id: 'notification-1' })
    expect(result.hasMore).toBe(true)
  })
})

interface ListOwnNotificationsCommand {
  readonly actor: {
    readonly userId: string
    readonly tenantId: string | null
  }
  readonly statuses?: readonly NotificationStatus[] | undefined
  readonly limit: number
  readonly cursor: ListNotificationsCursor | null
}
