import { describe, expect, it, vi } from 'vitest'
import type { AuditLogListPage, AuditLogQueryPort } from '@/common/audit/audit-log-query.port.js'
import { ListReconciliationAlertsUseCase } from './list-reconciliation-alerts.use-case.js'

const PAGE: AuditLogListPage = {
  items: [
    {
      id: 'audit-1',
      category: 'ledger_adjustment',
      entityType: 'escrow_ledger',
      entityId: 'order-y',
      actorUserId: null,
      action: 'reconciliation_discrepancy_detected',
      reason: 'EscrowReconciliationJob: escrow_ledger discrepancy detected (SRS-PAY-013)',
      metadata: { orderId: 'order-y', discrepancyDiram: '500', repeatDetectionCount: 2 },
      requestId: null,
      tenantId: 'tenant-1',
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
    },
  ],
  nextCursor: null,
  hasMore: false,
}

function buildHarness() {
  const findByFiltersMock = vi.fn<AuditLogQueryPort['findByFilters']>().mockResolvedValue(PAGE)
  const auditLogQuery: AuditLogQueryPort = { findByFilters: findByFiltersMock }
  const useCase = new ListReconciliationAlertsUseCase(auditLogQuery)
  return { useCase, findByFiltersMock }
}

describe('ListReconciliationAlertsUseCase (DTJ-357)', () => {
  it('фильтрует AUDIT_LOG_QUERY_PORT по category=ledger_adjustment/entityType=escrow_ledger, передаёт limit/cursor', async () => {
    const { useCase, findByFiltersMock } = buildHarness()
    const cursor = { v: '2026-09-09T00:00:00.000Z', id: 'audit-0' }

    await useCase.execute({ limit: 20, cursor })

    expect(findByFiltersMock).toHaveBeenCalledWith({
      filter: { category: 'ledger_adjustment', entityType: 'escrow_ledger' },
      limit: 20,
      cursor,
    })
  })

  it('АС2 — алерт по заказу Y появляется в списке с суммой расхождения (metadata.discrepancyDiram → число)', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ limit: 20, cursor: null })

    expect(result.items).toEqual([
      expect.objectContaining({ orderId: 'order-y', discrepancyDiram: 500, repeatDetectionCount: 2, tenantId: 'tenant-1' }),
    ])
  })

  it('отсутствующие поля metadata → discrepancyDiram/repeatDetectionCount по умолчанию 0', async () => {
    const { useCase, findByFiltersMock } = buildHarness()
    findByFiltersMock.mockResolvedValue({ items: [{ ...PAGE.items[0]!, metadata: {} }], nextCursor: null, hasMore: false })

    const result = await useCase.execute({ limit: 20, cursor: null })

    expect(result.items[0]).toEqual(expect.objectContaining({ discrepancyDiram: 0, repeatDetectionCount: 0 }))
  })

  it('use case не несёт ни одного мутирующего метода (компиляционная гарантия — только execute)', () => {
    const useCase = new ListReconciliationAlertsUseCase({} as AuditLogQueryPort)
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(useCase))
    expect(methods).toEqual(['constructor', 'execute'])
  })
})
