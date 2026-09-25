// Guard-поведение (403 для не-super_admin) покрыто спеками RolesGuard/AuthGuard и интеграционным e2e — здесь маппинг query→command→DTO.
import { describe, expect, it, vi } from 'vitest'
import { decodeCursor, encodeCursor, type CursorQuery } from '@dorutj/contracts'
import type { FindUndeliveredPage } from '../application/ports/notifications-repository.port.js'
import { NotificationsDiagnosticsController } from './notifications-diagnostics.controller.js'
import type { ListUndeliveredNotificationsUseCase } from '../application/use-cases/list-undelivered-notifications.use-case.js'

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

function baseQuery(overrides: Partial<CursorQuery> = {}): CursorQuery {
  return { limit: 20, ...overrides }
}

function buildController(page: FindUndeliveredPage = PAGE): {
  controller: NotificationsDiagnosticsController
  executeMock: ReturnType<typeof vi.fn>
} {
  const executeMock = vi.fn().mockResolvedValue(page)
  const useCase = { execute: executeMock } as unknown as ListUndeliveredNotificationsUseCase
  return { controller: new NotificationsDiagnosticsController(useCase), executeMock }
}

describe('NotificationsDiagnosticsController.list (DTJ-373)', () => {
  it('без cursor в query — use case получает cursor: null', async () => {
    const { controller, executeMock } = buildController()

    await controller.list(baseQuery())

    expect(executeMock).toHaveBeenCalledWith({ limit: 20, cursor: null })
  })

  it('валидный cursor в query — декодируется в {v, id} для use case', async () => {
    const { controller, executeMock } = buildController()
    const cursor = encodeCursor({ v: '2026-08-01T00:00:00.000Z', id: 'anchor' })

    await controller.list(baseQuery({ cursor }))

    expect(executeMock).toHaveBeenCalledWith({ limit: 20, cursor: { v: '2026-08-01T00:00:00.000Z', id: 'anchor' } })
  })

  it('невалидный cursor — бросает InvalidCursorError ДО вызова use case', async () => {
    const { controller, executeMock } = buildController()

    await expect(controller.list(baseQuery({ cursor: 'not-a-valid-cursor!!!' }))).rejects.toThrow(/Cannot decode cursor/)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('маппит результат use case в DTO: attemptedAt/lastAttemptAt → ISO-строки, meta.pagination заполнена', async () => {
    const { controller } = buildController()

    const result = await controller.list(baseQuery())

    expect(result.data).toEqual([
      {
        userId: 'user-1',
        tenantId: 'tenant-1',
        eventType: 'order.paid',
        sourceEventId: 'event-1',
        attempts: [
          { channel: 'telegram', status: 'failed', failedReason: 'нет telegram_chat_id', attemptedAt: '2026-09-01T00:00:00.000Z' },
          { channel: 'sms', status: 'failed', failedReason: 'провайдер не реализован', attemptedAt: '2026-09-01T00:00:05.000Z' },
        ],
        lastAttemptAt: '2026-09-01T00:00:05.000Z',
      },
    ])
    expect(result.meta?.pagination?.hasMore).toBe(true)
    expect(result.meta?.pagination?.limit).toBe(20)
    expect(decodeCursor(result.meta?.pagination?.nextCursor ?? '')).toEqual({ v: '2026-09-01T00:00:05.000Z', id: 'notif-2' })
  })

  it('nextCursor: null из use case → meta.pagination.nextCursor: null (не закодированный "null")', async () => {
    const { controller } = buildController({ items: [], nextCursor: null, hasMore: false })

    const result = await controller.list(baseQuery())

    expect(result.data).toEqual([])
    expect(result.meta?.pagination?.nextCursor).toBeNull()
    expect(result.meta?.pagination?.hasMore).toBe(false)
  })
})
