import { describe, expect, it, vi } from 'vitest'
import type { AuditLogListPage, AuditLogQueryPort } from '../../audit-log-query.port.js'
import { ListAuditLogUseCase } from './list-audit-log.use-case.js'

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

function buildHarness(): {
  useCase: ListAuditLogUseCase
  findByFiltersMock: ReturnType<typeof vi.fn<AuditLogQueryPort['findByFilters']>>
} {
  const findByFiltersMock = vi.fn<AuditLogQueryPort['findByFilters']>().mockResolvedValue(PAGE)
  const port: AuditLogQueryPort = { findByFilters: findByFiltersMock }
  return { useCase: new ListAuditLogUseCase(port), findByFiltersMock }
}

describe('ListAuditLogUseCase (DTJ-376)', () => {
  it('передаёт filter/limit/cursor из command в порт без изменений', async () => {
    const { useCase, findByFiltersMock } = buildHarness()
    const cursor = { v: '2026-08-01T00:00:00.000Z', id: 'anchor' }
    const filter = { category: 'payment_override', createdAtFrom: new Date('2026-08-01T00:00:00.000Z') }

    await useCase.execute({ filter, limit: 20, cursor })

    expect(findByFiltersMock).toHaveBeenCalledWith({ filter, limit: 20, cursor })
  })

  it('cursor отсутствует в command → порт получает cursor: null', async () => {
    const { useCase, findByFiltersMock } = buildHarness()

    await useCase.execute({ filter: {}, limit: 20 })

    expect(findByFiltersMock).toHaveBeenCalledWith({ filter: {}, limit: 20, cursor: null })
  })

  it('критерий приёмки 3 — комбинация category+createdAtFrom пробрасывается одним filter-объектом, не по отдельности', async () => {
    const { useCase, findByFiltersMock } = buildHarness()
    const filter = { category: 'payment_override', createdAtFrom: new Date('2026-08-01T00:00:00.000Z') }

    await useCase.execute({ filter, limit: 20 })

    const call = findByFiltersMock.mock.calls[0]?.[0]
    expect(call?.filter.category).toBe('payment_override')
    expect(call?.filter.createdAtFrom).toEqual(new Date('2026-08-01T00:00:00.000Z'))
  })

  it('пробрасывает items/nextCursor/hasMore без изменений', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ filter: {}, limit: 20 })

    expect(result).toEqual(PAGE)
  })
})
