// Guard-поведение (403) покрыто спеками RolesGuard/AuthGuard — здесь маппинг query→command→DTO.
import { describe, expect, it, vi } from 'vitest'
import { decodeCursor, encodeCursor, type AuditLogListQueryDto } from '@dorutj/contracts'
import type { AuditLogListPage } from '../audit-log-query.port.js'
import { AuditLogController } from './audit-log.controller.js'
import type { ListAuditLogUseCase } from '../application/use-cases/list-audit-log.use-case.js'

const PAGE: AuditLogListPage = {
  items: [
    {
      id: 'entry-1',
      category: 'payment_override',
      entityType: 'order',
      entityId: 'order-1',
      actorUserId: 'admin-1',
      action: 'admin_payment_override',
      reason: 'клиент оспорил списание',
      metadata: { before: { status: 'held' }, after: { status: 'captured' } },
      requestId: 'req-1',
      tenantId: 'tenant-1',
      createdAt: new Date('2026-08-15T00:00:00.000Z'),
    },
  ],
  nextCursor: { v: '2026-08-15T00:00:00.000Z', id: 'entry-1' },
  hasMore: true,
}

function baseQuery(overrides: Partial<AuditLogListQueryDto> = {}): AuditLogListQueryDto {
  return { limit: 20, ...overrides }
}

function buildController(page: AuditLogListPage = PAGE): { controller: AuditLogController; executeMock: ReturnType<typeof vi.fn> } {
  const executeMock = vi.fn().mockResolvedValue(page)
  const useCase = { execute: executeMock } as unknown as ListAuditLogUseCase
  return { controller: new AuditLogController(useCase), executeMock }
}

describe('AuditLogController.list (DTJ-376)', () => {
  it('без cursor в query — use case получает cursor: null', async () => {
    const { controller, executeMock } = buildController()

    await controller.list(baseQuery())

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ cursor: null }))
  })

  it('валидный cursor в query — декодируется в {v, id} для use case', async () => {
    const { controller, executeMock } = buildController()
    const cursor = encodeCursor({ v: '2026-08-01T00:00:00.000Z', id: 'anchor' })

    await controller.list(baseQuery({ cursor }))

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ cursor: { v: '2026-08-01T00:00:00.000Z', id: 'anchor' } }))
  })

  it('невалидный (не base64url/не JSON) cursor — бросает InvalidCursorError ДО вызова use case', async () => {
    const { controller, executeMock } = buildController()

    await expect(controller.list(baseQuery({ cursor: 'not-a-valid-cursor!!!' }))).rejects.toThrow(/Cannot decode cursor/)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('декодированный курсор без строкового v — бросает InvalidCursorError (форма курсора неверна)', async () => {
    const { controller } = buildController()
    const malformedCursor = Buffer.from(JSON.stringify({ v: 42, id: 'anchor' }), 'utf-8').toString('base64url')
    expect(decodeCursor(malformedCursor)).toEqual({ v: 42, id: 'anchor' })

    await expect(controller.list(baseQuery({ cursor: malformedCursor }))).rejects.toThrow(/Cannot decode cursor/)
  })

  it('все фильтры query переданы — filter use case несёт ровно их (пустые/undefined не подмешиваются)', async () => {
    const { controller, executeMock } = buildController()

    await controller.list(
      baseQuery({
        category: 'payment_override',
        entityType: 'order',
        entityId: 'order-1',
        actorUserId: 'admin-1',
        tenantId: 'tenant-1',
        createdAtFrom: new Date('2026-08-01T00:00:00.000Z'),
        createdAtTo: new Date('2026-08-31T00:00:00.000Z'),
      }),
    )

    expect(executeMock).toHaveBeenCalledWith({
      filter: {
        category: 'payment_override',
        entityType: 'order',
        entityId: 'order-1',
        actorUserId: 'admin-1',
        tenantId: 'tenant-1',
        createdAtFrom: new Date('2026-08-01T00:00:00.000Z'),
        createdAtTo: new Date('2026-08-31T00:00:00.000Z'),
      },
      limit: 20,
      cursor: null,
    })
  })

  it('ни один фильтр не передан — filter пустой объект (без "category: undefined" мусора)', async () => {
    const { controller, executeMock } = buildController()

    await controller.list(baseQuery())

    expect(executeMock).toHaveBeenCalledWith({ filter: {}, limit: 20, cursor: null })
  })

  it('маппит результат use case в DTO: createdAt → ISO-строка, nextCursor → закодированная строка, meta.pagination заполнена', async () => {
    const { controller } = buildController()

    const result = await controller.list(baseQuery())

    expect(result.data).toEqual([
      {
        id: 'entry-1',
        category: 'payment_override',
        entityType: 'order',
        entityId: 'order-1',
        actorUserId: 'admin-1',
        action: 'admin_payment_override',
        reason: 'клиент оспорил списание',
        metadata: { before: { status: 'held' }, after: { status: 'captured' } },
        tenantId: 'tenant-1',
        createdAt: '2026-08-15T00:00:00.000Z',
      },
    ])
    expect(result.meta?.pagination?.hasMore).toBe(true)
    expect(result.meta?.pagination?.limit).toBe(20)
    expect(decodeCursor(result.meta?.pagination?.nextCursor ?? '')).toEqual({ v: '2026-08-15T00:00:00.000Z', id: 'entry-1' })
  })

  it('nextCursor: null из use case → meta.pagination.nextCursor: null (не закодированный "null")', async () => {
    const { controller } = buildController({ items: [], nextCursor: null, hasMore: false })

    const result = await controller.list(baseQuery())

    expect(result.data).toEqual([])
    expect(result.meta?.pagination?.nextCursor).toBeNull()
    expect(result.meta?.pagination?.hasMore).toBe(false)
  })
})
