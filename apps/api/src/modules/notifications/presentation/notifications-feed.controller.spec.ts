/**
 * Unit-тест `NotificationsFeedController` (DTJ-372).
 */
import { describe, expect, it, vi } from 'vitest'
import type { JwtClaims } from '@/modules/auth/index.js'
import { ROLES_METADATA_KEY } from '@/modules/auth/index.js'
import type { ListOwnNotificationsUseCase } from '../application/use-cases/list-own-notifications.use-case.js'
import { NotificationsFeedController } from './notifications-feed.controller.js'
import { USER_ROLES } from '@dorutj/contracts'
import { NotificationSummarySchema } from '@dorutj/contracts'
import { encodeCursor } from '@dorutj/contracts'
import { InvalidCursorError } from '@dorutj/contracts'
import { parseListCursor, parseStatusFilter } from './notifications-query.util.js'

describe('NotificationsFeedController', () => {
  it('роли: декоратор @Roles(...USER_ROLES) применён к контроллеру', () => {
    // Проверка декоратора @Roles через метаданные
    const roles = Reflect.getMetadata(ROLES_METADATA_KEY, NotificationsFeedController) as
      | readonly string[]
      | undefined
    expect(roles).toEqual(USER_ROLES)
    expect(roles).toContain('courier')
  })

  it('super_admin с tenantId: null получает ответ, а в use case уходит actor с tenantId: null', async () => {
    const executeMock = vi.fn(() => Promise.resolve({
      items: [] as ListNotificationsRecord[],
      nextCursor: null,
      hasMore: false,
    }))
    const useCaseMock = { execute: executeMock } as unknown as ListOwnNotificationsUseCase
    const controller = new NotificationsFeedController(useCaseMock)

    const claims = {
      sub: 'user-1',
      tenantId: null,
      role: 'super_admin',
    } as JwtClaims

    await controller.list({ limit: 20, cursor: undefined }, undefined, claims)

    expect(executeMock).toHaveBeenCalledTimes(1)
    const callArgs = executeMock.mock.calls[0] as unknown[]
    const actor = callArgs[0] as { actor: { tenantId: unknown } }
    expect(actor.actor.tenantId).toBe(null)
  })

  it('statusRaw queued,sent доходит до use case как statuses: [queued, sent]', async () => {
    const executeMock = vi.fn(() => Promise.resolve({
      items: [] as ListNotificationsRecord[],
      nextCursor: null,
      hasMore: false,
    }))
    const useCaseMock = { execute: executeMock } as unknown as ListOwnNotificationsUseCase
    const controller = new NotificationsFeedController(useCaseMock)

    const claims = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'customer',
    } as JwtClaims

    await controller.list({ limit: 20, cursor: undefined }, 'queued,sent', claims)

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['queued', 'sent'],
      }),
    )
  })

  it('ответ: ok(...) с pagination; nextCursor закодирован encodeCursor; элементы — DTO без failedReason', async () => {
    const executeMock = vi.fn(() => Promise.resolve({
      items: [
        {
          id: 'notification-1',
          eventType: 'order_ready',
          channel: 'in_app',
          status: 'queued',
          payload: { body: 'test' },
          sentAt: null,
          createdAt: new Date('2026-09-04T10:00:00.000Z'),
          userId: 'user-1',
          tenantId: 'tenant-1',
          failedReason: null,
        },
      ],
      nextCursor: { v: '2026-09-04T10:00:00.000Z', id: 'notification-1' },
      hasMore: false,
    }))
    const useCaseMock = { execute: executeMock } as unknown as ListOwnNotificationsUseCase
    const controller = new NotificationsFeedController(useCaseMock)

    const claims = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'customer',
    } as JwtClaims

    const result = await controller.list({ limit: 20, cursor: undefined }, undefined, claims)

    expect('data' in result).toBe(true)
    expect('meta' in result).toBe(true)
    expect(result.meta?.pagination).toBeDefined()
    expect(result.meta?.pagination?.nextCursor).toBe(encodeCursor({ v: '2026-09-04T10:00:00.000Z', id: 'notification-1' }))
    expect(result.meta?.pagination?.hasMore).toBe(false)
    expect(result.meta?.pagination?.limit).toBe(20)

    const summary = result.data[0]
    const parsed = NotificationSummarySchema.safeParse(summary)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        id: 'notification-1',
        channel: 'in_app',
        status: 'queued',
        payload: { body: 'test' },
        eventType: 'order_ready',
        sentAt: null,
        createdAt: '2026-09-04T10:00:00.000Z',
      })
      expect('failedReason' in parsed.data).toBe(false)
    }
  })

  it('parseStatusFilter: queued,sent → [queued, sent];  queued , ,sent  → то же; undefined → undefined', () => {
    expect(parseStatusFilter('queued,sent')).toEqual(['queued', 'sent'])
    expect(parseStatusFilter(' queued , ,sent ')).toEqual(['queued', 'sent'])
    expect(parseStatusFilter(undefined)).toBeUndefined()
    expect(parseStatusFilter('')).toBeUndefined()
    expect(parseStatusFilter('   ')).toBeUndefined()
  })

  it('parseStatusFilter: неизвестный статус deleted → бросает ValidationError', () => {
    expect(() => parseStatusFilter('deleted')).toThrow()
  })

  it('parseListCursor: мусор вместо курсора not-a-cursor → бросает InvalidCursorError', () => {
    expect(() => parseListCursor('not-a-cursor')).toThrow(InvalidCursorError)
  })

  it('parseListCursor: encodeCursor({ v, id }) → { v, id }', () => {
    const cursor = { v: '2026-09-04T10:00:00.000Z', id: 'notification-1' }
    const encoded = encodeCursor(cursor)
    expect(parseListCursor(encoded)).toEqual(cursor)
  })
})

interface ListNotificationsRecord {
  readonly id: string
  readonly eventType: string | null
  readonly channel: string
  readonly status: string
  readonly payload: Record<string, unknown>
  readonly sentAt: Date | null
  readonly createdAt: Date
  readonly userId: string
  readonly tenantId: string
  readonly failedReason: string | null
}
